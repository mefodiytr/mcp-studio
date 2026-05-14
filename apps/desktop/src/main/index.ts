import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, safeStorage, shell } from 'electron';

import { ConnectionManager } from './connections/connection-manager';
import { StdioPidTracker } from './connections/pid-tracker';
import { ProtocolTap } from './connections/protocol-tap';
import { emitToRenderers, registerIpcHandlers, startDemoEventSource } from './ipc';
import { registerConnectionHandlers } from './ipc/connections';
import { registerConversationHandlers } from './ipc/conversations';
import { registerCredentialHandlers } from './ipc/credentials';
import { registerHistoryHandlers } from './ipc/history';
import { registerLlmHandlers } from './ipc/llm';
import { registerOAuthHandlers } from './ipc/oauth';
import { registerProfileHandlers } from './ipc/profiles';
import { registerProtocolHandlers } from './ipc/protocol';
import { registerWatchHandlers } from './ipc/watches';
import { createConfigStore, type AppConfig } from './store/config-store';
import { ConversationRepository } from './store/conversation-repository';
import { CredentialVault, createCredentialVaultStore, type SecretCipher } from './store/credential-vault';
import type { JsonStore } from './store/json-store';
import { ProfileRepository } from './store/profile-repository';
import { ToolHistoryRepository } from './store/tool-history-repository';
import { WatchRepository } from './store/watch-repository';
import { createWorkspaceStore } from './store/workspace-store';

// Set before any path lookups so userData lives under "MCP Studio", not the
// scoped package name.
app.setName('MCP Studio');

// Test/CI hook: run against a throwaway profile + config store.
const USER_DATA_OVERRIDE = process.env['MCPSTUDIO_USER_DATA'];
if (USER_DATA_OVERRIDE) app.setPath('userData', USER_DATA_OVERRIDE);

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL'];
// Automation hook: when set, capture the rendered window to this PNG path once
// the renderer has loaded, then quit. Used for screenshots and CI smoke checks;
// no effect during normal use.
const CAPTURE_PATH = process.env['MCPSTUDIO_CAPTURE_PATH'];

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

let configStore: JsonStore<AppConfig> | undefined;

function createMainWindow(): BrowserWindow {
  const bounds = configStore?.data.windowBounds;
  const window = new BrowserWindow({
    width: bounds?.width ?? DEFAULT_WIDTH,
    height: bounds?.height ?? DEFAULT_HEIGHT,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.on('ready-to-show', () => window.show());

  // Persist the window size so it is restored next launch.
  window.on('close', () => {
    if (!configStore || window.isMinimized()) return;
    const { width, height } = window.getBounds();
    configStore.data.windowBounds = { width, height };
    configStore.save();
  });

  // Open external links in the OS browser; never navigate the app window away.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (RENDERER_DEV_URL) {
    void window.loadURL(RENDERER_DEV_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  if (CAPTURE_PATH) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void window.webContents.capturePage().then((image) => {
          writeFileSync(CAPTURE_PATH, image.toPNG());
          app.quit();
        });
      }, 5000);
    });
  }

  return window;
}

function focusExistingWindow(): void {
  const [existing] = BrowserWindow.getAllWindows();
  if (!existing) return;
  if (existing.isMinimized()) existing.restore();
  existing.focus();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', focusExistingWindow);

  let stopDemoEvents: (() => void) | undefined;
  let connectionManager: ConnectionManager | undefined;

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.mcpstudio.app');

    const userData = app.getPath('userData');
    configStore = createConfigStore(userData);
    const workspaceStore = createWorkspaceStore(userData);
    const profiles = new ProfileRepository(workspaceStore);
    const toolHistory = new ToolHistoryRepository(workspaceStore);
    const watches = new WatchRepository(workspaceStore);
    const conversations = new ConversationRepository(workspaceStore);

    const cipher: SecretCipher = {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plaintext) => safeStorage.encryptString(plaintext),
      decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
    };
    if (!cipher.isAvailable()) {
      console.warn('[vault] OS-backed encryption unavailable; secrets stored with reduced protection');
    }
    const vault = new CredentialVault(createCredentialVaultStore(userData), cipher);

    const pidTracker = new StdioPidTracker(userData);
    const orphans = pidTracker.reapOrphans();
    if (orphans.length > 0) {
      console.warn(
        `[connections] ${orphans.length} stdio server(s) from a previous session may still be running: ` +
          orphans.map((o) => o.pid).join(', '),
      );
    }
    const protocolTap = new ProtocolTap((event) => emitToRenderers('protocol:event', event));
    connectionManager = new ConnectionManager(
      profiles,
      vault,
      pidTracker,
      protocolTap,
      toolHistory,
      (url) => void shell.openExternal(url),
      (connections) => emitToRenderers('connections:changed', { connections }),
      () => emitToRenderers('history:changed', {}),
    );

    registerIpcHandlers();
    registerProfileHandlers(profiles, vault);
    registerCredentialHandlers(profiles, vault);
    registerOAuthHandlers(vault);
    registerConnectionHandlers(connectionManager);
    registerProtocolHandlers(protocolTap);
    registerHistoryHandlers(toolHistory);
    registerWatchHandlers(watches);
    registerConversationHandlers(conversations);
    registerLlmHandlers(vault);
    stopDemoEvents = startDemoEventSource();

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  // Graceful-exit cleanup: synchronously force-kill any tracked stdio children
  // (covers normal quit, Ctrl-C, app.quit()). A hard crash of the main process
  // can still leave orphans — detected on the next launch, see StdioPidTracker;
  // job-object-based hard-crash survival is intentionally out of M1 scope.
  app.on('before-quit', () => connectionManager?.killAllStdioChildren());
  app.on('will-quit', () => stopDemoEvents?.());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => app.quit());
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
