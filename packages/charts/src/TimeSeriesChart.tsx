import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { paletteColor } from './palette';
import type { TimeSeriesSeries } from './types';

export interface TimeSeriesChartProps {
  /** One or more series, each `{ name, points: {t, v}[] }`. Pre-downsample
   *  large series via {@link import('./downsample').downsampleTimeSeries} —
   *  this component renders what it's given. */
  series: readonly TimeSeriesSeries[];
  /** Pixel height; the parent controls width via flex / container. */
  height?: number;
  /** Hide the legend when the caller draws its own (e.g. a multi-history
   *  side panel). Default: shown when there are ≥ 2 series. */
  showLegend?: boolean;
  /** Override the x-axis formatter (defaults to a local-time `HH:MM` for
   *  short ranges, `MMM dd` for long ones). */
  formatTick?: (t: number) => string;
  /** Override the value formatter in the tooltip + legend. */
  formatValue?: (v: number) => string;
}

/**
 * A multi-series line chart over UNIX-ms timestamps. Renderless about layout
 * (parent controls width; height is a prop). Merges per-series `(t, v)`
 * pairs into a union-of-timestamps wide-format row so each series can have
 * its own native sampling cadence; missing values come through as `null`
 * (recharts renders the line with a gap). Used by the Niagara history view
 * (multi-history overlay), the live monitor's "detail" expansion, and the
 * M5 AI co-pilot's chat-inline trend.
 */
export function TimeSeriesChart({
  series,
  height = 240,
  showLegend,
  formatTick,
  formatValue,
}: TimeSeriesChartProps) {
  const { data, span } = useMemo(() => mergeSeries(series), [series]);
  const legendVisible = showLegend ?? series.length >= 2;
  const tickFmt = formatTick ?? defaultTickFormatter(span);
  const valueFmt = formatValue ?? defaultValueFormatter;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
        <XAxis
          dataKey="t"
          type="number"
          domain={['dataMin', 'dataMax']}
          scale="time"
          tickFormatter={tickFmt}
          tick={{ fontSize: 11 }}
        />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={valueFmt} width={48} />
        <Tooltip
          labelFormatter={(label) => tickFmt(Number(label))}
          formatter={(v: unknown) => (typeof v === 'number' ? valueFmt(v) : String(v))}
          contentStyle={{ fontSize: 12 }}
        />
        {legendVisible && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={s.color ?? paletteColor(i)}
            dot={false}
            strokeWidth={1.5}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

interface MergedRow {
  t: number;
  [name: string]: number | null;
}

/** Merge N series into a wide-format `[{t, <name1>: v, <name2>: v, …}]` over
 *  the union of timestamps, sorted ascending. Missing values are `null` so
 *  recharts can render the gap. */
export function mergeSeries(series: readonly TimeSeriesSeries[]): { data: MergedRow[]; span: number } {
  const byT = new Map<number, MergedRow>();
  for (const s of series) {
    for (const p of s.points) {
      let row = byT.get(p.t);
      if (!row) {
        row = { t: p.t };
        byT.set(p.t, row);
      }
      row[s.name] = p.v;
    }
  }
  const data = [...byT.values()].sort((a, b) => a.t - b.t);
  const span = data.length > 0 ? data[data.length - 1]!.t - data[0]!.t : 0;
  return { data, span };
}

function defaultTickFormatter(spanMs: number): (t: number) => string {
  // < 36 h → HH:MM ; otherwise → MMM d.
  if (spanMs < 36 * 3_600_000) {
    return (t) => {
      const d = new Date(t);
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    };
  }
  return (t) => {
    const d = new Date(t);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
}

function defaultValueFormatter(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
