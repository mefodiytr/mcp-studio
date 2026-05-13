import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { LineChart as LineChartIcon, Plus, RefreshCcw, X } from 'lucide-react';
import {
  Button,
  cn,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@mcp-studio/ui';
import { paletteColor, TimeSeriesChart, type TimeSeriesPoint, type TimeSeriesSeries } from '@mcp-studio/charts';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { presetRange, readHistory, type AggregationMode, type RangePreset } from '../lib/niagara-history';
import { ordLeaf, slotPath } from '../lib/ord';
import { useExplorerStore } from '../state/explorer-store';

/**
 * The Niagara history view (M4 C64) — `readHistory` for one or more ORDs over
 * a chosen range, with the chart/table dual view + aggregation toggle.
 *
 * - **Primary ord** comes from the Explorer's selection (`useExplorerStore`).
 *   When nothing's selected, the view shows an empty-state nudge.
 * - **Range picker** — five presets (1 h / 4 h / 1 d / 7 d / 30 d) + a custom
 *   `from`/`to` pair (datetime-local inputs, locale-naïve → epoch ms on send).
 * - **Aggregation** — none / avg / min / max / count (the `readHistory` arg).
 * - **Multi-history overlay** — "+ Add series" opens a CommandDialog over the
 *   Explorer's `known` cache (every node we've ever loaded in the tree); pick
 *   one → it joins the chart as an additional series (palette-rotated). Each
 *   extra series shares the same range + aggregation; per-series ranges are
 *   an M5 polish item.
 * - **Chart / table dual view** — both render the same wrapper output
 *   (downsampled to ≤2k points for the chart; the table paginates the full
 *   `raw` series).
 */
export function HistoryView({ ctx }: { ctx: PluginContext }) {
  const selected = useExplorerStore((s) => s.selected);
  const known = useExplorerStore((s) => s.known);
  const [preset, setPreset] = useState<RangePreset | 'custom'>('1d');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [aggregation, setAggregation] = useState<AggregationMode>('none');
  const [extraOrds, setExtraOrds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const range = useMemo(() => {
    if (preset !== 'custom') return presetRange(preset);
    const from = parseLocal(customFrom);
    const to = parseLocal(customTo) ?? Date.now();
    return from !== null ? { from, to } : presetRange('1d');
  }, [preset, customFrom, customTo]);

  const ords = useMemo(() => (selected ? [selected, ...extraOrds] : []), [selected, extraOrds]);

  if (!selected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        <LineChartIcon className="size-10" aria-hidden />
        <p>Select a component in the Explorer to read its history.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b p-2 text-xs">
        <RangeBar preset={preset} setPreset={setPreset} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo} aggregation={aggregation} setAggregation={setAggregation} />
        <SeriesBar primaryOrd={selected} extra={extraOrds} onRemove={(o) => setExtraOrds((xs) => xs.filter((x) => x !== o))} onAddClick={() => setPickerOpen(true)} />
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <HistoryBody ctx={ctx} ords={ords} from={range.from} to={range.to} aggregation={aggregation} />
      </div>

      <CommandDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Add a history series"
        description="Pick a known component from the Explorer cache."
      >
        <CommandInput placeholder="Search the loaded components…" />
        <CommandList>
          <CommandEmpty>
            {known.size === 0 ? 'Expand the tree to populate the cache.' : 'No matching component.'}
          </CommandEmpty>
          <CommandGroup heading="Components">
            {[...known.values()]
              .filter((n) => n.ord !== selected && !extraOrds.includes(n.ord))
              .sort((a, b) => a.ord.localeCompare(b.ord))
              .map((n) => (
                <CommandItem
                  key={n.ord}
                  value={`${n.displayName} ${n.ord}`}
                  onSelect={() => {
                    setExtraOrds((xs) => [...xs, n.ord]);
                    setPickerOpen(false);
                  }}
                >
                  <span className="truncate">{n.displayName}</span>
                  <span className="ml-auto truncate pl-3 font-mono text-xs text-muted-foreground">{slotPath(n.ord)}</span>
                </CommandItem>
              ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}

function RangeBar({
  preset,
  setPreset,
  customFrom,
  customTo,
  setCustomFrom,
  setCustomTo,
  aggregation,
  setAggregation,
}: {
  preset: RangePreset | 'custom';
  setPreset: (p: RangePreset | 'custom') => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (s: string) => void;
  setCustomTo: (s: string) => void;
  aggregation: AggregationMode;
  setAggregation: (a: AggregationMode) => void;
}) {
  const PRESETS: { id: RangePreset | 'custom'; label: string }[] = [
    { id: '1h', label: '1 h' },
    { id: '4h', label: '4 h' },
    { id: '1d', label: '1 d' },
    { id: '7d', label: '7 d' },
    { id: '30d', label: '30 d' },
    { id: 'custom', label: 'Custom' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">Range</span>
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreset(p.id)}
            className={cn('h-7 rounded border px-2 text-[11px]', preset === p.id && 'bg-accent text-accent-foreground')}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">from</span>
            <input
              type="datetime-local"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-7 rounded border bg-background px-1.5 font-mono"
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">to</span>
            <input
              type="datetime-local"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-7 rounded border bg-background px-1.5 font-mono"
            />
          </label>
        </>
      )}
      <label className="ml-auto flex items-center gap-1">
        <span className="text-muted-foreground">Aggregation</span>
        <select
          value={aggregation}
          onChange={(e) => setAggregation(e.target.value as AggregationMode)}
          className="h-7 rounded border bg-background px-1.5"
        >
          <option value="none">none</option>
          <option value="avg">avg</option>
          <option value="min">min</option>
          <option value="max">max</option>
          <option value="count">count</option>
        </select>
      </label>
    </div>
  );
}

function SeriesBar({
  primaryOrd,
  extra,
  onRemove,
  onAddClick,
}: {
  primaryOrd: string;
  extra: string[];
  onRemove: (ord: string) => void;
  onAddClick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground">Series</span>
      <SeriesChip ord={primaryOrd} colorIndex={0} />
      {extra.map((o, i) => (
        <SeriesChip key={o} ord={o} colorIndex={i + 1} onRemove={() => onRemove(o)} />
      ))}
      <Button size="sm" variant="ghost" onClick={onAddClick}>
        <Plus className="size-3.5" aria-hidden />
        Add series
      </Button>
    </div>
  );
}

function SeriesChip({ ord, colorIndex, onRemove }: { ord: string; colorIndex: number; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
      title={ord}
    >
      <span className="inline-block size-2 rounded-full" style={{ backgroundColor: paletteColor(colorIndex) }} aria-hidden />
      <span className="font-mono">{ordLeaf(ord)}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-foreground" title="Remove series">
          <X className="size-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

function HistoryBody({
  ctx,
  ords,
  from,
  to,
  aggregation,
}: {
  ctx: PluginContext;
  ords: readonly string[];
  from: number;
  to: number;
  aggregation: AggregationMode;
}) {
  const cid = ctx.connection.connectionId;
  // `useQueries` (not a loop of `useQuery`) — React Query's purpose-built hook
  // for a dynamic-length list of queries; one hook call, length-stable.
  const queries = useQueries({
    queries: ords.map((ord) => ({
      queryKey: ['niagara', cid, 'history', ord, from, to, aggregation] as const,
      queryFn: () => readHistory(ctx, { ord, from, to, aggregation: aggregation === 'none' ? undefined : aggregation }),
      enabled: Boolean(ord),
    })),
  });

  const series: TimeSeriesSeries[] = ords.map((ord, i) => ({
    name: ordLeaf(ord),
    color: paletteColor(i),
    points: (queries[i]?.data?.points ?? []) as TimeSeriesPoint[],
  }));
  const anyLoading = queries.some((q) => q.isPending);
  const anyError = queries.find((q) => q.isError);
  const totalRows = queries.reduce((s, q) => s + (q.data?.rowCount ?? 0), 0);
  const anyTruncated = queries.some((q) => q.data?.truncated === true);
  const refetchAll = (): void => {
    for (const q of queries) void q.refetch();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b p-2 text-xs">
        <span className="text-muted-foreground">
          {anyLoading ? 'Loading…' : `${totalRows} row${totalRows === 1 ? '' : 's'}`}
          {anyTruncated && <span className="ml-1.5 text-amber-600 dark:text-amber-400">(truncated)</span>}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={refetchAll} disabled={anyLoading}>
          <RefreshCcw className="size-3.5" aria-hidden />
          Refresh
        </Button>
      </div>
      {anyError ? (
        <p className="p-3 text-xs text-destructive">
          Couldn’t load history{anyError.error instanceof Error ? ` — ${anyError.error.message}` : ''}
        </p>
      ) : (
        <>
          <div className="border-b p-2">
            <TimeSeriesChart series={series} height={280} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <HistoryTable series={series.map((s, i) => ({ name: s.name, color: s.color, raw: queries[i]?.data?.raw ?? [] }))} />
          </div>
        </>
      )}
    </div>
  );
}

const TABLE_PAGE = 200;

function HistoryTable({
  series,
}: {
  series: { name: string; color?: string; raw: readonly TimeSeriesPoint[] }[];
}) {
  const [pageBySeries, setPageBySeries] = useState<Record<string, number>>({});
  if (series.every((s) => s.raw.length === 0)) {
    return <p className="p-3 text-xs italic text-muted-foreground">no rows</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 p-2 md:grid-cols-2">
      {series.map((s) => {
        const page = pageBySeries[s.name] ?? 0;
        const rows = s.raw.slice(page * TABLE_PAGE, (page + 1) * TABLE_PAGE);
        const totalPages = Math.max(1, Math.ceil(s.raw.length / TABLE_PAGE));
        return (
          <div key={s.name} className="rounded border">
            <div className="flex items-center gap-1.5 border-b px-2 py-1 text-xs">
              <span className="inline-block size-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
              <span className="font-mono">{s.name}</span>
              <span className="text-muted-foreground">{s.raw.length} rows</span>
              {totalPages > 1 && (
                <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPageBySeries((p) => ({ ...p, [s.name]: Math.max(0, page - 1) }))}
                    className="rounded border px-1.5 py-0.5 disabled:opacity-50"
                  >
                    ‹
                  </button>
                  <span>
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPageBySeries((p) => ({ ...p, [s.name]: Math.min(totalPages - 1, page + 1) }))}
                    className="rounded border px-1.5 py-0.5 disabled:opacity-50"
                  >
                    ›
                  </button>
                </span>
              )}
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pl-2 font-medium">t</th>
                  <th className="py-1 pr-2 font-medium">v</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-0.5 pl-2 font-mono">{new Date(r.t).toISOString()}</td>
                    <td className="py-0.5 pr-2 font-mono">{r.v === null ? <span className="text-muted-foreground">—</span> : r.v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function parseLocal(value: string): number | null {
  if (!value) return null;
  // `<input type="datetime-local">` returns `YYYY-MM-DDTHH:MM` in the user's
  // local timezone — `new Date(value)` parses this as local-time, which is
  // what the operator typed.
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}
