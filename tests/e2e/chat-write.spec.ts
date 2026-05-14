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
  userDataDir = mkdtempSync(path.join(tmpdir(), 'mcp-studio-e2e-chat-write-'));
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

test('M5 chat → AI-proposed write intercepted by C75 safety boundary → routed to Niagara plugin Changes view', async () => {
  // Setup: niagara-mock profile + connect.
  await win.keyboard.press('Control+k');
  const palette = win.getByPlaceholder(/Type a command/i);
  await expect(palette).toBeVisible();
  await palette.fill('Servers');
  await palette.press('Enter');
  await win.getByRole('button', { name: 'Add server', exact: true }).click();
  await win.locator('#wiz-name').fill('e2e-chat-write');
  await win.getByRole('radio', { name: 'stdio' }).check();
  await win.locator('#wiz-command').fill(process.execPath);
  await win.locator('#wiz-args').fill(niagaraMock);
  await win.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(win.getByText('e2e-chat-write')).toBeVisible();
  await win.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(win.getByText(/\d+ tools · \d+ resources · \d+ prompts/i)).toBeVisible({ timeout: 20_000 });

  // Open Assistant and send a setpoint-change message. The 'write-propose'
  // mock program matches on 'setpoint' → emits a single tool_use(setSlot)
  // → the M5 C75 safety boundary intercepts (setSlot is annotated as a
  // write via the Niagara manifest's override) → main returns
  // pendingEnqueued → the chat view's dispatchTool routes through
  // enqueueAiWrite into the Niagara plugin's pending-changes queue.
  await win.getByRole('button', { name: 'Assistant', exact: true }).click();
  const input = win.getByPlaceholder(/Ask a question/i);
  await input.fill('Raise the supply-air setpoint on AHU-1 by 2 degrees');
  await win.getByRole('button', { name: 'Send', exact: true }).click();

  // The chat should surface the proposal: the setSlot envelope + the LLM's
  // follow-up "I've proposed the setpoint change for operator approval".
  // The intermediate `tool_result` body ("queued for operator approval —
  // the Changes view now shows…") lives inside the envelope's collapsed
  // summary; the canonical user-visible signal is the assistant text the
  // LLM emits next.
  await expect(win.locator('.font-mono').filter({ hasText: 'setSlot' }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(win.getByText(/proposed the setpoint change for operator approval/i)).toBeVisible({
    timeout: 20_000,
  });

  // Navigate to the Niagara plugin's Changes view — the op should be there
  // badged "AI".
  await win.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(win.getByText(/1 pending change/i)).toBeVisible({ timeout: 10_000 });
  const aiChip = win.locator('span', { hasText: /^AI$/ }).first();
  await expect(aiChip).toBeVisible();
  // The op row should describe the setSlot the LLM proposed.
  await expect(win.getByText(/Set value on station:\|slot:\/Drivers\/AHU1\/SAT/i)).toBeVisible();

  await shot(win, 'm5-ai-proposed-write-in-queue');
});
