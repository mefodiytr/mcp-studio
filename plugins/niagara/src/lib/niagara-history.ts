import type { PluginContext } from '@mcp-studio/plugin-api';
import { downsampleTimeSeries, type TimeSeriesPoint } from '@mcp-studio/charts';

import { payload } from './niagara-api';

/**
 * Defensively-typed wrapper over niagaramcp's `readHistory` tool. The exact
 * response shape isn't recorded as a fixture yet (the C67 mock handler will
 * pin it) — this wrapper accepts either `records` or `points`/`samples` as
 * the array name, both `t`/`ts`/`timestamp` for the time field (ISO datetime
 * *or* epoch ms — niagaramcp's input spec accepts both), and either `v`/`value`
 * for the value. Anything that doesn't parse cleanly becomes a `null` point
 * (rendered as a gap by the chart). Throws on transport / `isError` per the
 * M2 unwrap convention.
 *
 * The result is **already downsampled** to ≤ `display` points (default 2000)
 * via {@link import('@mcp-studio/charts').downsampleTimeSeries} — Rec
 * h
 * arts SVG drags past a few thousand SVG nodes per series, so consumers get a
 * pre-capped series. The `raw` array is the full parsed series before the
 * downsample, in case the table dual-view wants to paginate the original.
 */
export type AggregationMode = 'none' | 'avg' | 'min' | 'max' | 'count';

export interface ReadHistoryArgs {
  ord: string;
  /** ISO datetime or epoch ms. */
  from: string | number;
  /** ISO datetime or epoch ms; defaults to "now" on the server. */
  to?: string | number;
  aggregation?: AggregationMode;
  /** Server-side row cap (default 1000, max 10000 per niagaramcp). */
  limit?: number;
}

export interface HistoryResult {
  ord: string;
  /** Downsampled (LTTB-ish min/max) points ≤ `display`. */
  points: TimeSeriesPoint[];
  /** Full parsed series — what the table dual-view paginates. */
  raw: TimeSeriesPoint[];
  /** True when niagaramcp truncated (over `limit` or the 10 s iteration cap). */
  truncated: boolean;
  /** Number of rows the server actually returned (pre-downsample). */
  rowCount: number;
}

const DEFAULT_DISPLAY = 2000;

export async function readHistory(
  ctx: PluginContext,
  args: ReadHistoryArgs,
  opts: { display?: number } = {},
): Promise<HistoryResult> {
  const display = opts.display ?? DEFAULT_DISPLAY;
  const toolArgs: Record<string, unknown> = {
    ord: args.ord,
    from: typeof args.from === 'number' ? new Date(args.from).toISOString() : args.from,
  };
  if (args.to !== undefined) toolArgs['to'] = typeof args.to === 'number' ? new Date(args.to).toISOString() : args.to;
  if (args.aggregation !== undefined) toolArgs['aggregation'] = args.aggregation;
  if (args.limit !== undefined) toolArgs['limit'] = args.limit;
  const p = payload(await ctx.callTool('readHistory', toolArgs));
  const raw = extractRecords(p);
  const truncated = p['truncated'] === true || p['isTruncated'] === true;
  const points = downsampleTimeSeries(raw, display);
  return { ord: typeof p['ord'] === 'string' ? p['ord'] : args.ord, points, raw, truncated, rowCount: raw.length };
}

/** Pull (t, v) pairs out of niagaramcp's response, tolerating the field-name
 *  variants the server might use. Bad / missing values become `null` (rendered
 *  as a gap by the chart). Sorts the result ascending by `t`. */
export function extractRecords(p: Record<string, unknown>): TimeSeriesPoint[] {
  const list =
    (Array.isArray(p['records']) && p['records']) ||
    (Array.isArray(p['points']) && p['points']) ||
    (Array.isArray(p['samples']) && p['samples']) ||
    [];
  const out: TimeSeriesPoint[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const t = parseTimestamp(r['t'] ?? r['ts'] ?? r['timestamp']);
    if (t === null) continue;
    const v = parseNumeric(r['v'] ?? r['value']);
    out.push({ t, v });
  }
  return out.sort((a, b) => a.t - b.t);
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    // Treat a pure digit string as epoch ms; otherwise try Date parse.
    if (/^\d+$/.test(value)) {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  // booleans → 0/1 (some niagaramcp boolean histories return true/false).
  if (typeof value === 'boolean') return value ? 1 : 0;
  return null;
}

/** Helpers for the range picker — pure, exported so the view stays thin. */
export type RangePreset = '1h' | '4h' | '1d' | '7d' | '30d';

const PRESET_MS: Record<RangePreset, number> = {
  '1h': 3_600_000,
  '4h': 4 * 3_600_000,
  '1d': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
  '30d': 30 * 24 * 3_600_000,
};

export function presetRange(preset: RangePreset, now: number = Date.now()): { from: number; to: number } {
  return { from: now - PRESET_MS[preset], to: now };
}
