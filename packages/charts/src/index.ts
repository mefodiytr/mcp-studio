/**
 * `@mcp-studio/charts` — renderless-about-layout chart primitives shared by:
 *   - the Niagara plugin's History + Monitor views (M4),
 *   - the host's Tool-usage + Performance views (M4),
 *   - the M5 AI co-pilot's chat-inline trend renderer
 *     (see `docs/handover.md` Part 2 §A — rooftop diagnosis).
 *
 * The components are thin recharts wrappers (plus a hand-rolled SVG sparkline);
 * the parent controls width via flex / container, height is a pixel prop. No
 * domain knowledge — `downsampleTimeSeries` lives here so consumers cap large
 * series at the edge.
 */
export { TimeSeriesChart, type TimeSeriesChartProps, mergeSeries } from './TimeSeriesChart';
export { Sparkline, type SparklineProps } from './Sparkline';
export { BarChart, type BarChartProps } from './BarChart';
export { downsampleTimeSeries } from './downsample';
export { paletteColor, DEFAULT_PALETTE } from './palette';
export type { TimeSeriesPoint, TimeSeriesSeries, BarChartItem } from './types';
