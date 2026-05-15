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
  userDataDir = mkdtempSync(path.join(tmpdir(), 'mcp-studio-e2e-chat-plan-'));
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

/**
 * **M6 C88 — chat-plan.spec.ts**: focused exercise of the plan-and-execute
 * substrate. Asserts on the **plan editor's structural surface** (the step
 * list rendered before Run; per-step status transitions during Run; the
 * conditional-skip outcome on the readHistory step) — architectural
 * validation that:
 *   1. Phase A's substrate (`runPlan` + PlanEditor) renders plan steps and
 *      tracks per-step state correctly.
 *   2. Phase B's Niagara plan-lifted contributions (rooftop-diagnosis.plan)
 *      reach the runner intact — five steps, the conditional readHistory
 *      with `runIf: var-length-gt(alarms, 0)`.
 *   3. The M5 niagara-mock returns `getActiveAlarms → []`, so the runIf
 *      evaluates false at runtime and the step takes the **skipped** path
 *      (vs the executed path) — observable in the PlanEditor's status
 *      icons.
 *
 * Complements `chat-rooftop.spec.ts` (which exercises the same plan but
 * asserts on tool-call envelopes + the final chart — the M5-era end-to-end
 * shape). This spec focuses on the M6 PlanEditor surface.
 */
test('M6 chat → rooftop plan editor lists 5 steps; Run plan; readHistory skipped via runIf when alarms is empty', async () => {
  // === Setup: niagara-mock connection ===
  await win.keyboard.press('Control+k');
  const palette = win.getByPlaceholder(/Type a command/i);
  await expect(palette).toBeVisible();
  await palette.fill('Servers');
  await palette.press('Enter');
  await expect(win.getByRole('heading', { name: 'Saved servers' })).toBeVisible();
  await win.getByRole('button', { name: 'Add server', exact: true }).click();
  await win.locator('#wiz-name').fill('e2e-chat-plan');
  await win.getByRole('radio', { name: 'stdio' }).check();
  await win.locator('#wiz-command').fill(process.execPath);
  await win.locator('#wiz-args').fill(niagaraMock);
  await win.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(win.getByText('e2e-chat-plan')).toBeVisible();
  await win.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(win.getByText(/\d+ tools · \d+ resources · \d+ prompts/i)).toBeVisible({ timeout: 20_000 });
  await expect(win.getByText(/Specialized by Niagara station/i)).toBeVisible({ timeout: 10_000 });

  // === Open Assistant and launch the Rooftop diagnosis flow ===
  await win.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(win.getByText('MOCK PROVIDER', { exact: true })).toBeVisible({ timeout: 10_000 });
  await win.getByRole('button', { name: 'Rooftop diagnosis', exact: true }).click();

  const launcher = win.getByRole('dialog').filter({ hasText: 'Rooftop diagnosis' });
  await expect(launcher).toBeVisible();
  await launcher.locator('input').first().fill('AHU-1');
  await launcher.getByRole('button', { name: 'Run', exact: true }).click();

  // === Phase A substrate: PlanEditor renders BEFORE Run with the step list ===
  // The rooftop-diagnosis plan has exactly 5 steps:
  //   1. tool-call findEquipment
  //   2. tool-call inspectComponent (runIf: var-defined(equipment.ord))
  //   3. tool-call getActiveAlarms (runIf: var-defined(equipment.ord))
  //   4. tool-call readHistory (runIf: var-length-gt(alarms, 0))   ← skip path
  //   5. llm-step terminal summary
  //
  // The PlanEditor header shows "5 steps" (chat.plan.stepCount) and the
  // step labels are visible. Asserting on the labels confirms Phase B's
  // niagara contribution reached the runner intact.
  await expect(win.getByText('5 steps', { exact: true })).toBeVisible({ timeout: 10_000 });

  const planEditor = win.locator('.not-prose', { hasText: 'Rooftop diagnosis' }).first();
  await expect(planEditor).toBeVisible();
  // Each rooftop plan step has an operator-readable `label` (see
  // plugins/niagara/src/diagnostic-flows.ts). Asserting on the labels —
  // rather than the toolName(args) default — verifies the plan
  // contribution reached the runner with custom labels intact.
  await expect(planEditor.getByText('Find the equipment via the knowledge layer')).toBeVisible();
  await expect(planEditor.getByText('Inspect the root component')).toBeVisible();
  await expect(planEditor.getByText('Check active alarms on the ord subtree')).toBeVisible();
  await expect(
    planEditor.getByText('Pull 24h supply-air-temp trend (only if alarms present)'),
  ).toBeVisible();
  await expect(planEditor.getByText('Summarise findings with citations')).toBeVisible();
  // The conditional `if alarms.length > 0` hint is rendered below the
  // readHistory step row (the describeRunIf helper output).
  await expect(planEditor.getByText(/alarms\.length > 0/i)).toBeVisible();

  await shot(win, 'm6-plan-editor');

  // === Run the plan and assert on per-step status ===
  await win.getByRole('button', { name: 'Run plan', exact: true }).click();

  // Wait for the plan to reach a settled state. The header summary line
  // renders "{done}/{total} done · {skipped} skipped · {errored} failed".
  // The mock has handlers for findEquipment / inspectComponent /
  // getActiveAlarms (returns []) / and the readHistory mock returns canned
  // data — but `getActiveAlarms → []` makes the readHistory step's runIf
  // false, so the runner skips it. Expected outcome:
  //   - 4 done (findEquipment, inspectComponent, getActiveAlarms, llm-step)
  //   - 1 skipped (readHistory)
  //   - 0 failed
  await expect(planEditor.getByText(/4\/5 done · 1 skipped · 0 failed/i)).toBeVisible({
    timeout: 30_000,
  });

  await shot(win, 'm6-plan-run');
});
