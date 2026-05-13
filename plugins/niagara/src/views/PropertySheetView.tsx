import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Boxes, RotateCcw } from 'lucide-react';
import { Button, cn } from '@mcp-studio/ui';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { getSlots, inspectComponent, type SlotRow } from '../lib/niagara-api';
import { ordLeaf } from '../lib/ord';
import { bsimpleKind, parseBSimpleValue, type BSimpleKind, type WriteOp } from '../lib/write-ops';
import { selectQueue, usePendingStore, type QueuedOp } from '../state/pending-store';
import { useExplorerStore } from '../state/explorer-store';

/**
 * The selected component's slot dump — header (identity + child count, via
 * `inspectComponent`) over a slot table (`getSlots`: name / type / value, with
 * facets when present). In M3, BSimple Property slots (`baja:String`/`Boolean`/
 * `Integer`/`Long`/`Double`/`Float`) are editable inline: committing a new
 * value enqueues a `SetSlot` op into the pending-changes queue (D1) and the
 * cell shows the pending value with a "modified" badge until Apply (or
 * Discard); a per-row "Reset" button enqueues `ClearSlot`. Complex slots,
 * Actions, links and extensions stay read-only — see `docs/milestone-3.md`
 * §D5.
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
        <SlotTable ctx={ctx} ord={ord} query={slots} />
      </div>
    </div>
  );
}

function SlotTable({ ctx, ord, query }: { ctx: PluginContext; ord: string; query: UseQueryResult<SlotRow[]> }) {
  const cid = ctx.connection.connectionId;
  const queue = usePendingStore(selectQueue(cid));

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
          <SlotRowView key={slot.name} ctx={ctx} ord={ord} slot={slot} pending={pendingForSlot(queue, ord, slot.name)} />
        ))}
      </tbody>
    </table>
  );
}

/** The latest queued, not-yet-applied op for (ord, slotName) — only `setSlot`
 *  / `clearSlot` are slot-scoped. */
function pendingForSlot(queue: readonly QueuedOp[], ord: string, slotName: string): QueuedOp | undefined {
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i]!;
    if (q.status === 'done') continue;
    if ((q.op.type === 'setSlot' || q.op.type === 'clearSlot') && q.op.ord === ord && q.op.slotName === slotName) {
      return q;
    }
  }
  return undefined;
}

