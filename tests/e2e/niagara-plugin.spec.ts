import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

// `pnpm test:e2e` runs `pnpm build` first, which writes apps/desktop/out/.
const repoRoot = process.cwd();
const desktop = path.join(repoRoot, 'apps', 'desktop');
const mainEntry = path.join(desktop, 'out', 'main', 'index.js');
const electronDir = path.join(desktop, 'node_modules', 'electron');
const electronExecutable = path.join(
  electronDir,
  'dist',
  readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim(),
);
// The in-process Niagara MCP mock — replays the recorded niagaramcp envelopes.
const niagaraMock = path.join(repoRoot, 'tests', 'fixtures', 'niagara-mock', 'server.mjs');

let app: ElectronApplication;
let win: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'mcp-studio-e2e-niagara-'));
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

test('niagaramcp connection → Niagara plugin: explorer tree, property sheet, BQL', async () => {
  // Servers view via the command palette.
  await win.keyboard.press('Control+k');
  const palette = win.getByPlaceholder(/Type a command/i);
  await expect(palette).toBeVisible();
  await palette.fill('Servers');
  await palette.press('Enter');
  await expect(win.getByRole('heading', { name: 'Saved servers' })).toBeVisible();

  // Add an stdio profile pointing at the mock server.
  await win.getByRole('button', { name: 'Add server', exact: true }).click();
  await win.locator('#wiz-name').fill('e2e-niagara');
  await win.getByRole('radio', { name: 'stdio' }).check();
  await win.locator('#wiz-command').fill(process.execPath);
  await win.locator('#wiz-args').fill(niagaraMock);
  await win.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(win.getByText('e2e-niagara')).toBeVisible();

  // Connect — 46 tools, and the in-box plugin recognises the server.
  await win.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(win.getByText(/\d+ tools · \d+ resources · \d+ prompts/i)).toBeVisible({ timeout: 20_000 });
  await expect(win.getByText(/Specialized by Niagara station/i)).toBeVisible({ timeout: 10_000 });

  // Explorer view — the station root's children load immediately.
  await win.getByRole('button', { name: 'Explorer', exact: true }).click();
  await expect(win.getByText('Station', { exact: true })).toBeVisible({ timeout: 10_000 });
  const tree = win.getByRole('tree');
  await expect(tree.getByText('Drivers', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(tree.getByText('Services', { exact: true })).toBeVisible();

  // Expand Drivers → its children load.
  await tree
    .getByRole('treeitem')
    .filter({ hasText: 'Drivers' })
    .first()
    .getByRole('button', { name: /Expand/i })
    .first()
    .click();
  await expect(tree.getByText('NiagaraNetwork', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Select Drivers, then the Property sheet shows its identity.
  await tree.getByText('Drivers', { exact: true }).first().click();
  await win.getByRole('button', { name: 'Properties', exact: true }).click();
  await expect(win.getByText('driver:DriverContainer').first()).toBeVisible({ timeout: 15_000 });

  // BQL view — run the default query, see the recorded TSV result.
  await win.getByRole('button', { name: 'BQL', exact: true }).click();
  await win.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(win.getByText('oat', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(win.getByText(/1 row/i)).toBeVisible();
});
