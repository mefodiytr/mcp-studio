import type { PluginContext } from '@mcp-studio/plugin-api';
import { describe, expect, it } from 'vitest';

import { extractRecords, presetRange, readHistory } from './niagara-history';

function fakeCtx(callTool: PluginContext['callTool']): PluginContext {
  return { connection: { connectionId: 'c1', profileId: 'p1', serverInfo: null, status: 'connected' }, callTool } as PluginContext;
}

describe('extractRecords', () => {
  it('parses the `records` array with `t`/`v` epoch-ms fields', () => {
    const out = extractRecords({
      records: [
        { t: 1_700_000_000_000, v: 1 },
        { t: 1_700_000_060_000, v: 2 },
      ],
    });
    expect(out).toEqual([
      { t: 1_700_000_000_000, v: 1 },
      { t: 1_700_000_060_000, v: 2 },
    ]);
  });

  it('accepts `points` and `samples` array names too', () => {
    expect(extractRecords({ points: [{ t: 1, v: 1 }] })).toEqual([{ t: 1, v: 1 }]);
    expect(extractRecords({ samples: [{ t: 1, v: 1 }] })).toEqual([{ t: 1, v: 1 }]);
  });

  it('accepts `ts` / `timestamp` and `value` field-name variants', () => {
    expect(extractRecords({ records: [{ ts: 1, value: 5 }] })).toEqual([{ t: 1, v: 5 }]);
    expect(extractRecords({ records: [{ timestamp: 1, v: 5 }] })).toEqual([{ t: 1, v: 5 }]);
  });

  it('parses ISO datetime strings to epoch ms', () => {
    const out = extractRecords({ records: [{ t: '2026-05-13T12:00:00.000Z', v: 1 }] });
    expect(out[0]?.t).toBe(Date.parse('2026-05-13T12:00:00.000Z'));
  });

  it('parses a numeric-string timestamp as epoch ms', () => {
    expect(extractRecords({ records: [{ t: '1700000000000', v: 1 }] })).toEqual([{ t: 1_700_000_000_000, v: 1 }]);
  });

  it('coerces booleans → 0/1 (boolean histories) and bad values to null gap', () => {
    expect(extractRecords({ records: [{ t: 1, v: true }, { t: 2, v: false }, { t: 3, v: 'NaN' }] })).toEqual([
      { t: 1, v: 1 },
      { t: 2, v: 0 },
      { t: 3, v: null },
    ]);
  });

  it('drops records without a parseable timestamp', () => {
    expect(extractRecords({ records: [{ v: 1 }, { t: 'not-a-date', v: 1 }, { t: 5, v: 5 }] })).toEqual([{ t: 5, v: 5 }]);
  });

  it('sorts the output ascending by t (in case the server returns out of order)', () => {
    expect(extractRecords({ records: [{ t: 3, v: 'c' }, { t: 1, v: 'a' }, { t: 2, v: 'b' }] }).map((r) => r.t)).toEqual([1, 2, 3]);
  });

  it('returns [] when no records list is present', () => {
    expect(extractRecords({ ord: 'x' })).toEqual([]);
    expect(extractRecords({})).toEqual([]);
  });
});

describe('readHistory', () => {
  it('passes ord/from/to/aggregation/limit through and normalises numeric `from`/`to` to ISO', async () => {
    const seen: Record<string, unknown>[] = [];
    const ctx = fakeCtx(async (name, args) => {
      seen.push({ name, args });
      return { structuredContent: { ord: 'x', records: [{ t: 1, v: 1 }] } };
    });
    await readHistory(ctx, { ord: 'x', from: 1_700_000_000_000, to: 1_700_000_060_000, aggregation: 'avg', limit: 500 });
    expect(seen[0]?.['name']).toBe('readHistory');
    expect(seen[0]?.['args']).toEqual({
      ord: 'x',
      from: new Date(1_700_000_000_000).toISOString(),
      to: new Date(1_700_000_060_000).toISOString(),
      aggregation: 'avg',
      limit: 500,
    });
  });

  it('forwards a string `from` verbatim (operator-typed ISO)', async () => {
    let seenArgs: Record<string, unknown> | undefined;
    const ctx = fakeCtx(async (_name, args) => {
      seenArgs = args;
      return { structuredContent: { records: [] } };
    });
    await readHistory(ctx, { ord: 'x', from: '2026-05-13T00:00:00Z' });
    expect(seenArgs?.['from']).toBe('2026-05-13T00:00:00Z');
    expect(seenArgs).not.toHaveProperty('to');
    expect(seenArgs).not.toHaveProperty('aggregation');
    expect(seenArgs).not.toHaveProperty('limit');
  });

  it('returns { points, raw, truncated, rowCount } from the response', async () => {
    const ctx = fakeCtx(async () => ({
      structuredContent: {
        ord: 'station:|slot:/Logic/Sensor1',
        records: Array.from({ length: 50 }, (_, i) => ({ t: i, v: Math.sin(i / 5) })),
        truncated: false,
      },
    }));
    const out = await readHistory(ctx, { ord: 'station:|slot:/Logic/Sensor1', from: 0 });
    expect(out.ord).toBe('station:|slot:/Logic/Sensor1');
    expect(out.rowCount).toBe(50);
    expect(out.raw).toHaveLength(50);
    // 50 ≤ display default 2000 → no downsampling.
    expect(out.points).toHaveLength(50);
    expect(out.truncated).toBe(false);
  });

  it('downsamples to `display` when the raw series is larger', async () => {
    const ctx = fakeCtx(async () => ({
      structuredContent: { records: Array.from({ length: 5000 }, (_, i) => ({ t: i, v: i % 100 })) },
    }));
    const out = await readHistory(ctx, { ord: 'x', from: 0 }, { display: 100 });
    expect(out.rowCount).toBe(5000);
    expect(out.points.length).toBeLessThanOrEqual(100);
    expect(out.raw).toHaveLength(5000);
  });

  it('flags `truncated` when either truncated or isTruncated is true', async () => {
    let payload = { records: [{ t: 1, v: 1 }], truncated: true };
    let ctx = fakeCtx(async () => ({ structuredContent: payload }));
    expect((await readHistory(ctx, { ord: 'x', from: 0 })).truncated).toBe(true);
    payload = { records: [{ t: 1, v: 1 }], isTruncated: true } as unknown as typeof payload;
    ctx = fakeCtx(async () => ({ structuredContent: payload }));
    expect((await readHistory(ctx, { ord: 'x', from: 0 })).truncated).toBe(true);
  });
});

describe('presetRange', () => {
  it('returns a [now - preset-ms, now] window', () => {
    const now = 1_700_000_000_000;
    expect(presetRange('1h', now)).toEqual({ from: now - 3_600_000, to: now });
    expect(presetRange('4h', now)).toEqual({ from: now - 4 * 3_600_000, to: now });
    expect(presetRange('1d', now)).toEqual({ from: now - 24 * 3_600_000, to: now });
    expect(presetRange('7d', now)).toEqual({ from: now - 7 * 24 * 3_600_000, to: now });
    expect(presetRange('30d', now)).toEqual({ from: now - 30 * 24 * 3_600_000, to: now });
  });
});
