import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const repoRoot = process.cwd();
const desktop = path.join(repoRoot, 'apps', 'desktop');
const mainEntry = path.join(desktop, 'out', 'main', 'index.js');
const electronDir = path.join(desktop, 'node_modules', 'electron');
const electronExecutable = path.join(
  electronDir,
  'dist',
  readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim(),
);
// The SDK ships an OAuth-protected MCP server example (DemoInMemory auth
// provider — auto-approves, supports DCR). Run it as the test auth + MCP server.
const oauthServerEntry = realpathSync(
  path.join(repoRoot, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'examples', 'server', 'simpleStreamableHttp.js'),
);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

function waitForListening(child: ChildProcess, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OAuth test server did not start in time')), timeoutMs);
    const onData = (chunk: Buffer): void => {
      if (chunk.toString().includes('MCP Streamable HTTP Server listening')) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`OAuth test server exited early (code ${String(code)})`));
    });
  });
}

let app: ElectronApplication;
let win: Page;
let server: ChildProcess;
let userDataDir: string;
let mcpUrl: string;

test.beforeAll(async () => {
  const mcpPort = await freePort();
  const authPort = await freePort();
  mcpUrl = `http://localhost:${mcpPort}/mcp`;
  server = spawn(process.execPath, [oauthServerEntry, '--oauth'], {
    env: { ...process.env, MCP_PORT: String(mcpPort), MCP_AUTH_PORT: String(authPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForListening(server);

  userDataDir = mkdtempSync(path.join(tmpdir(), 'mcp-studio-e2e-oauth-'));
  app = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    env: {
      ...process.env,
      MCPSTUDIO_USER_DATA: userDataDir,
      MCPSTUDIO_OAUTH_AUTOAPPROVE: '1',
      NODE_ENV: 'production',
    },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  if (app) await app.close().catch(() => undefined);
  if (server && !server.killed) server.kill();
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test('add an OAuth (HTTP) profile → connect → sign in → list & invoke a tool', async () => {
  await expect(win.getByText(/No tabs open/i)).toBeVisible();

  await win.keyboard.press('Control+k');
  const palette = win.getByPlaceholder(/Type a command/i);
  await expect(palette).toBeVisible();
  await palette.fill('Servers');
  await palette.press('Enter');
  await expect(win.getByRole('heading', { name: 'Saved servers' })).toBeVisible();

  // Add an OAuth-over-HTTP profile pointing at the test server.
  await win.getByRole('button', { name: 'Add server', exact: true }).click();
  await win.locator('#wiz-name').fill('e2e-oauth');
  await win.locator('#wiz-url').fill(mcpUrl);
  await win.getByRole('radio', { name: 'oauth', exact: true }).check();
  await win.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(win.getByText('e2e-oauth')).toBeVisible();

  // Connect — the headless auto-approve hook completes the authorization
  // (discovery → DCR → authorize → token exchange) without a browser.
  await win.locator('li:has-text("e2e-oauth")').first().getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(win.getByText('signed in')).toBeVisible({ timeout: 25_000 });
  await expect(win.getByText('simple-streamable-http-server')).toBeVisible();
  await expect(win.getByText(/expires in/i)).toBeVisible();

  // Tools catalog → invoke `greet`.
  await win.getByRole('button', { name: 'Tools', exact: true }).click();
  await expect(win.getByText('greet', { exact: true })).toBeVisible({ timeout: 15_000 });
  await win.locator('li:has-text("greet")').first().getByRole('button', { name: 'Call', exact: true }).click();
  const dialog = win.getByRole('dialog');
  const textbox = dialog.getByRole('textbox');
  if (await textbox.count()) await textbox.first().fill('OAuthTester');
  await dialog.getByRole('button', { name: 'Call', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Result' })).toBeVisible({ timeout: 15_000 });
});
