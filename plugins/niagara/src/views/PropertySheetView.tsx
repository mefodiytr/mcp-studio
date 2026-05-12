import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { getSlots, inspectComponent, type SlotRow } from '../lib/niagara-api';
import { ordLeaf } from '../lib/ord';
import { useExplorerStore } from '../state/explorer-store';

/**
 * The selected component's slot dump — header (identity + child count, via
 * `inspectComponent`) over a slot table (`getSlots`: name / type / value, with
 * facets when present). Display-only in M2; the inline-edit affordance is M3.
 * "Selected" is the explorer's selection (the rail item just switches the view).
 */
export function PropertySheetView({ ctx }: { ctx: PluginContext }) {
  const ord = useExplorerStore((s) => s.selected);
  if (!ord) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Select a component in the Explorer to see its slots.
      </div>
    );
  }
  return <PropertySheet ctx={ctx} ord={ord} />;
}

function PropertySheet({ ctx, ord }: { ctx: PluginContext; ord: string }) {
  const cid = ctx.connection.connectionId;
  const info = useQuery({ queryKey: ['niagara', cid, 'inspect', ord], queryFn: () => inspectComponent(ctx, ord) });
  const slots = useQuery({ queryKey: ['niagara', cid, 'slots', ord], queryFn: () => getSlots(ctx, ord) });

  return (
    <div className="flex h-full flex-col">
      <header className="border-b p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Boxes className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{info.data?.displayName ?? ordLeaf(ord)}</span>
        </p>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <dt>ORD</dt>
          <dd className="break-all font-mono">{ord}</dd>
          {info.data?.type && (
            <>
              <dt>Type</dt>
              <dd className="font-mono">{info.data.type}</dd>
            </>
          )}
          {info.data?.parentOrd && (
            <>
              <dt>Parent</dt>
              <dd className="break-all font-mono">{info.data.parentOrd}</dd>
            </>
          )}
          {info.data && (
            <>
              <dt>Children</dt>
              <dd>{info.data.childCount}</dd>
            </>
          )}
        </dl>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Slots</h3>
        <SlotTable query={slots} />
      </div>
    </div>
  );
}

function SlotTable({ query }: { query: UseQueryResult<SlotRow[]> }) {
  if (query.isPending) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (query.isError) {
    return (
      <p className="text-xs text-destructive">
        Couldn’t load slots{query.error instanceof Error ? ` — ${query.error.message}` : ''}
      </p>
    );
  }
  const rows = query.data ?? [];
  if (rows.length === 0) return <p className="text-xs italic text-muted-foreground">no slots</p>;
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-1 pr-3 font-medium">Name</th>
          <th className="py-1 pr-3 font-medium">Type</th>
          <th className="py-1 font-medium">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((slot) => (
          <tr key={slot.name} className="border-b border-border/50">
            <td className="py-1 pr-3 font-mono">{slot.name}</td>
            <td className="py-1 pr-3 font-mono text-muted-foreground">{slot.type}</td>
            <td className="py-1 font-mono">
              {slot.value}
              {slot.facets && Object.keys(slot.facets).length > 0 && (
                <span className="ml-1.5 text-muted-foreground">
                  ({Object.entries(slot.facets).map(([k, v]) => `${k}=${String(v)}`).join(', ')})
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
