import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

// `pnpm test:e2e` runs `pnpm build` first, which writes apps/desktop/out/.
const repoRoot = process.cwd();
const desktop = path.join(repoRoot, 'apps', 'desktop');
const mainEntry = path.join(desktop, 'out', 'main', 'index.js');
// Electron lives in the desktop package (pnpm isolated layout); resolve its
// binary from there rather than relying on it being hoisted to the repo root.
// (electron/index.js: the binary is dist/<contents of path.txt>.)
const electronDir = path.join(desktop, 'node_modules', 'electron');
const electronExecutable = path.join(
  electronDir,
  'dist',
  readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim(),
);
// pnpm symlinks the package in; realpath it so `node <path> stdio` is version-agnostic.
const serverEverything = realpathSync(
  path.join(desktop, 'node_modules', '@modelcontextprotocol', 'server-everything', 'dist', 'index.js'),
);

let app: ElectronApplication;
let win: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'mcp-studio-e2e-'));
  app = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    env: { ...process.env, MCPSTUDIO_USER_DATA: userDataDir, NODE_ENV: 'production' },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  if (app) await app.close().catch(() => undefined);
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test('launch → add stdio profile → connect → list & invoke a tool → see it in the inspector', async () => {
  // Fresh workspace: no tabs open.
  await expect(win.getByText(/No tabs open/i)).toBeVisible();

  // The command palette opens and navigates.
  await win.keyboard.press('Control+k');
  const palette = win.getByPlaceholder(/Type a command/i);
  await expect(palette).toBeVisible();
  await palette.fill('Servers');
  await palette.press('Enter');
  await expect(win.getByRole('heading', { name: 'Saved servers' })).toBeVisible();

  // Add an stdio profile for @modelcontextprotocol/server-everything via the wizard.
  await win.getByRole('button', { name: 'Add server', exact: true }).click();
  await win.locator('#wiz-name').fill('e2e-everything');
  await win.getByRole('radio', { name: 'stdio' }).check();
  await win.locator('#wiz-command').fill(process.execPath);
  await win.locator('#wiz-args').fill(`${serverEverything} stdio`);
  await win.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(win.getByText('e2e-everything')).toBeVisible();

  // Connect — the status bar picks up the server's capability counts.
  await win.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(win.getByText(/\d+ tools · \d+ resources · \d+ prompts/i)).toBeVisible({ timeout: 20_000 });

  // Tools catalog → invoke `echo`.
  await win.getByRole('button', { name: 'Tools', exact: true }).click();
  await expect(win.getByText('echo', { exact: true })).toBeVisible({ timeout: 15_000 });
  await win.locator('li:has-text("echo")').first().getByRole('button', { name: 'Call', exact: true }).click();
  const dialog = win.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('hello-e2e');
  await dialog.getByRole('button', { name: 'Call', exact: true }).click();
  await expect(win.getByText(/hello-e2e/)).toBeVisible({ timeout: 15_000 });
  await win.keyboard.press('Escape');

  // The protocol inspector shows the tools/call request.
  await win.keyboard.press('Control+Backquote');
  await expect(win.getByText('tools/call').first()).toBeVisible({ timeout: 10_000 });
});
