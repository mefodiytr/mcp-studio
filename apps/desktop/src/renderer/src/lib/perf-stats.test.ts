import type { ToolHistoryEntry } from '@shared/domain/tool-history';
import { describe, expect, it } from 'vitest';

import { latencyHistogram, p95DeltaOverWindows, slowestN } from './perf-stats';

const entry = (over: Partial<ToolHistoryEntry>): ToolHistoryEntry => ({
  id: 'id',
  connectionId: 'c1',
  profileId: 'p1',
  serverName: 'niagaramcp',
  toolName: 'listChildren',
  args: {},
  status: 'ok',
  result: null,
  error: null,
  ts: '2026-05-13T12:00:00.000Z',
  durationMs: 10,
  ...over,
});

describe('latencyHistogram', () => {
  it('always returns all 7 buckets in order, even when empty', () => {
    const bins = latencyHistogram([]);
    expect(bins.map((b) => b.label)).toEqual([
      '< 10 ms', '10–50 ms', '50–100 ms', '100–500 ms', '500 ms–1 s', '1–5 s', '> 5 s',
    ]);
    expect(bins.every((b) => b.count === 0)).toBe(true);
  });

  it('places entries into the right log-ish bucket', () => {
    const bins = latencyHistogram([
      entry({ durationMs: 5 }),
      entry({ durationMs: 10 }), // boundary: lands in 10–50
      entry({ durationMs: 49 }),
      entry({ durationMs: 50 }), // boundary: lands in 50–100
      entry({ durationMs: 250 }),
      entry({ durationMs: 1500 }),
      entry({ durationMs: 9000 }), // tail bucket
    ]);
    const counts = bins.map((b) => b.count);
    expect(counts).toEqual([1, 2, 1, 1, 0, 1, 1]);
  });

  it('skips non-finite durations defensively', () => {
    const bins = latencyHistogram([
      entry({ durationMs: 5 }),
      entry({ durationMs: Number.NaN }),
      entry({ durationMs: Number.POSITIVE_INFINITY }),
    ]);
    expect(bins[0]?.count).toBe(1);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(1);
  });
});

describe('slowestN', () => {
  it('returns top N by duration desc; ties broken by ts (newer first)', () => {
    const xs = [
      entry({ id: 'a', durationMs: 50, ts: '2026-05-13T01:00:00Z' }),
      entry({ id: 'b', durationMs: 200, ts: '2026-05-13T02:00:00Z' }),
      entry({ id: 'c', durationMs: 200, ts: '2026-05-13T03:00:00Z' }),
      entry({ id: 'd', durationMs: 30, ts: '2026-05-13T04:00:00Z' }),
    ];
    const out = slowestN(xs, 3);
    expect(out.map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('returns at most N', () => {
    const out = slowestN([entry({ id: 'a' })], 10);
    expect(out).toHaveLength(1);
  });

  it('does not mutate its input', () => {
    const xs = [entry({ durationMs: 5 }), entry({ durationMs: 50 })];
    const snapshot = xs.map((e) => e.durationMs).join(',');
    slowestN(xs);
    expect(xs.map((e) => e.durationMs).join(',')).toBe(snapshot);
  });

  it('skips non-finite durations', () => {
    const out = slowestN([entry({ durationMs: 100 }), entry({ durationMs: Number.NaN })]);
    expect(out).toHaveLength(1);
  });
});

describe('p95DeltaOverWindows', () => {
  const NOW = Date.parse('2026-05-13T12:00:00.000Z');
  const ts = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

  it('computes p95 over the recent + previous windows + the delta', () => {
    // Recent window: last 1h; previous: 1h before that.
    const recent = [10, 20, 30, 40, 200].map((d, i) => entry({ id: `c${i}`, durationMs: d, ts: ts(30 * 60_000) }));
    const prev = [10, 20, 30, 40, 100].map((d, i) => entry({ id: `p${i}`, durationMs: d, ts: ts(90 * 60_000) }));
    const stats = p95DeltaOverWindows([...recent, ...prev], 3_600_000, NOW);
    expect(stats.currCount).toBe(5);
    expect(stats.prevCount).toBe(5);
    expect(stats.currP95Ms).toBe(200);
    expect(stats.prevP95Ms).toBe(100);
    expect(stats.deltaRatio).toBe(1); // +100 %
    expect(stats.regression).toBe(true);
  });

  it('flags `regression` when deltaRatio crosses the threshold (default 25 %)', () => {
    const ents = [
      entry({ durationMs: 100, ts: ts(30 * 60_000) }), // curr
      entry({ durationMs: 100, ts: ts(90 * 60_000) }), // prev — same p95
    ];
    expect(p95DeltaOverWindows(ents, 3_600_000, NOW).regression).toBe(false);
    const ents2 = [
      entry({ durationMs: 200, ts: ts(30 * 60_000) }),
      entry({ durationMs: 100, ts: ts(90 * 60_000) }),
    ];
    expect(p95DeltaOverWindows(ents2, 3_600_000, NOW).regression).toBe(true);
  });

  it('returns nulls when a window is empty', () => {
    const stats = p95DeltaOverWindows([entry({ durationMs: 100, ts: ts(30 * 60_000) })], 3_600_000, NOW);
    expect(stats.currP95Ms).toBe(100);
    expect(stats.prevP95Ms).toBeNull();
    expect(stats.deltaRatio).toBeNull();
    expect(stats.regression).toBe(false);
  });

  it('ignores entries outside both windows', () => {
    const stats = p95DeltaOverWindows(
      [
        entry({ durationMs: 100, ts: ts(10 * 3_600_000) }), // 10 h ago — outside
        entry({ durationMs: 200, ts: ts(30 * 60_000) }), // in curr
      ],
      3_600_000,
      NOW,
    );
    expect(stats.currCount).toBe(1);
    expect(stats.prevCount).toBe(0);
  });
});
