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

/**
 * **M6 C88 — chat-summary.spec.ts**: exercises C86 summarise-then-drop
 * end-to-end. Two scenarios in two test blocks (separate test.beforeAll
 * setups so the failure-path conversation doesn't bleed sentinel text
 * into the success-path one):
 *
 *   1. Success path — summariser returns clean text → the head is
 *      replaced by a single collapsible 'summary' marker; the UsageBadge
 *      totals reflect the summary call's tokens; the operator can expand
 *      the marker to read the synthesis.
 *
 *   2. Failure path — summariser mock returns an `error` event → the
 *      store's graceful-degradation branch silent-drops the head + the
 *      chat header surfaces the "Summary unavailable — older messages
 *      dropped" fallback chip (promt19 edge case #1).
 *
 * The threshold + slice-count are overridden via the C88 e2e tuning hook
 * (`__MCPSTUDIO_E2E_SUMMARY_TUNING`) so the test can trigger summarisation
 * with a handful of "hello" sends instead of bloating to 180 messages.
 * Production never sets the hook — `summariser.ts` falls back to the
 * shipped 180/100 defaults.
 */

interface E2eContext {
  app: ElectronApplication;
  win: Page;
  userDataDir: string;
}

async function bootApp(opts: {
  prefix: string;
  triggerThreshold: number;
  headSliceCount: number;
}): Promise<E2eContext> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), `mcp-studio-e2e-${opts.prefix}-`));
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    env: {
      ...process.env,
      MCPSTUDIO_USER_DATA: userDataDir,
      NODE_ENV: 'production',
      MCPSTUDIO_LLM_PROVIDER: 'mock',
    },
  });
  const win = await app.firstWindow();
  // Set the e2e tuning override BEFORE the renderer's JS runs the chat
  // view's summariser-trigger useEffect; passes the override values
  // explicitly so each test block can pick its own threshold.
  await win.addInitScript(
    (cfg: { triggerThreshold: number; headSliceCount: number }) => {
      (
        globalThis as unknown as {
          __MCPSTUDIO_E2E_SUMMARY_TUNING?: { triggerThreshold?: number; headSliceCount?: number };
        }
      ).__MCPSTUDIO_E2E_SUMMARY_TUNING = {
        triggerThreshold: cfg.triggerThreshold,
        headSliceCount: cfg.headSliceCount,
      };
    },
    { triggerThreshold: opts.triggerThreshold, headSliceCount: opts.headSliceCount },
  );
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  return { app, win, userDataDir };
}

async function connectNiagara(win: Page, name: string): Promise<void> {
  await win.keyboard.press('Control+k');
  const palette = win.getByPlaceholder(/Type a command/i);
  await expect(palette).toBeVisible();
  await palette.fill('Servers');
  await palette.press('Enter');
  await expect(win.getByRole('heading', { name: 'Saved servers' })).toBeVisible();
  await win.getByRole('button', { name: 'Add server', exact: true }).click();
  await win.locator('#wiz-name').fill(name);
  await win.getByRole('radio', { name: 'stdio' }).check();
  await win.locator('#wiz-command').fill(process.execPath);
  await win.locator('#wiz-args').fill(niagaraMock);
  await win.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(win.getByText(name)).toBeVisible();
  await win.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(win.getByText(/\d+ tools · \d+ resources · \d+ prompts/i)).toBeVisible({ timeout: 20_000 });
  await expect(win.getByText(/Specialized by Niagara station/i)).toBeVisible({ timeout: 10_000 });
}

async function sendChatMessage(win: Page, text: string): Promise<void> {
  const input = win.getByPlaceholder(/Ask a question/i);
  await input.fill(text);
  await input.press('Enter');
  // Wait for the assistant turn to settle (the user message appears + the
  // mock greeting program's response renders).
  await expect(win.getByText('Hi!').first()).toBeVisible({ timeout: 15_000 });
}

