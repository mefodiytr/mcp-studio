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
  userDataDir = mkdtempSync(path.join(tmpdir(), 'mcp-studio-e2e-chat-rooftop-'));
  app = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    env: {
      ...process.env,
      MCPSTUDIO_USER_DATA: userDataDir,
      NODE_ENV: 'production',
      // M5 — pick the canned mock LLM provider (greeting / rooftop /
      // write-propose / cancel programs in apps/desktop/src/renderer/src/lib/
      // llm-mock-programs.ts). The renderer's llm-provider-factory loads them
      // automatically when this env var is set.
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

test('M5 chat → rooftop diagnostic flow walks findEquipment → inspectComponent → getActiveAlarms → emits chart inline', async () => {
  // Add the niagara-mock profile + connect (same setup as the M3 + M4 specs).
  await win.keyboard.press('Control+k');
  const palette = win.getByPlaceholder(/Type a command/i);
  await expect(palette).toBeVisible();
  await palette.fill('Servers');
  await palette.press('Enter');
  await expect(win.getByRole('heading', { name: 'Saved servers' })).toBeVisible();
  await win.getByRole('button', { name: 'Add server', exact: true }).click();
  await win.locator('#wiz-name').fill('e2e-chat-rooftop');
  await win.getByRole('radio', { name: 'stdio' }).check();
  await win.locator('#wiz-command').fill(process.execPath);
  await win.locator('#wiz-args').fill(niagaraMock);
  await win.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(win.getByText('e2e-chat-rooftop')).toBeVisible();
  await win.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(win.getByText(/\d+ tools · \d+ resources · \d+ prompts/i)).toBeVisible({ timeout: 20_000 });
  await expect(win.getByText(/Specialized by Niagara station/i)).toBeVisible({ timeout: 10_000 });

  // Switch to the Assistant rail.
  await win.getByRole('button', { name: 'Assistant', exact: true }).click();

  // Empty state — should show the mock badge + the Niagara starter chips +
  // the Rooftop diagnosis button. Capture m5-chat-empty-state here. The
  // mock-provider label appears in two spots (header chip + empty-state
  // hint); the chip is the canonical signal.
  await expect(win.getByText('MOCK PROVIDER', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(win.getByRole('heading', { name: /Diagnostic flows/i })).toBeVisible();
  await shot(win, 'm5-chat-empty-state');

  // Click the Rooftop diagnosis flow button → launcher dialog (param input)
  // → fill → Run. **M6 C85** lifted this flow to a structured plan; the
  // launcher Run no longer kicks the ReAct loop directly — it shows the
  // inline PlanEditor card with the 5 planned steps.
  await win.getByRole('button', { name: 'Rooftop diagnosis', exact: true }).click();
  const launcher = win.getByRole('dialog').filter({ hasText: 'Rooftop diagnosis' });
  await expect(launcher).toBeVisible();
  await launcher.locator('input').first().fill('rooftop unit 5');
  await launcher.getByRole('button', { name: 'Run', exact: true }).click();

  // PlanEditor card renders with the 5-step plan: findEquipment →
  // inspectComponent → getActiveAlarms → readHistory (conditional skip on
  // alarms.length > 0 — the mock niagara has no getActiveAlarms handler
  // so `alarms` binds to its default text + length-gt fails + the step
  // skips) → terminal llm-step (the chart-bearing summary).
  const planEditor = win.locator('button', { hasText: 'Rooftop diagnosis' }).first();
  await expect(planEditor).toBeVisible({ timeout: 10_000 });
  await win.getByRole('button', { name: 'Run plan', exact: true }).click();

  // Each plan step's tool dispatch fires the standard M5 tool-use-start /
  // tool-use-complete envelope events, so the chat surface shows the same
  // envelopes the C71 ToolCallEnvelope component renders. The mock niagara
  // has no findEquipment / inspectComponent / getActiveAlarms handlers —
  // returns its default "no handler" text; the plan runner doesn't care
  // (it just binds the result string + moves on).
  //
  // Tool names appear in two places: the transient "Calling X…" streaming
  // card AND the PlanEditor row label. `.first()` picks whichever arrives
  // first.
  await expect(win.locator('.font-mono').filter({ hasText: 'findEquipment' }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    win.locator('.font-mono').filter({ hasText: 'inspectComponent' }).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    win.locator('.font-mono').filter({ hasText: 'getActiveAlarms' }).first(),
  ).toBeVisible({ timeout: 20_000 });

  // Final assistant text + the chart.
  await expect(win.getByText(/operating within normal range/i)).toBeVisible({ timeout: 20_000 });
  // The chart wrapper has role="img" + aria-label from the payload title.
  const chart = win.getByRole('img', { name: /Supply-air temperature/i });
  await expect(chart).toBeVisible();
  // The chart container renders a <TimeSeriesChart> from @mcp-studio/charts;
  // recharts emits SVG.
  await expect(chart.locator('svg')).toBeVisible();

  await shot(win, 'm5-rooftop-diagnosis');
  await shot(win, 'm5-chart-inline-rendering');

  // Audit-trail check: the read calls landed in the History panel. The AI
  // attribution lives on each entry (`actor: {type:'ai', conversationId}`);
  // a dedicated "AI-initiated" filter is m5-followup, so the assertion here
  // just confirms the tool calls are recorded under the active connection.
  await win.getByRole('button', { name: 'History', exact: true }).first().click();
  await expect(win.getByText('findEquipment').first()).toBeVisible({ timeout: 10_000 });
});
