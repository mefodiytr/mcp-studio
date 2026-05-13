import { describe, expect, it } from 'vitest';

import { mergeSeries } from './TimeSeriesChart';
import type { TimeSeriesSeries } from './types';

const s = (name: string, pts: [number, number | null][]): TimeSeriesSeries => ({
  name,
  points: pts.map(([t, v]) => ({ t, v })),
});

describe('mergeSeries', () => {
  it('merges N series over the union of timestamps, sorted ascending', () => {
    const { data, span } = mergeSeries([s('a', [[1, 10], [3, 30]]), s('b', [[2, 20], [3, 33]])]);
    expect(data).toEqual([
      { t: 1, a: 10 },
      { t: 2, b: 20 },
      { t: 3, a: 30, b: 33 },
    ]);
    expect(span).toBe(2);
  });

  it('preserves nulls (gaps in a series come through as null on that key)', () => {
    const { data } = mergeSeries([s('a', [[1, 10], [2, null], [3, 30]])]);
    expect(data).toEqual([
      { t: 1, a: 10 },
      { t: 2, a: null },
      { t: 3, a: 30 },
    ]);
  });

  it('empty input → empty data, zero span', () => {
    expect(mergeSeries([])).toEqual({ data: [], span: 0 });
    expect(mergeSeries([s('a', [])])).toEqual({ data: [], span: 0 });
  });

  it('a single timestamp across series collapses to one row', () => {
    const { data, span } = mergeSeries([s('a', [[5, 1]]), s('b', [[5, 2]])]);
    expect(data).toEqual([{ t: 5, a: 1, b: 2 }]);
    expect(span).toBe(0);
  });
});
