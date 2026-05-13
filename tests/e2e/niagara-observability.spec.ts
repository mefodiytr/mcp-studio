import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

// `pnpm test:e2e` runs `pnpm build` first.
const repoRoot = process.cwd();
const desktop = path.join(repoRoot, 'apps', 'desktop');
const mainEntry = path.join(desktop, 'out', 'main', 'index.js');
const electronDir = path.join(desktop, 'node_modules', 'electron');
const electronExecutable = path.join(
  electronDir,
  'dist',
  readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim(),
);
const niagaraMock = path.join(repoRoot, 'tests', 'fixtures', 'niagara-mock', 'server.mjs');

const SHOTS_ENABLED = process.env['MCPSTUDIO_E2E_SCREENSHOTS'] === '1';
const SHOTS_DIR = path.join(repoRoot, 'docs', 'screenshots');
const shot = async (page: Page, name: string): Promise<void> => {
  if (!SHOTS_ENABLED) return;
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
};

let app: ElectronApplication;
let win: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'mcp-studio-e2e-niagara-obs-'));
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

test('M4 observability — History view (readHistory) + Live monitor (readPoint) + Performance', async () => {
  // === Setup: add the niagara mock profile, connect ===
  await win.keyboard.press('Control+k');
  const palette = win.getByPlaceholder(/Type a command/i);
  await expect(palette).toBeVisible();
  await palette.fill('Servers');
  await palette.press('Enter');
  await expect(win.getByRole('heading', { name: 'Saved servers' })).toBeVisible();
  await win.getByRole('button', { name: 'Add server', exact: true }).click();
  await win.locator('#wiz-name').fill('e2e-niagara-obs');
  await win.getByRole('radio', { name: 'stdio' }).check();
  await win.locator('#wiz-command').fill(process.execPath);
  await win.locator('#wiz-args').fill(niagaraMock);
  await win.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(win.getByText('e2e-niagara-obs')).toBeVisible();
  await win.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(win.getByText(/\d+ tools · \d+ resources · \d+ prompts/i)).toBeVisible({ timeout: 20_000 });
  await expect(win.getByText(/Specialized by Niagara station/i)).toBeVisible({ timeout: 10_000 });

  // Find the active connection's profileId — needed to seed the watch list.
  const profileId = (await win.evaluate(async () => {
    const studio = (globalThis as unknown as { studio?: { invoke: (c: string, p: unknown) => Promise<unknown> } }).studio
      ?? (globalThis as unknown as { window: { studio?: { invoke: (c: string, p: unknown) => Promise<unknown> } } }).window?.studio;
    const list = (await studio!.invoke('connections:list', {})) as Array<{ profileId: string; status: string }>;
    return list.find((c) => c.status === 'connected')?.profileId ?? '';
  })) as string;
  expect(profileId).toBeTruthy();

  // === 1) Explorer: expand to populate the known cache + tool-history ===
  await win.getByRole('button', { name: 'Explorer', exact: true }).click();
  const tree = win.getByRole('tree');
  await expect(tree.getByText('Drivers', { exact: true })).toBeVisible({ timeout: 15_000 });
  // Expand Services → UserService visible, select it (so History view has an ord).
  const servicesRow = tree.getByRole('treeitem').filter({ hasText: 'Services' }).first();
  await servicesRow.getByRole('button', { name: /Expand/i }).first().click();
  await expect(tree.getByText('UserService', { exact: true })).toBeVisible({ timeout: 10_000 });
  await tree.getByText('UserService', { exact: true }).first().click();

  // === 2) History view: readHistory renders a chart for the selected ord ===
  // Both the host "History" rail item (tool-call history) and the Niagara
  // plugin's "History" view share the title — pick the plugin item, which
  // is the last button with that aria-label (plugin items follow built-ins
  // in the rail).
  await win.getByRole('button', { name: 'History', exact: true }).last().click();
  await expect(win.getByText('Range', { exact: true })).toBeVisible({ timeout: 10_000 });
  // The wrapper row count confirms the canned response was unpacked — both
  // the header summary and the per-series table pane show it, so we just
  // check the first.
  await expect(win.getByText(/\d+ rows/).first()).toBeVisible({ timeout: 15_000 });
  await shot(win, 'm4-history');

  // === 3) Seed a watch via IPC, then open the Monitor view ===
  await win.evaluate(async ({ pid }) => {
    const studio = (globalThis as unknown as { studio?: { invoke: (c: string, p: unknown) => Promise<unknown> } }).studio
      ?? (globalThis as unknown as { window: { studio?: { invoke: (c: string, p: unknown) => Promise<unknown> } } }).window?.studio;
    await studio!.invoke('watches:set', {
      profileId: pid,
      watches: [
        { ord: 'station:|slot:/Services/UserService', intervalMs: 1000, displayName: 'UserService' },
        { ord: 'station:|slot:/Drivers', intervalMs: 5000, displayName: 'Drivers', threshold: { high: 0 } },
      ],
    });
  }, { pid: profileId });

  await win.getByRole('button', { name: 'Monitor', exact: true }).click();
  await expect(win.getByText(/2 watches/)).toBeVisible({ timeout: 10_000 });
  await expect(win.getByText('UserService', { exact: true })).toBeVisible();
  await expect(win.getByText('Drivers', { exact: true })).toBeVisible();
  // Wait for at least one successful poll → the value cell renders the
  // numeric + the mock's `°C` units suffix (the empty `—` placeholder gets
  // replaced once readPoint resolves).
  await expect(win.getByText('°C').first()).toBeVisible({ timeout: 15_000 });
  // Linger long enough for the 1 s row to land a *second* sample so the
  // sparkline path is drawn (it needs ≥ 2 points to render).
  await win.waitForTimeout(2500);
  await shot(win, 'm4-monitor');

  // === 4) Performance view — recent activity has populated the histogram ===
  await win.keyboard.press('Control+k');
  await palette.fill('Performance');
  await palette.press('Enter');
  await expect(win.getByRole('heading', { name: 'Performance' })).toBeVisible();
  await expect(win.getByText('Latency distribution')).toBeVisible();
  await expect(win.getByText('Slowest calls')).toBeVisible();
  await shot(win, 'm4-perf');
});
