import { describe, expect, it } from 'vitest';

import type { ToolHistoryEntry } from '@shared/domain/tool-history';

import { errorBreakdown, latencyStats, usageByTool } from './usage-stats';

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
  ts: '2026-05-13T00:00:00.000Z',
  durationMs: 10,
  ...over,
});

describe('usageByTool', () => {
  it('groups by toolName + splits ok/err + sorts by count desc', () => {
    const rows = usageByTool([
      entry({ toolName: 'a' }),
      entry({ toolName: 'a' }),
      entry({ toolName: 'a', status: 'error', result: null, error: { message: 'nope' } }),
      entry({ toolName: 'b' }),
      entry({ toolName: 'b', status: 'tool-error' }),
    ]);
    expect(rows).toEqual([
      { name: 'a', count: 3, okCount: 2, errCount: 1 },
      { name: 'b', count: 2, okCount: 1, errCount: 1 },
    ]);
  });

  it('tie-breaks on name (stable, alphabetical)', () => {
    const rows = usageByTool([entry({ toolName: 'b' }), entry({ toolName: 'a' })]);
    expect(rows.map((r) => r.name)).toEqual(['a', 'b']);
  });

  it('empty input → empty output', () => {
    expect(usageByTool([])).toEqual([]);
  });
});

describe('latencyStats', () => {
  it('computes avg / p50 / p95 per tool, sorted slowest-by-avg first', () => {
    const fast = [5, 5, 6, 7, 8].map((d) => entry({ toolName: 'fast', durationMs: d }));
    const slow = [100, 110, 120, 130, 200].map((d) => entry({ toolName: 'slow', durationMs: d }));
    const rows = latencyStats([...fast, ...slow]);
    expect(rows[0]).toMatchObject({ name: 'slow', count: 5, p50Ms: 120, p95Ms: 200 });
    expect(rows[0]!.avgMs).toBeCloseTo(132, 5);
    expect(rows[1]).toMatchObject({ name: 'fast', count: 5, p50Ms: 6, p95Ms: 8 });
    expect(rows[1]!.avgMs).toBeCloseTo(6.2, 5);
  });

  it('uses nearest-rank percentiles (no interpolation)', () => {
    const rows = latencyStats(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => entry({ toolName: 'x', durationMs: d })),
    );
    // p50 = ceil(0.5 * 10) - 1 = 4 → sorted[4] = 5
    expect(rows[0]?.p50Ms).toBe(5);
    // p95 = ceil(0.95 * 10) - 1 = 9 → sorted[9] = 10
    expect(rows[0]?.p95Ms).toBe(10);
  });

  it('drops entries whose duration isn\'t a finite number (defensive against malformed history)', () => {
    const rows = latencyStats([
      entry({ toolName: 'x', durationMs: 10 }),
      entry({ toolName: 'x', durationMs: Number.NaN }),
      entry({ toolName: 'x', durationMs: 30 }),
    ]);
    expect(rows[0]?.count).toBe(2);
    expect(rows[0]?.avgMs).toBe(20);
  });

  it('single-sample tool yields avg = p50 = p95 = the sample', () => {
    const rows = latencyStats([entry({ toolName: 'one', durationMs: 42 })]);
    expect(rows[0]).toMatchObject({ count: 1, avgMs: 42, p50Ms: 42, p95Ms: 42 });
  });
});

describe('errorBreakdown', () => {
  it('groups by code, lumps tool-reported isError as "tool-error"', () => {
    const rows = errorBreakdown([
      entry({ status: 'tool-error' }),
      entry({ status: 'tool-error' }),
      entry({ status: 'error', error: { code: -32602, message: 'bad args' } }),
      entry({ status: 'error', error: { code: -32602, message: 'also bad' } }),
      entry({ status: 'error', error: { code: -32010, message: 'auth' } }),
    ]);
    expect(rows).toEqual([
      { code: '-32602', label: '-32602', count: 2 },
      { code: 'tool-error', label: 'tool reported isError', count: 2 },
      { code: '-32010', label: '-32010', count: 1 },
    ]);
  });

  it('falls back to a generic "error" key when an `error` entry lacks a numeric code', () => {
    const rows = errorBreakdown([
      entry({ status: 'error', error: { message: 'transport down' } }),
      entry({ status: 'error', error: null }),
    ]);
    expect(rows).toEqual([{ code: 'error', label: 'uncoded error', count: 2 }]);
  });

  it('ignores ok entries entirely', () => {
    expect(errorBreakdown([entry({ status: 'ok' }), entry({ status: 'ok' })])).toEqual([]);
  });
});
