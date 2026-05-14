import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  userDataDir = mkdtempSync(path.join(tmpdir(), 'mcp-studio-e2e-chat-cancel-'));
  app = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    env: {
      ...process.env,
      MCPSTUDIO_USER_DATA: userDataDir,
      NODE_ENV: 'production',
      MCPSTUDIO_LLM_PROVIDER: 'mock',
    },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  if (app) await app.close().catch(() => undefined);
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test('M5 chat → Stop mid-stream aborts the ReAct loop + records the [stopped by user] marker', async () => {
  // Setup: niagara-mock profile + connect. (Cancel scenario doesn't strictly
  // need a connection, but the chat view's empty state requires `profileId`
  // to be present; the connection's tool catalog is also resolved before
  // the runner starts.)
  await win.keyboard.press('Control+k');
  const palette = win.getByPlaceholder(/Type a command/i);
  await expect(palette).toBeVisible();
  await palette.fill('Servers');
  await palette.press('Enter');
  await win.getByRole('button', { name: 'Add server', exact: true }).click();
  await win.locator('#wiz-name').fill('e2e-chat-cancel');
  await win.getByRole('radio', { name: 'stdio' }).check();
  await win.locator('#wiz-command').fill(process.execPath);
  await win.locator('#wiz-args').fill(niagaraMock);
  await win.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(win.getByText('e2e-chat-cancel')).toBeVisible();
  await win.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(win.getByText(/\d+ tools · \d+ resources · \d+ prompts/i)).toBeVisible({ timeout: 20_000 });

  // The 'cancel' mock program matches on 'story' + paces text-deltas with
  // 200 ms __delay sentinels — the first delta lands ~immediately; the
  // Stop button has time to abort before the rest arrive.
  await win.getByRole('button', { name: 'Assistant', exact: true }).click();
  const input = win.getByPlaceholder(/Ask a question/i);
  await input.fill('Tell me a long story');
  await win.getByRole('button', { name: 'Send', exact: true }).click();

  // The Stop button replaces Send while the runner is in flight. Wait for
  // it to appear, then click before the program finishes (the program runs
  // ~6 × 200ms = 1.2 s end-to-end).
  const stopButton = win.getByRole('button', { name: 'Stop', exact: true });
  await expect(stopButton).toBeVisible({ timeout: 5_000 });
  await stopButton.click();

  // The conversation should record a synthetic '[stopped by user]' marker.
  // The chat's marker renderer ("— stopped by user —") makes this visible.
  await expect(win.getByText(/stopped by user/i)).toBeVisible({ timeout: 10_000 });

  await shot(win, 'm5-chat-stopped');

  // Send button returns; subsequent send works.
  await expect(win.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 5_000 });
});
