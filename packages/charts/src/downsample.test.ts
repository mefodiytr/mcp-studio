import { describe, expect, it } from 'vitest';

import { downsampleTimeSeries } from './downsample';
import type { TimeSeriesPoint } from './types';

const series = (vs: (number | null)[]): TimeSeriesPoint[] => vs.map((v, i) => ({ t: i, v }));

describe('downsampleTimeSeries', () => {
  it('returns a copy of the input when length ≤ maxPoints', () => {
    const input = series([1, 2, 3, 4]);
    const out = downsampleTimeSeries(input, 10);
    expect(out).toEqual(input);
    expect(out).not.toBe(input); // a copy, not the same reference
  });

  it('returns [] when maxPoints ≤ 0', () => {
    expect(downsampleTimeSeries(series([1, 2, 3]), 0)).toEqual([]);
    expect(downsampleTimeSeries(series([1, 2, 3]), -5)).toEqual([]);
  });

  it('falls back to evenly-spaced samples when maxPoints < 4 (degenerate target)', () => {
    const out = downsampleTimeSeries(series([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 3);
    expect(out).toHaveLength(3);
    expect(out[0]?.v).toBe(0);
    expect(out[out.length - 1]?.v).toBe(9);
  });

  it('always keeps the first and last points (visual anchors)', () => {
    const input = series(Array.from({ length: 500 }, (_, i) => Math.sin(i / 10)));
    const out = downsampleTimeSeries(input, 50);
    expect(out[0]).toEqual(input[0]);
    expect(out[out.length - 1]).toEqual(input[input.length - 1]);
  });

  it('caps the output to roughly `maxPoints` (≤ maxPoints + a small bucket-rounding slop)', () => {
    const input = series(Array.from({ length: 1000 }, (_, i) => i));
    const out = downsampleTimeSeries(input, 100);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it('preserves spikes (the min/max within a bucket survives, where a plain mean would smooth them away)', () => {
    // A flat zero series with a single huge spike in the middle.
    const values = Array.from({ length: 1000 }, () => 0);
    values[500] = 999;
    const out = downsampleTimeSeries(series(values), 50);
    const hasSpike = out.some((p) => p.v === 999);
    expect(hasSpike).toBe(true);
  });

  it('skips null values from the min/max comparison; emits a placeholder for all-null buckets', () => {
    const values: (number | null)[] = Array.from({ length: 200 }, (_, i) => (i < 100 ? null : i));
    const out = downsampleTimeSeries(series(values), 20);
    // The first half is all-null — we still get one representative per bucket
    // (so the gap is visible) and the second half has real values.
    expect(out.some((p) => p.v === null)).toBe(true);
    expect(out.some((p) => typeof p.v === 'number')).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const snapshot = JSON.stringify(input);
    downsampleTimeSeries(input, 4);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
