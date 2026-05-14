import { z } from 'zod';

import { downsampleTimeSeries, type TimeSeriesSeries } from '@mcp-studio/charts';

/**
 * Pure parser for the M5 D8 chart code-fence payload — separated from
 * `ChatChart.tsx` so it's unit-testable without dragging the renderer-side
 * aliases (`@renderer/...`) into vitest's resolution graph.
 *
 *   1. Oversize guard — 256 kB cap.
 *   2. `JSON.parse` — malformed JSON returns the `'json-error'` reason so
 *      MarkdownRenderer can fall through to a plain code block (the LLM is
 *      probably *documenting* the chart syntax with a deliberately-invalid
 *      example).
 *   3. Zod validation against `chartPayloadSchema`. Unknown chart `type`,
 *      missing required fields, empty series → `'schema-error'`.
 *   4. Normalise `t` from ISO string or epoch ms into UNIX-ms (same
 *      defensive parsing as `niagara-history.ts` M4 wrapper).
 *   5. Sort points by timestamp (LLMs sometimes emit out-of-order).
 *   6. Downsample to ≤500 points per series via `downsampleTimeSeries`
 *      (the host base prompt instructs the LLM to do this upfront; this is
 *      the safety net).
 */

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_POINTS_PER_SERIES = 500;

const pointSchema = z.object({
  t: z.union([z.string(), z.number()]),
  v: z.number().nullable(),
});

const seriesSchema = z.object({
  name: z.string(),
  color: z.string().optional(),
  points: z.array(pointSchema),
});

export const chartPayloadSchema = z.object({
  type: z.literal('timeseries'),
  title: z.string().optional(),
  series: z.array(seriesSchema).min(1),
  // Future chart-payload extensions (xDomain, yDomain, …) land here;
  // validation stays strict on `type` so additions are explicit.
});

export type ChartPayload = z.infer<typeof chartPayloadSchema>;

export interface ChartParseOk {
  kind: 'ok';
  payload: ChartPayload;
  normalisedSeries: TimeSeriesSeries[];
  truncated: { name: string; from: number; to: number }[];
}
export interface ChartParseFailure {
  kind: 'fallback';
  reason: 'oversized' | 'json-error' | 'schema-error' | 'no-points';
  message: string;
}
export type ChartParseOutcome = ChartParseOk | ChartParseFailure;

export function parseChartPayload(text: string): ChartParseOutcome {
  if (text.length > MAX_PAYLOAD_BYTES) {
    return {
      kind: 'fallback',
      reason: 'oversized',
      message: `Chart payload too large (${text.length} chars, max ${MAX_PAYLOAD_BYTES}).`,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      kind: 'fallback',
      reason: 'json-error',
      message: err instanceof Error ? err.message : 'Invalid JSON.',
    };
  }
  const parsed = chartPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: 'fallback',
      reason: 'schema-error',
      message: parsed.error.issues[0]?.message ?? 'Schema validation failed.',
    };
  }
  const truncated: { name: string; from: number; to: number }[] = [];
  const series: TimeSeriesSeries[] = [];
  for (const s of parsed.data.series) {
    const points = s.points
      .map((p) => ({ t: normaliseTs(p.t), v: p.v }))
      .filter((p): p is { t: number; v: number | null } => p.t !== null);
    if (points.length === 0) continue;
    const sorted = [...points].sort((a, b) => a.t - b.t);
    const originalCount = sorted.length;
    const downsampled = downsampleTimeSeries(sorted, MAX_POINTS_PER_SERIES);
    if (downsampled.length < originalCount) {
      truncated.push({ name: s.name, from: originalCount, to: downsampled.length });
    }
    series.push({
      name: s.name,
      ...(s.color !== undefined ? { color: s.color } : {}),
      points: downsampled,
    });
  }
  if (series.length === 0) {
    return {
      kind: 'fallback',
      reason: 'no-points',
      message: 'Every series in the chart payload had unparseable timestamps.',
    };
  }
  return { kind: 'ok', payload: parsed.data, normalisedSeries: series, truncated };
}

/** Accepts an ISO-8601 datetime string or a UNIX-ms number; returns ms. */
function normaliseTs(t: string | number): number | null {
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? parsed : null;
}
