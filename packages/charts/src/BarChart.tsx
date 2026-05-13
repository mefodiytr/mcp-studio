import { Bar, BarChart as RechartsBarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { paletteColor } from './palette';
import type { BarChartItem } from './types';

export interface BarChartProps {
  items: readonly BarChartItem[];
  /** Pixel height; parent controls width via flex / container. */
  height?: number;
  /** Default `vertical` (bars rise from the x-axis). `horizontal` shows label
   *  on the y-axis and the bar extending right — better when labels are long
   *  (tool names, error codes). */
  orientation?: 'vertical' | 'horizontal';
  /** Custom value formatter for the tooltip + axis ticks. */
  valueFormat?: (v: number) => string;
}

/**
 * A small bar chart for the tool-usage / per-tool latency / error-breakdown
 * views. Renderless about layout (parent controls width; height is a prop).
 * Items without an explicit `color` rotate through the default palette by
 * index — same palette as the other primitives so a multi-view UI feels
 * consistent.
 */
export function BarChart({ items, height = 200, orientation = 'vertical', valueFormat }: BarChartProps) {
  const fmt = valueFormat ?? ((v: number) => v.toLocaleString());
  const horizontal = orientation === 'horizontal';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={items as BarChartItem[]}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 16, left: horizontal ? 8 : 0, bottom: 4 }}
      >
        {horizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmt} />
            <YAxis dataKey="label" type="category" tick={{ fontSize: 11 }} width={100} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" type="category" tick={{ fontSize: 11 }} />
            <YAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmt} width={48} />
          </>
        )}
        <Tooltip formatter={(v: unknown) => (typeof v === 'number' ? fmt(v) : String(v))} contentStyle={{ fontSize: 12 }} />
        <Bar dataKey="value" isAnimationActive={false}>
          {items.map((item, i) => (
            <Cell key={item.label} fill={item.color ?? paletteColor(i)} />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
