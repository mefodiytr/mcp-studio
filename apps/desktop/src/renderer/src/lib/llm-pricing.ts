/**
 * Versioned LLM pricing table — hardcoded, per million tokens.
 *
 * **As of `ANTHROPIC_PRICES_AS_OF` only.** Anthropic adjusts prices ~quarterly;
 * the UI surfaces this constant in the cost-estimate tooltip so the operator
 * knows the number is approximate. A real billing dashboard would query the
 * provider's metering API — deferred to M6+ (`m5-followups.md`).
 *
 * Update procedure (low-friction):
 *  1. Bump `ANTHROPIC_PRICES_AS_OF` to today.
 *  2. Update the per-model entries.
 *  3. Commit as `chore: update Anthropic prices as of YYYY-MM-DD`.
 */

export const ANTHROPIC_PRICES_AS_OF = '2026-05-14';

interface ModelPrice {
  /** USD per 1M input tokens. */
  inputUsd: number;
  /** USD per 1M output tokens. */
  outputUsd: number;
}

/** Per-model price table. Keys match the Anthropic Messages API `model` field
 *  (the same string the renderer passes to `client.messages.stream`); unknown
 *  models fall back to the priciest known tier to err on the side of
 *  "warn earlier" rather than "underestimate". */
const ANTHROPIC_PRICES: Record<string, ModelPrice> = {
  'claude-opus-4-7': { inputUsd: 15.0, outputUsd: 75.0 },
  'claude-sonnet-4-6': { inputUsd: 3.0, outputUsd: 15.0 },
  'claude-haiku-4-5': { inputUsd: 0.8, outputUsd: 4.0 },
};

/** Soft cap (in summed input+output tokens) per conversation. The UI emits a
 *  warning chip at `CONVERSATION_WARN_THRESHOLD` × this; the cap is **soft**
 *  — it doesn't block sending, just nudges the operator. */
export const CONVERSATION_SOFT_CAP_TOKENS = 50_000;
export const CONVERSATION_WARN_THRESHOLD = 0.8;

export interface CostEstimate {
  /** USD. Approximate; see `ANTHROPIC_PRICES_AS_OF`. */
  usd: number;
  /** The model key that priced this estimate. `'unknown'` when the model id
   *  isn't in the table — caller should surface "unknown model" hint. */
  modelPriced: string;
  /** Always true in M5 v1 — see `ANTHROPIC_PRICES_AS_OF`. */
  approximate: true;
}

/** Estimate cost for one (model, input, output) triple. Returns USD with the
 *  approximate flag flipped on. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): CostEstimate {
  const price = ANTHROPIC_PRICES[model];
  const fallback: ModelPrice = ANTHROPIC_PRICES['claude-opus-4-7'] ?? {
    inputUsd: 15.0,
    outputUsd: 75.0,
  };
  const effective = price ?? fallback;
  const usd =
    (Math.max(0, inputTokens) / 1_000_000) * effective.inputUsd +
    (Math.max(0, outputTokens) / 1_000_000) * effective.outputUsd;
  return {
    usd,
    modelPriced: price ? model : 'unknown',
    approximate: true,
  };
}

/** Sum a stream of `{usage?}` carriers into a single running total. The
 *  conversation header chip + the session-spend widget both call this. */
export function sumUsage(
  entries: ReadonlyArray<{ usage?: { inputTokens: number; outputTokens: number } }>,
): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const e of entries) {
    if (!e.usage) continue;
    inputTokens += e.usage.inputTokens;
    outputTokens += e.usage.outputTokens;
  }
  return { inputTokens, outputTokens };
}

/** Format a USD cost — small absolute values get extra precision so a $0.003
 *  estimate doesn't read as "$0.00". */
export function formatUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format a token count compactly: `12,345` or `48.2k`. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

/** Where the conversation sits relative to the soft cap. Returned shape feeds
 *  the badge's colour + the warning copy. */
export function capStatus(totalTokens: number): 'ok' | 'warn' | 'over' {
  if (totalTokens >= CONVERSATION_SOFT_CAP_TOKENS) return 'over';
  if (totalTokens >= CONVERSATION_SOFT_CAP_TOKENS * CONVERSATION_WARN_THRESHOLD) return 'warn';
  return 'ok';
}