function SlotRowView({
  ctx,
  ord,
  slot,
  pending,
}: {
  ctx: PluginContext;
  ord: string;
  slot: SlotRow;
  pending: QueuedOp | undefined;
}) {
  const cid = ctx.connection.connectionId;
  const kind = bsimpleKind(slot.type);
  const remove = usePendingStore((s) => s.remove);
  const enqueue = usePendingStore((s) => s.enqueue);
  const autoCommit = usePendingStore((s) => s.autoCommit);
  const applyAll = usePendingStore((s) => s.applyAll);
  const queryClient = useQueryClient();

  const commitSet = async (newValue: unknown): Promise<void> => {
    const oldParsed = kind ? parseBSimpleValue(kind, slot.value) : undefined;
    const op: WriteOp = {
      type: 'setSlot',
      ord,
      slotName: slot.name,
      oldValue: oldParsed ?? slot.value,
      newValue,
    };
    enqueue(cid, op);
    if (autoCommit) {
      await applyAll(cid, ctx);
      await queryClient.invalidateQueries({ queryKey: ['niagara', cid] });
    }
  };
  const commitClear = async (): Promise<void> => {
    const oldParsed = kind ? parseBSimpleValue(kind, slot.value) : undefined;
    const op: WriteOp = {
      type: 'clearSlot',
      ord,
      slotName: slot.name,
      oldValue: oldParsed ?? slot.value,
    };
    enqueue(cid, op);
    if (autoCommit) {
      await applyAll(cid, ctx);
      await queryClient.invalidateQueries({ queryKey: ['niagara', cid] });
    }
  };

  const valueCell = (
    <ValueCell
      slot={slot}
      kind={kind}
      pending={pending}
      onCommitSet={commitSet}
      onCancelPending={() => pending && remove(cid, pending.id)}
    />
  );

  return (
    <tr className={cn('border-b border-border/50', pending && 'bg-amber-500/5')}>
      <td className="py-1 pr-3 font-mono align-top">{slot.name}</td>
      <td className="py-1 pr-3 font-mono text-muted-foreground align-top">{slot.type}</td>
      <td className="py-1 font-mono align-top">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">{valueCell}</div>
          {kind && !pending && (
            <Button size="sm" variant="ghost" title="Reset to default" onClick={() => void commitClear()}>
              <RotateCcw className="size-3" aria-hidden />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function ValueCell({
  slot,
  kind,
  pending,
  onCommitSet,
  onCancelPending,
}: {
  slot: SlotRow;
  kind: BSimpleKind;
  pending: QueuedOp | undefined;
  onCommitSet: (newValue: unknown) => void | Promise<void>;
  onCancelPending: () => void;
}) {
  // Display the pending overlay if any — for both reversible queued edits and
  // for an error'd op (with the error message; the user can revert or wait).
  if (pending && (pending.op.type === 'setSlot' || pending.op.type === 'clearSlot')) {
    const label =
      pending.op.type === 'setSlot' ? formatNew(pending.op.newValue) : '(default)';
    return (
      <div className="space-y-0.5">
        <p className="flex items-center gap-1.5">
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-500">
            {pending.status === 'error' ? 'error' : 'modified'}
          </span>
          <span className="text-amber-700 dark:text-amber-400">{label}</span>
          <span className="text-muted-foreground">(was {slot.value})</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onCancelPending} title="Revert (remove from queue)">
            <RotateCcw className="size-3" aria-hidden />
          </Button>
        </p>
        {pending.errorMessage && <p className="text-destructive">{pending.errorMessage}</p>}
      </div>
    );
  }
  if (kind) {
    return <EditableCell slot={slot} kind={kind} onCommit={onCommitSet} />;
  }
  // Read-only display (M2 fallback) — non-BSimple slots stay non-editable.
  return (
    <>
      {slot.value}
      {slot.facets && Object.keys(slot.facets).length > 0 && (
        <span className="ml-1.5 text-muted-foreground">
          ({Object.entries(slot.facets).map(([k, v]) => `${k}=${String(v)}`).join(', ')})
        </span>
      )}
    </>
  );
}

function formatNew(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

function EditableCell({
  slot,
  kind,
  onCommit,
}: {
  slot: SlotRow;
  kind: Exclude<BSimpleKind, null>;
  onCommit: (newValue: unknown) => void | Promise<void>;
}) {
  // Boolean — a checkbox. The initial state is parsed best-effort from the
  // displayed value (niagaramcp's locale issue means `поистине` → true).
  if (kind === 'boolean') {
    const initial = parseBSimpleValue('boolean', slot.value) === true;
    return (
      <label className="inline-flex items-center gap-1.5">
        <input
          type="checkbox"
          defaultChecked={initial}
          onChange={(e) => void onCommit(e.target.checked)}
        />
        <span className="text-muted-foreground">{slot.value}</span>
      </label>
    );
  }
  return <TextEditableCell slot={slot} kind={kind} onCommit={onCommit} />;
}

function TextEditableCell({
  slot,
  kind,
  onCommit,
}: {
  slot: SlotRow;
  kind: 'string' | 'integer' | 'number';
  onCommit: (newValue: unknown) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(slot.value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(slot.value);
    setError(null);
  }, [slot.value, slot.name]);

  const tryCommit = (): void => {
    if (draft === slot.value) return; // no-op
    if (kind === 'string') {
      void onCommit(draft);
      return;
    }
    const parsed = parseBSimpleValue(kind, draft);
    if (parsed === undefined) {
      setError(kind === 'integer' ? 'Expected an integer.' : 'Expected a number.');
      return;
    }
    setError(null);
    void onCommit(parsed);
  };

  return (
    <span className="inline-flex flex-col gap-0.5">
      <input
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={tryCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            tryCommit();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            setDraft(slot.value);
            setError(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        inputMode={kind === 'string' ? 'text' : 'decimal'}
        spellCheck={false}
        className={cn(
          'w-full rounded border bg-background px-1.5 py-0.5 font-mono',
          error && 'border-destructive',
        )}
      />
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </span>
  );
}
