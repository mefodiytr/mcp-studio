import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Pause, X } from 'lucide-react';
import { Button, cn } from '@mcp-studio/ui';
import { Sparkline, type TimeSeriesPoint } from '@mcp-studio/charts';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { readPoint } from '../lib/niagara-api';
import { ordLeaf } from '../lib/ord';
import { useExplorerStore } from '../state/explorer-store';
import {
  DEFAULT_INTERVAL_MS,
  POLL_INTERVALS_MS,
  selectWatches,
  useWatchStore,
  type PollIntervalMs,
  type Watch,
} from '../state/watch-store';

/**
 * The Niagara live monitor (M4 C66) — a watch list of points polled per row
 * with sparklines, threshold visuals, and an opt-in pause-all. The watches
 * are persisted per-`profileId` via the watch-store (C65); add a point by
 * dragging a node from the Explorer tree onto this view's body.
 *
 * Per-row polling uses `useQuery` with `refetchInterval` — composes with the
 * existing React-Query cache (tab-switch unmount keeps the last value),
 * `refetchIntervalInBackground: false` pauses on window blur automatically,
 * and a paused row sets `refetchInterval: false` so the sparkline freezes
 * on its last buffered samples until resumed.
 *
 * Threshold visuals: when `threshold.low` / `threshold.high` is set and the
 * current value crosses it, the Sparkline recolours red (per the C62
 * primitive) and the value cell turns red too — at-a-glance signal.
 *
 * The sparkline buffer (last ~60 samples) lives in the row's local state —
 * not persisted, intentionally. The History view (C64) is the place for
 * cross-session trends.
 */