test.describe('M6 C88 — chat summary (success path)', () => {
  let ctx: E2eContext;

  test.beforeAll(async () => {
    // Threshold 4 + head-slice 2. Two "hello" sends → 4 persisted messages
    // (2 user + 2 assistant) → useEffect crosses threshold + fires trim
    // exactly once. Head slice = first 2 messages; tail = 2 messages →
    // post-trim conversation = [summary marker, "hello again", "Hi!"].
    // Crucially, we stop sending after the trim fires so a second trim
    // doesn't supersede the first (relevant for the failure path: a
    // second successful trim would clear the fallback chip).
    ctx = await bootApp({ prefix: 'chat-summary-ok', triggerThreshold: 4, headSliceCount: 2 });
  });

  test.afterAll(async () => {
    if (ctx?.app) await ctx.app.close().catch(() => undefined);
    if (ctx?.userDataDir) rmSync(ctx.userDataDir, { recursive: true, force: true });
  });

  test('summariser returns text → head replaced with collapsible summary marker; usage totalled into UsageBadge', async () => {
    const { win } = ctx;
    await connectNiagara(win, 'e2e-chat-summary-ok');
    await win.getByRole('button', { name: 'Assistant', exact: true }).click();
    await expect(win.getByText('MOCK PROVIDER', { exact: true })).toBeVisible({ timeout: 10_000 });

    await sendChatMessage(win, 'hello there');
    await sendChatMessage(win, 'hello again');

    // The collapsible summary marker renders as a button containing the
    // "earlier messages summarised" locale string. Default-collapsed.
    const summaryMarker = win.getByRole('button', { name: /earlier messages summarised/i });
    await expect(summaryMarker).toBeVisible({ timeout: 15_000 });
    await expect(summaryMarker).toHaveAttribute('aria-expanded', 'false');

    await shot(win, 'm6-summary-marker-collapsed');

    // Expand and verify the summary text from the mock summariser program
    // (apps/desktop/src/renderer/src/lib/llm-mock-programs.ts —
    // `summary-success`).
    await summaryMarker.click();
    await expect(summaryMarker).toHaveAttribute('aria-expanded', 'true');
    await expect(win.getByText(/several rooftop diagnostic steps/i)).toBeVisible();

    await shot(win, 'm6-summary-marker-expanded');

    // The UsageBadge totals include the summariser call's tokens.
    // After the trim, the conversation = [summary marker (carrying the
    // summariser call's 120+45 = 165 tokens), user "hello again" (no
    // usage), assistant "Hi!" (5+12 = 17 tokens)] → badge ≥ 165 confirms
    // the summariser usage made it into the workspace-global totals
    // (promt19 cost-transparency edge case). The greeting from send #1
    // was in the dropped head, so its 17 tokens are no longer counted —
    // exactly the "summary credits replace dropped messages' credits"
    // shape we want.
    const badge = win.getByText(/tokens$/i).first();
    await expect(badge).toBeVisible();
    const tokensText = (await badge.textContent()) ?? '';
    const match = tokensText.match(/([\d,]+)/);
    expect(match).not.toBeNull();
    const tokens = parseInt(match![1]!.replace(/,/g, ''), 10);
    expect(tokens).toBeGreaterThanOrEqual(165);
  });
});

test.describe('M6 C88 — chat summary (failure path)', () => {
  let ctx: E2eContext;

  test.beforeAll(async () => {
    ctx = await bootApp({ prefix: 'chat-summary-fail', triggerThreshold: 4, headSliceCount: 2 });
  });

  test.afterAll(async () => {
    if (ctx?.app) await ctx.app.close().catch(() => undefined);
    if (ctx?.userDataDir) rmSync(ctx.userDataDir, { recursive: true, force: true });
  });

  test('summariser mock errors → head silent-dropped + fallback chip surfaced in chat header', async () => {
    const { win } = ctx;
    await connectNiagara(win, 'e2e-chat-summary-fail');
    await win.getByRole('button', { name: 'Assistant', exact: true }).click();
    await expect(win.getByText('MOCK PROVIDER', { exact: true })).toBeVisible({ timeout: 10_000 });

    // The failure-sentinel text seeds into the FIRST user message so it
    // lands in the trim's head slice (computeHeadSlice takes the first N
    // messages). The literal sentinel must match the
    // SUMMARY_FAILURE_SENTINEL constant in
    // apps/desktop/src/renderer/src/lib/llm-mock-programs.ts.
    //
    // Only two sends — crucial: a second trim (which would NOT see the
    // sentinel, since the first trim's silent-drop already removed it)
    // would route to the success path and clear the fallback chip
    // (ChatView.tsx — `outcome === 'summarised'` branch). We stop here.
    await sendChatMessage(win, 'hello __MCPSTUDIO_E2E_FORCE_SUMMARY_FAILURE__');
    await sendChatMessage(win, 'hello again');

    // Fallback chip appears in the header (chat.summaryFallbackBadge).
    await expect(win.getByText(/Summary unavailable — older messages dropped/i)).toBeVisible({
      timeout: 15_000,
    });

    // No summary marker rendered — graceful degradation drops the head
    // silently without synthesising a marker.
    await expect(win.getByRole('button', { name: /earlier messages summarised/i })).toHaveCount(0);

    await shot(win, 'm6-summary-fallback-chip');
  });
});
