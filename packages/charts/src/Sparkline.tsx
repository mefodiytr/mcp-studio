import { useMemo } from 'react';

import type { TimeSeriesPoint } from './types';

export interface SparklineProps {
  /** Polled point history — older first, newest last. Nulls become gaps. */
  points: readonly TimeSeriesPoint[];
  width?: number;
  height?: number;
  /** Defaults to the first palette colour. */
  color?: string;
  /** Optional band rendered behind the line when a value falls outside
   *  `[low, high]`. */
  threshold?: { low?: number; high?: number };
}

/**
 * A small inline trend, no axes / tooltip / legend — for the live monitor row
 * (~ width 80 × height 24 next to a value) and any future at-a-glance UI.
 * Hand-rolled SVG (recharts' ResponsiveContainer overhead is wasted on a 24-px
 * sparkline). Renderless about layout: width / height are pixel props.
 */
export function Sparkline({ points, width = 80, height = 24, color = '#2563eb', threshold }: SparklineProps) {
  const path = useMemo(() => buildPath(points, width, height), [points, width, height]);
  if (!path) return <svg width={width} height={height} aria-hidden role="img" />;

  const { d, exceedsThreshold } = applyThreshold(path, points, threshold);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden role="img">
      <path d={d} fill="none" stroke={exceedsThreshold ? '#ef4444' : color} strokeWidth={1.25} />
    </svg>
  );
}

interface BuiltPath {
  d: string;
  min: number;
  max: number;
}

function buildPath(points: readonly TimeSeriesPoint[], width: number, height: number): BuiltPath | null {
  const real = points.filter((p): p is TimeSeriesPoint & { v: number } => typeof p.v === 'number');
  if (real.length < 2) return null;
  let min = real[0]!.v;
  let max = real[0]!.v;
  for (const p of real) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  const range = max - min || 1;
  const tMin = real[0]!.t;
  const tMax = real[real.length - 1]!.t;
  const tRange = tMax - tMin || 1;
  let d = '';
  for (let i = 0; i < real.length; i++) {
    const p = real[i]!;
    const x = ((p.t - tMin) / tRange) * (width - 2) + 1;
    const y = height - 1 - ((p.v - min) / range) * (height - 2);
    d += i === 0 ? `M${x.toFixed(1)} ${y.toFixed(1)}` : ` L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return { d, min, max };
}

function applyThreshold(
  built: BuiltPath,
  points: readonly TimeSeriesPoint[],
  threshold: SparklineProps['threshold'],
): { d: string; exceedsThreshold: boolean } {
  if (!threshold) return { d: built.d, exceedsThreshold: false };
  const exceeds = points.some(
    (p) => typeof p.v === 'number' && ((threshold.low !== undefined && p.v < threshold.low) || (threshold.high !== undefined && p.v > threshold.high)),
  );
  return { d: built.d, exceedsThreshold: exceeds };
}
