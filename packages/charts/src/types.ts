/**
 * Shared shapes for the chart primitives — `t` is a UNIX-ms timestamp, `v` is
 * the value (nullable for gaps in the series).
 */
export interface TimeSeriesPoint {
  t: number;
  v: number | null;
}

export interface TimeSeriesSeries {
  /** Display name; used in the legend + tooltip. */
  name: string;
  /** Optional CSS color (any recharts-acceptable string); rotated through a
   *  palette per-index when absent. */
  color?: string;
  points: TimeSeriesPoint[];
}

export interface BarChartItem {
  label: string;
  value: number;
  /** Optional CSS color; defaults rotate through a palette per-index. */
  color?: string;
}
