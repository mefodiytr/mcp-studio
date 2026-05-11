import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';

import { registerIpcHandlers, startDemoEventSource } from './ipc';

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL'];
// Automation hook: when set, capture the rendered window to this PNG path once
// the renderer has loaded, then quit. Used for screenshots and CI smoke checks;
// no effect during normal use.
const CAPTURE_PATH = process.env['MCPSTUDIO_CAPTURE_PATH'];

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
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
      }, 2500);
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

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.mcpstudio.app');

    registerIpcHandlers();
    stopDemoEvents = startDemoEventSource();

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('will-quit', () => stopDemoEvents?.());

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
