import type { ToolHistoryEntry } from '@shared/domain/tool-history';

/**
 * Pure derivations for the M4 Performance view (see milestone-4 §D5). Inputs
 * are pre-filtered `ToolHistoryEntry[]` (the view scopes by connection +
 * optional per-tool filter); none of these helpers reach out. Same pattern as
 * `lib/usage-stats.ts` — cheap enough at the current 200-cap history to
 * recompute on every render and still cheap at a future 2000-cap.
 */

/** Fixed log-ish latency buckets — readable labels are friendlier than
 *  arbitrary numeric ranges, and the "long tail" bucket catches outliers
 *  without needing a chart axis trick. */
const BUCKET_DEFS: readonly { label: string; lo: number; hi: number }[] = [
  { label: '< 10 ms', lo: 0, hi: 10 },
  { label: '10–50 ms', lo: 10, hi: 50 },
  { label: '50–100 ms', lo: 50, hi: 100 },
  { label: '100–500 ms', lo: 100, hi: 500 },
  { label: '500 ms–1 s', lo: 500, hi: 1000 },
  { label: '1–5 s', lo: 1000, hi: 5000 },
  { label: '> 5 s', lo: 5000, hi: Number.POSITIVE_INFINITY },
];

export interface LatencyBin {
  label: string;
  count: number;
  loMs: number;
  hiMs: number;
}

/** Distribute entries across the fixed latency buckets. Entries with non-
 *  finite `durationMs` are skipped (defensive). Result always has all 7
 *  buckets in order, even when empty — the chart needs a stable shape. */
export function latencyHistogram(entries: readonly ToolHistoryEntry[]): LatencyBin[] {
  const bins = BUCKET_DEFS.map((b) => ({ label: b.label, count: 0, loMs: b.lo, hiMs: b.hi }));
  for (const e of entries) {
    if (typeof e.durationMs !== 'number' || !Number.isFinite(e.durationMs)) continue;
    const idx = bins.findIndex((b) => e.durationMs >= b.loMs && e.durationMs < b.hiMs);
    if (idx >= 0) bins[idx]!.count++;
  }
  return bins;
}

/** Top-N entries by `durationMs` descending; ties broken by `ts` (newer first).
 *  Returns at most `n` items, even when `entries` is shorter. */
export function slowestN(entries: readonly ToolHistoryEntry[], n = 10): ToolHistoryEntry[] {
  const ranked = entries
    .filter((e) => typeof e.durationMs === 'number' && Number.isFinite(e.durationMs))
    .slice()
    .sort((a, b) => b.durationMs - a.durationMs || (b.ts < a.ts ? -1 : b.ts > a.ts ? 1 : 0));
  return ranked.slice(0, n);
}

export interface RegressionStats {
  /** p95 (nearest-rank) over the most-recent `windowMs` window. `null` when
   *  the window had zero entries. */
  currP95Ms: number | null;
  /** p95 over the previous window of equal length. `null` when empty. */
  prevP95Ms: number | null;
  /** `(curr - prev) / prev`, or `null` when either side is unknown / zero. */
  deltaRatio: number | null;
  /** Convenience: true when `deltaRatio` ≥ the threshold (default 25 %). */
  regression: boolean;
  currCount: number;
  prevCount: number;
}

/** Compute a "p95 of the recent window vs the previous window" delta —
 *  the M4 regression callout. `windowMs` is the half-window (1 h default);
 *  "recent" is `(now - windowMs, now]`, "previous" is
 *  `(now - 2 * windowMs, now - windowMs]`. `regressionThreshold` defaults to
 *  0.25 (a 25 % p95 increase counts). */
export function p95DeltaOverWindows(
  entries: readonly ToolHistoryEntry[],
  windowMs: number = 3_600_000,
  now: number = Date.now(),
  regressionThreshold = 0.25,
): RegressionStats {
  const recentLo = now - windowMs;
  const prevLo = now - 2 * windowMs;
  const curr: number[] = [];
  const prev: number[] = [];
  for (const e of entries) {
    if (typeof e.durationMs !== 'number' || !Number.isFinite(e.durationMs)) continue;
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t)) continue;
    if (t > recentLo && t <= now) curr.push(e.durationMs);
    else if (t > prevLo && t <= recentLo) prev.push(e.durationMs);
  }
  const currP95Ms = curr.length > 0 ? percentile(curr.slice().sort((a, b) => a - b), 0.95) : null;
  const prevP95Ms = prev.length > 0 ? percentile(prev.slice().sort((a, b) => a - b), 0.95) : null;
  const deltaRatio = currP95Ms !== null && prevP95Ms !== null && prevP95Ms > 0 ? (currP95Ms - prevP95Ms) / prevP95Ms : null;
  return {
    currP95Ms,
    prevP95Ms,
    deltaRatio,
    regression: deltaRatio !== null && deltaRatio >= regressionThreshold,
    currCount: curr.length,
    prevCount: prev.length,
  };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}
