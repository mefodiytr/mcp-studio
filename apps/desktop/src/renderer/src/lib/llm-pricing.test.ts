import { describe, expect, it } from 'vitest';

import {
  ANTHROPIC_PRICES_AS_OF,
  CONVERSATION_SOFT_CAP_TOKENS,
  CONVERSATION_WARN_THRESHOLD,
  capStatus,
  estimateCost,
  formatTokens,
  formatUsd,
  sumUsage,
} from './llm-pricing';

describe('estimateCost', () => {
  it('prices a Sonnet conversation at the table rate', () => {
    const out = estimateCost('claude-sonnet-4-6', 1_000_000, 500_000);
    // 1M @ $3 + 0.5M @ $15 = $3 + $7.5 = $10.50
    expect(out.usd).toBeCloseTo(10.5, 5);
    expect(out.modelPriced).toBe('claude-sonnet-4-6');
    expect(out.approximate).toBe(true);
  });

  it('prices an Opus conversation at the table rate', () => {
    const out = estimateCost('claude-opus-4-7', 100_000, 50_000);
    // 100k @ $15/M + 50k @ $75/M = $1.50 + $3.75 = $5.25
    expect(out.usd).toBeCloseTo(5.25, 5);
    expect(out.modelPriced).toBe('claude-opus-4-7');
  });

  it('prices a Haiku conversation at the table rate', () => {
    const out = estimateCost('claude-haiku-4-5', 1_000_000, 1_000_000);
    expect(out.usd).toBeCloseTo(4.8, 5); // $0.8 + $4
    expect(out.modelPriced).toBe('claude-haiku-4-5');
  });

  it('falls back to the priciest tier for unknown models + marks `modelPriced: unknown`', () => {
    const out = estimateCost('claude-future-9', 100_000, 50_000);
    // Falls back to opus pricing — same as the opus test, but `modelPriced` differs.
    expect(out.usd).toBeCloseTo(5.25, 5);
    expect(out.modelPriced).toBe('unknown');
  });

  it('handles zero tokens (no cost)', () => {
    const out = estimateCost('claude-opus-4-7', 0, 0);
    expect(out.usd).toBe(0);
  });

  it('clamps negative token counts to zero (defensive — shouldn\'t happen but)', () => {
    const out = estimateCost('claude-opus-4-7', -100, -50);
    expect(out.usd).toBe(0);
  });
});

describe('sumUsage', () => {
  it('sums input + output tokens across messages, ignoring entries without usage', () => {
    const out = sumUsage([
      { usage: { inputTokens: 100, outputTokens: 20 } },
      {}, // no usage — skipped
      { usage: { inputTokens: 50, outputTokens: 10 } },
    ]);
    expect(out).toEqual({ inputTokens: 150, outputTokens: 30 });
  });

  it('returns 0/0 for an empty array', () => {
    expect(sumUsage([])).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe('formatTokens', () => {
  it('shows raw count under 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('shows N.Nk between 1k and 100k', () => {
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(48_200)).toBe('48.2k');
  });

  it('shows Nk (rounded) above 100k', () => {
    expect(formatTokens(120_000)).toBe('120k');
    expect(formatTokens(1_500_000)).toBe('1500k');
  });
});

describe('formatUsd', () => {
  it('shows 4 decimals under $0.01', () => {
    expect(formatUsd(0.003)).toBe('$0.0030');
  });

  it('shows 3 decimals between $0.01 and $1', () => {
    expect(formatUsd(0.42)).toBe('$0.420');
  });

  it('shows 2 decimals above $1', () => {
    expect(formatUsd(12.345)).toBe('$12.35');
  });
});

describe('capStatus + cap constants', () => {
  it('soft cap is 50000 tokens; warn threshold 80% (40000)', () => {
    expect(CONVERSATION_SOFT_CAP_TOKENS).toBe(50_000);
    expect(CONVERSATION_WARN_THRESHOLD).toBe(0.8);
  });

  it('returns "ok" below 80%', () => {
    expect(capStatus(0)).toBe('ok');
    expect(capStatus(39_999)).toBe('ok');
  });

  it('returns "warn" at 80%–100%', () => {
    expect(capStatus(40_000)).toBe('warn');
    expect(capStatus(49_999)).toBe('warn');
  });

  it('returns "over" at 100%+', () => {
    expect(capStatus(50_000)).toBe('over');
    expect(capStatus(1_000_000)).toBe('over');
  });
});

describe('ANTHROPIC_PRICES_AS_OF', () => {
  it('is a parseable date for the UI disclaimer', () => {
    expect(Number.isFinite(Date.parse(ANTHROPIC_PRICES_AS_OF))).toBe(true);
  });
});