export function MonitorView({ ctx }: { ctx: PluginContext }) {
  const profileId = ctx.connection.profileId;
  const watches = useWatchStore(selectWatches(profileId));
  const ensureLoaded = useWatchStore((s) => s.ensureLoaded);
  const upsert = useWatchStore((s) => s.upsert);
  const removeWatch = useWatchStore((s) => s.remove);
  const patchWatch = useWatchStore((s) => s.patch);
  const knownNodes = useExplorerStore((s) => s.known);
  const [allPaused, setAllPaused] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    void ensureLoaded(profileId);
  }, [profileId, ensureLoaded]);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (e.dataTransfer.types.includes('application/x-niagara-ord')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
    }
  };
  const onDragLeave = (): void => setDropActive(false);
  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    setDropActive(false);
    const ord = e.dataTransfer.getData('application/x-niagara-ord');
    if (!ord) return;
    e.preventDefault();
    if (watches.some((w) => w.ord === ord)) return;
    const cached = knownNodes.get(ord);
    void upsert(profileId, {
      ord,
      intervalMs: DEFAULT_INTERVAL_MS,
      displayName: cached?.displayName,
    });
  };

  return (
    <div
      className={cn('flex h-full flex-col', dropActive && 'bg-accent/30')}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="flex flex-wrap items-center gap-2 border-b p-2 text-xs">
        <p className="font-medium">
          {watches.length} watch{watches.length === 1 ? '' : 'es'}
        </p>
        <label className="ml-auto flex items-center gap-1 text-muted-foreground">
          <input type="checkbox" checked={allPaused} onChange={(e) => setAllPaused(e.target.checked)} />
          <Pause className="size-3" aria-hidden />
          Pause all
        </label>
      </header>
      {watches.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-auto">
          {watches.map((w) => (
            <WatchRow
              key={w.ord}
              ctx={ctx}
              watch={w}
              forcePaused={allPaused}
              onRemove={() => void removeWatch(profileId, w.ord)}
              onPatch={(patch) => void patchWatch(profileId, w.ord, patch)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <Activity className="size-10" aria-hidden />
      <p>
        Drag a point from the Explorer tree to watch it. Each row polls on its own interval and
        shows a sparkline + threshold-cross alert.
      </p>
    </div>
  );
}

const BUFFER_SIZE = 60;

function WatchRow({
  ctx,
  watch,
  forcePaused,
  onRemove,
  onPatch,
}: {
  ctx: PluginContext;
  watch: Watch;
  forcePaused: boolean;
  onRemove: () => void;
  onPatch: (patch: Partial<Watch>) => void;
}) {
  const paused = forcePaused || watch.intervalMs === 0;
  const interval = watch.intervalMs > 0 ? watch.intervalMs : DEFAULT_INTERVAL_MS;
  const [buffer, setBuffer] = useState<TimeSeriesPoint[]>([]);

  const cid = ctx.connection.connectionId;
  const q = useQuery({
    queryKey: ['niagara', cid, 'readPoint', watch.ord],
    queryFn: () => readPoint(ctx, watch.ord),
    refetchInterval: paused ? false : interval,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  // Key the effect on `dataUpdatedAt` (React Query's timestamp of the latest
  // successful fetch) so a poll that returns the same value still appends a
  // sample — keying on `q.data` alone misses identical-reference ticks and
  // the sparkline never grows past one point on a flat signal.
  const dataUpdatedAt = q.dataUpdatedAt;
  const value = q.data?.value ?? null;
  useEffect(() => {
    if (dataUpdatedAt === 0) return;
    setBuffer((prev) => {
      const grown = [...prev, { t: dataUpdatedAt, v: value }];
      return grown.length > BUFFER_SIZE ? grown.slice(grown.length - BUFFER_SIZE) : grown;
    });
  }, [dataUpdatedAt, value]);

  const reading = q.data;
  const currentValue = reading?.value ?? null;
  const units = typeof reading?.facets?.['units'] === 'string' ? (reading.facets['units'] as string) : '';
  const exceeds = exceedsThreshold(currentValue, watch.threshold);
  const label = watch.displayName ?? reading?.displayName ?? ordLeaf(watch.ord);

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 hover:bg-muted/30">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm">
          <span className={cn('truncate font-medium', exceeds && 'text-destructive')}>{label}</span>
          {paused && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">paused</span>
          )}
          {reading?.status && reading.status !== 'ok' && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
              {reading.status}
            </span>
          )}
        </p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">{watch.ord}</p>
        <ThresholdEditor watch={watch} onPatch={onPatch} />
      </div>
      <div className="flex items-center gap-3">
        <Sparkline points={buffer} threshold={watch.threshold} width={120} height={32} />
        <div className="text-right">
          <p className={cn('font-mono text-lg', exceeds && 'text-destructive')}>
            {currentValue !== null ? formatValue(currentValue) : '—'}
            {units && <span className="ml-0.5 text-xs text-muted-foreground">{units}</span>}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {paused ? 'paused' : `every ${formatInterval(watch.intervalMs)}`}
          </p>
        </div>
        <IntervalPicker value={watch.intervalMs} onChange={(ms) => onPatch({ intervalMs: ms })} />
        <Button size="sm" variant="ghost" onClick={onRemove} title="Remove from watch list">
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

function exceedsThreshold(v: number | null, t: Watch['threshold']): boolean {
  if (v === null || !t) return false;
  if (t.low !== undefined && v < t.low) return true;
  if (t.high !== undefined && v > t.high) return true;
  return false;
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function formatInterval(ms: number): string {
  if (ms === 0) return 'paused';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function IntervalPicker({ value, onChange }: { value: number; onChange: (ms: PollIntervalMs) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as PollIntervalMs)}
      title="Poll interval"
      className="h-7 rounded border bg-background px-1.5 text-xs"
    >
      {POLL_INTERVALS_MS.map((ms) => (
        <option key={ms} value={ms}>
          {ms === 0 ? 'paused' : formatInterval(ms)}
        </option>
      ))}
    </select>
  );
}

function ThresholdEditor({ watch, onPatch }: { watch: Watch; onPatch: (patch: Partial<Watch>) => void }) {
  const [draftLow, setDraftLow] = useState<string>(watch.threshold?.low?.toString() ?? '');
  const [draftHigh, setDraftHigh] = useState<string>(watch.threshold?.high?.toString() ?? '');

  // Keep the inputs in sync if the watch is patched elsewhere (e.g. paused
  // from the row's IntervalPicker reuses the same watch object).
  useEffect(() => {
    setDraftLow(watch.threshold?.low?.toString() ?? '');
    setDraftHigh(watch.threshold?.high?.toString() ?? '');
  }, [watch.threshold?.low, watch.threshold?.high]);

  const commit = useMemo(
    () => (): void => {
      const low = draftLow.trim() === '' ? undefined : Number(draftLow);
      const high = draftHigh.trim() === '' ? undefined : Number(draftHigh);
      const lowOk = low === undefined || Number.isFinite(low);
      const highOk = high === undefined || Number.isFinite(high);
      if (!lowOk || !highOk) return;
      const threshold = low === undefined && high === undefined ? undefined : { ...(low !== undefined ? { low } : {}), ...(high !== undefined ? { high } : {}) };
      if (
        threshold?.low === watch.threshold?.low &&
        threshold?.high === watch.threshold?.high
      ) {
        return;
      }
      onPatch({ threshold });
    },
    [draftLow, draftHigh, onPatch, watch.threshold?.low, watch.threshold?.high],
  );

  return (
    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span>threshold</span>
      <input
        type="number"
        value={draftLow}
        onChange={(e) => setDraftLow(e.target.value)}
        onBlur={commit}
        placeholder="low"
        className="h-5 w-14 rounded border bg-background px-1 font-mono text-[10px]"
      />
      <span>—</span>
      <input
        type="number"
        value={draftHigh}
        onChange={(e) => setDraftHigh(e.target.value)}
        onBlur={commit}
        placeholder="high"
        className="h-5 w-14 rounded border bg-background px-1 font-mono text-[10px]"
      />
    </div>
  );
}
