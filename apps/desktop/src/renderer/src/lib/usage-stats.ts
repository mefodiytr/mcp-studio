import type { ToolHistoryEntry } from '@shared/domain/tool-history';

/**
 * Pure derivations over the persisted tool-call history (see M4 §D6). Inputs
 * are pre-filtered `ToolHistoryEntry[]` (the view scopes by connection); none
 * of these helpers reach out to anything — they're testable in isolation and
 * cheap enough at the current 200-cap history to recompute on every render.
 * A future cap bump (m4-followups) doesn't change the shape — `O(n + k log k)`
 * per call for the sort steps, fine at thousands of entries.
 */

export interface UsageRow {
  /** Tool name as recorded in history. */
  name: string;
  /** Total invocations. */
  count: number;
  /** Calls that succeeded (status: ok). */
  okCount: number;
  /** Calls that failed (status: tool-error | error). */
  errCount: number;
}

/** Group history by tool name → counts + ok/err split, sorted by total count desc. */
export function usageByTool(entries: readonly ToolHistoryEntry[]): UsageRow[] {
  const map = new Map<string, UsageRow>();
  for (const e of entries) {
    let row = map.get(e.toolName);
    if (!row) {
      row = { name: e.toolName, count: 0, okCount: 0, errCount: 0 };
      map.set(e.toolName, row);
    }
    row.count++;
    if (e.status === 'ok') row.okCount++;
    else row.errCount++;
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface LatencyRow {
  name: string;
  count: number;
  /** Arithmetic mean of `durationMs` across calls. */
  avgMs: number;
  /** Median (50th percentile). */
  p50Ms: number;
  /** 95th percentile — `samples[ceil(0.95 * count) - 1]` from the sorted set. */
  p95Ms: number;
}

/** Per-tool latency stats (avg / p50 / p95), sorted slowest-first by avg.
 *  Straightforward `[...samples].sort()` per tool — at the current 200-cap
 *  history, per-tool samples are typically 5–20, and even at a 2000-cap
 *  bump the cost is microseconds. */
export function latencyStats(entries: readonly ToolHistoryEntry[]): LatencyRow[] {
  const samples = new Map<string, number[]>();
  for (const e of entries) {
    if (typeof e.durationMs !== 'number' || !Number.isFinite(e.durationMs)) continue;
    let list = samples.get(e.toolName);
    if (!list) {
      list = [];
      samples.set(e.toolName, list);
    }
    list.push(e.durationMs);
  }
  const rows: LatencyRow[] = [];
  for (const [name, list] of samples) {
    if (list.length === 0) continue;
    const sorted = [...list].sort((a, b) => a - b);
    const avgMs = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const p50Ms = percentile(sorted, 0.5);
    const p95Ms = percentile(sorted, 0.95);
    rows.push({ name, count: sorted.length, avgMs, p50Ms, p95Ms });
  }
  return rows.sort((a, b) => b.avgMs - a.avgMs || a.name.localeCompare(b.name));
}

/** `samples` MUST be sorted ascending; computes the nearest-rank percentile
 *  (the spec we want for ops latency stats — no interpolation between
 *  samples). p ∈ [0, 1]. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

export interface ErrorRow {
  /** A stable key per error class: the numeric JSON-RPC / MCP code as a
   *  string (e.g. `"-32602"`), `"tool-error"` for tool-reported `isError`, or
   *  `"error"` for an unattributed transport failure. */
  code: string;
  /** Human-readable label for the chart — typically the same as `code`. */
  label: string;
  count: number;
}

/** Group failed calls by error class. Tool-reported `isError` results are
 *  lumped together as `"tool-error"`; JSON-RPC / MCP errors key by code. */
export function errorBreakdown(entries: readonly ToolHistoryEntry[]): ErrorRow[] {
  const map = new Map<string, ErrorRow>();
  for (const e of entries) {
    if (e.status === 'ok') continue;
    let code: string;
    if (e.status === 'tool-error') code = 'tool-error';
    else if (e.error && typeof e.error === 'object' && typeof e.error.code === 'number') code = String(e.error.code);
    else code = 'error';
    const label = code === 'tool-error' ? 'tool reported isError' : code === 'error' ? 'uncoded error' : code;
    const row = map.get(code);
    if (row) row.count++;
    else map.set(code, { code, label, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}
