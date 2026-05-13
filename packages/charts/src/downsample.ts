import type { TimeSeriesPoint } from './types';

/**
 * Reduce a time-series to at most `maxPoints` points while preserving the
 * visual envelope. M4 v1 ships a simple **min/max bucketed** reducer: split
 * the series into roughly `maxPoints / 2` index-uniform buckets and emit two
 * points per bucket — the one with the smallest `v` and the one with the
 * largest — in their original (t, v) form. This keeps spikes and dips that a
 * plain bucketed mean would smooth away, at the cost of slight "fattening"
 * of clean stretches. The first and last points are always kept.
 *
 * A true LTTB (Largest Triangle Three Buckets) implementation is a follow-up
 * if the rougher envelope ever shows visual artefacts (m4-followups). Nulls
 * are passed through if they fall on a bucket boundary, otherwise skipped
 * from the min/max comparison.
 *
 * Pure; never mutates its input.
 */
export function downsampleTimeSeries(points: readonly TimeSeriesPoint[], maxPoints: number): TimeSeriesPoint[] {
  if (maxPoints <= 0) return [];
  const n = points.length;
  if (n <= maxPoints) return points.slice();
  if (maxPoints < 4) {
    // Degenerate target — just keep evenly-spaced samples.
    const step = (n - 1) / (maxPoints - 1);
    const out: TimeSeriesPoint[] = [];
    for (let i = 0; i < maxPoints; i++) out.push(points[Math.round(i * step)]!);
    return out;
  }

  // Reserve the first + last points (visual anchors); the middle is bucketed.
  const middleBudget = maxPoints - 2;
  const bucketCount = Math.max(1, Math.floor(middleBudget / 2));
  const bucketSize = (n - 2) / bucketCount;

  const result: TimeSeriesPoint[] = [points[0]!];
  for (let b = 0; b < bucketCount; b++) {
    const start = 1 + Math.floor(b * bucketSize);
    const end = 1 + Math.floor((b + 1) * bucketSize); // exclusive
    let minIdx = -1;
    let maxIdx = -1;
    for (let i = start; i < end; i++) {
      const v = points[i]!.v;
      if (v === null) continue;
      if (minIdx < 0 || v < points[minIdx]!.v!) minIdx = i;
      if (maxIdx < 0 || v > points[maxIdx]!.v!) maxIdx = i;
    }
    if (minIdx < 0 && maxIdx < 0) {
      // All-null bucket — emit one representative so the gap is visible.
      result.push(points[start]!);
      continue;
    }
    if (minIdx === maxIdx) {
      result.push(points[minIdx]!);
    } else if (minIdx < maxIdx) {
      result.push(points[minIdx]!, points[maxIdx]!);
    } else {
      result.push(points[maxIdx]!, points[minIdx]!);
    }
  }
  result.push(points[n - 1]!);
  return result;
}
