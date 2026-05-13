import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Loader2, ShieldAlert, Trash2, X } from 'lucide-react';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@mcp-studio/ui';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { describe, isReversible } from '../lib/write-ops';
import { selectQueue, usePendingStore, type QueuedOp } from '../state/pending-store';

/**
 * The pending-changes / diff-and-approve view — the active connection's write
 * queue. Per-op `Reversible` / `⚠ Irreversible` badge (the §D2 table), per-op
 * status, individual remove, "Apply all" / "Discard", and the auto-commit
 * toggle. The Apply confirm dialog highlights irreversible counts explicitly
 * — never a generic "Apply N changes?".
 */
export function ChangesView({ ctx }: { ctx: PluginContext }) {
  const cid = ctx.connection.connectionId;
  const queue = usePendingStore(selectQueue(cid));
  const remove = usePendingStore((s) => s.remove);
  const clear = usePendingStore((s) => s.clear);
  const autoCommit = usePendingStore((s) => s.autoCommit);
  const setAutoCommit = usePendingStore((s) => s.setAutoCommit);
  const applyAll = usePendingStore((s) => s.applyAll);

  const queryClient = useQueryClient();
  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const pending = queue.filter((q) => q.status === 'pending' || q.status === 'running');
  const irreversibleCount = pending.filter((q) => !isReversible(q.op)).length;
  const total = queue.length;

  const onApply = async (): Promise<void> => {
    setConfirmOpen(false);
    setApplying(true);
    try {
      await applyAll(cid, ctx);
      // Refresh anything Niagara fetched for this connection — slot tables,
      // listChildren, inspectComponent — so the property sheet / explorer
      // see the new state without a tab switch.
      await queryClient.invalidateQueries({ queryKey: ['niagara', cid] });
    } finally {
      setApplying(false);
    }
  };

  if (total === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No pending changes. Edits queued from the Property sheet or the tree menu appear here.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-2 text-xs">
        <p className="font-medium">
          {total} pending change{total === 1 ? '' : 's'}
          {irreversibleCount > 0 && (
            <>
              {' · '}
              <span className="text-amber-600 dark:text-amber-500">{irreversibleCount} irreversible</span>
            </>
          )}
        </p>
        <label className="ml-auto flex items-center gap-1 text-muted-foreground">
          <input type="checkbox" checked={autoCommit} onChange={(e) => setAutoCommit(e.target.checked)} />
          Auto-commit
        </label>
        <Button size="sm" variant="ghost" onClick={() => clear(cid)} disabled={applying || total === 0}>
          <Trash2 className="size-3.5" aria-hidden />
          Discard
        </Button>
        <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={applying || pending.length === 0}>
          {applying ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          Apply all
        </Button>
      </div>
      {autoCommit && (
        <p className="border-b bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
          Auto-commit on — each queued edit applies immediately. Use only on a dev station.
        </p>
      )}
      <ul className="min-h-0 flex-1 divide-y overflow-auto text-sm">
        {queue.map((q) => (
          <OpRow
            key={q.id}
            item={q}
            onRemove={() => remove(cid, q.id)}
            disabled={applying || q.status === 'running' || q.status === 'done'}
          />
        ))}
      </ul>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Apply {pending.length} operation{pending.length === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription>
              {irreversibleCount > 0 ? (
                <>
                  Including{' '}
                  <span className="font-medium text-amber-600 dark:text-amber-500">
                    {irreversibleCount} irreversible
                  </span>
                  {' '}— review before Apply. Niagara has no native undo.
                </>
              ) : (
                <>All ops are reversible by issuing an inverse op later. commitStation is fired at the end.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant={irreversibleCount > 0 ? 'destructive' : 'default'} onClick={() => void onApply()}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const STATUS_CHIP: Record<QueuedOp['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  done: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  error: 'bg-destructive/15 text-destructive',
};

function OpRow({ item, onRemove, disabled }: { item: QueuedOp; onRemove: () => void; disabled: boolean }) {
  const reversible = isReversible(item.op);
  return (
    <li className="flex items-start gap-2 p-2">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded px-1.5 py-0.5 text-[10px]', STATUS_CHIP[item.status])}>{item.status}</span>
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px]',
              reversible ? 'bg-muted text-muted-foreground' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
            )}
          >
            {reversible ? 'Reversible' : (
              <>
                <ShieldAlert className="size-3" aria-hidden />
                Irreversible
              </>
            )}
          </span>
          <span className="truncate font-mono text-xs">{describe(item.op)}</span>
        </p>
        {item.errorMessage && (
          <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {item.errorMessage}
          </p>
        )}
      </div>
      <Button size="sm" variant="ghost" onClick={onRemove} disabled={disabled} title="Remove from queue">
        <X className="size-3.5" aria-hidden />
      </Button>
    </li>
  );
}
