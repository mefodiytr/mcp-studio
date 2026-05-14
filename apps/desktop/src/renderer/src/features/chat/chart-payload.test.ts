import { describe, expect, it } from 'vitest';

import { parseChartPayload } from './chart-payload';

const goodPayload = {
  type: 'timeseries',
  title: 'SAT trend',
  series: [
    {
      name: 'SAT',
      points: [
        { t: '2026-05-14T09:00:00Z', v: 21.2 },
        { t: '2026-05-14T09:01:00Z', v: 21.4 },
        { t: '2026-05-14T09:02:00Z', v: 21.5 },
      ],
    },
  ],
};

describe('parseChartPayload — D8 chart code-fence parsing', () => {
  it('round-trips a well-formed payload, normalising ISO timestamps to UNIX ms', () => {
    const outcome = parseChartPayload(JSON.stringify(goodPayload));
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.payload.title).toBe('SAT trend');
    expect(outcome.normalisedSeries).toHaveLength(1);
    const points = outcome.normalisedSeries[0]?.points;
    expect(points?.[0]?.t).toBe(Date.parse('2026-05-14T09:00:00Z'));
    expect(points?.[1]?.v).toBe(21.4);
  });

  it('accepts epoch-ms timestamps directly (the M4 history wrapper convention)', () => {
    const t0 = Date.parse('2026-05-14T09:00:00Z');
    const outcome = parseChartPayload(
      JSON.stringify({
        type: 'timeseries',
        series: [
          { name: 'x', points: [{ t: t0, v: 1 }, { t: t0 + 60_000, v: 2 }] },
        ],
      }),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.normalisedSeries[0]?.points[0]?.t).toBe(t0);
  });

  it('preserves null gaps (recharts renders these as line breaks)', () => {
    const outcome = parseChartPayload(
      JSON.stringify({
        type: 'timeseries',
        series: [
          {
            name: 'x',
            points: [
              { t: 1000, v: 1 },
              { t: 2000, v: null },
              { t: 3000, v: 3 },
            ],
          },
        ],
      }),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.normalisedSeries[0]?.points[1]?.v).toBeNull();
  });

  it('drops points with unparseable ISO strings (defensive — same shape as the M4 wrapper)', () => {
    const outcome = parseChartPayload(
      JSON.stringify({
        type: 'timeseries',
        series: [
          {
            name: 'x',
            points: [
              { t: '2026-05-14T09:00:00Z', v: 1 },
              { t: 'not-a-date', v: 2 },
              { t: '2026-05-14T09:01:00Z', v: 3 },
            ],
          },
        ],
      }),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.normalisedSeries[0]?.points).toHaveLength(2);
  });

  it('sorts series points by timestamp (LLM may emit out-of-order)', () => {
    const outcome = parseChartPayload(
      JSON.stringify({
        type: 'timeseries',
        series: [
          {
            name: 'x',
            points: [
              { t: 3000, v: 3 },
              { t: 1000, v: 1 },
              { t: 2000, v: 2 },
            ],
          },
        ],
      }),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    const ts = outcome.normalisedSeries[0]?.points.map((p) => p.t);
    expect(ts).toEqual([1000, 2000, 3000]);
  });

  it('downsamples series with > 500 points + reports truncation', () => {
    const points = Array.from({ length: 1500 }, (_, i) => ({ t: i * 1000, v: Math.sin(i / 50) }));
    const outcome = parseChartPayload(
      JSON.stringify({ type: 'timeseries', series: [{ name: 'big', points }] }),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.normalisedSeries[0]?.points.length).toBeLessThanOrEqual(500);
    expect(outcome.truncated).toEqual([
      expect.objectContaining({ name: 'big', from: 1500 }),
    ]);
  });

  it('does not report truncation for already-small series', () => {
    const outcome = parseChartPayload(JSON.stringify(goodPayload));
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.truncated).toEqual([]);
  });

  it('falls back with "oversized" when the payload exceeds 256 kB', () => {
    const big = 'x'.repeat(257 * 1024);
    const outcome = parseChartPayload(big);
    expect(outcome.kind).toBe('fallback');
    if (outcome.kind !== 'fallback') return;
    expect(outcome.reason).toBe('oversized');
  });

  it('falls back with "json-error" on malformed JSON', () => {
    const outcome = parseChartPayload('{not: valid json,');
    expect(outcome.kind).toBe('fallback');
    if (outcome.kind !== 'fallback') return;
    expect(outcome.reason).toBe('json-error');
  });

  it('falls back with "schema-error" on a missing `type`', () => {
    const outcome = parseChartPayload(JSON.stringify({ series: [] }));
    expect(outcome.kind).toBe('fallback');
    if (outcome.kind !== 'fallback') return;
    expect(outcome.reason).toBe('schema-error');
  });

  it('falls back with "schema-error" on an unknown chart `type` (extensibility safety net)', () => {
    const outcome = parseChartPayload(
      JSON.stringify({ type: 'bar', series: [{ name: 'x', points: [{ t: 1, v: 1 }] }] }),
    );
    expect(outcome.kind).toBe('fallback');
    if (outcome.kind !== 'fallback') return;
    expect(outcome.reason).toBe('schema-error');
  });

  it('falls back with "no-points" when every series has zero parseable timestamps', () => {
    const outcome = parseChartPayload(
      JSON.stringify({
        type: 'timeseries',
        series: [{ name: 'broken', points: [{ t: 'still not a date', v: 1 }] }],
      }),
    );
    expect(outcome.kind).toBe('fallback');
    if (outcome.kind !== 'fallback') return;
    expect(outcome.reason).toBe('no-points');
  });

  it('falls back with "schema-error" when series is empty (zod min(1) guard)', () => {
    const outcome = parseChartPayload(JSON.stringify({ type: 'timeseries', series: [] }));
    expect(outcome.kind).toBe('fallback');
    if (outcome.kind !== 'fallback') return;
    expect(outcome.reason).toBe('schema-error');
  });

  it('honours an explicit color on a series', () => {
    const outcome = parseChartPayload(
      JSON.stringify({
        type: 'timeseries',
        series: [{ name: 'x', color: '#ff0000', points: [{ t: 1, v: 1 }] }],
      }),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.normalisedSeries[0]?.color).toBe('#ff0000');
  });
});
