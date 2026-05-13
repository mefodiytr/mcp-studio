import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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

import { dryRunRemove, type NiagaraNode, type RemovalPreview } from '../lib/niagara-api';
import { type WriteOp } from '../lib/write-ops';
import { usePendingStore } from '../state/pending-store';

/**
 * The Explorer tree's per-node action surface — a context-menu popover (open
 * on right-click of a node row, or by keyboard via the Esc/outside-close
 * affordances of CommandDialog elsewhere) plus the four action Dialogs:
 * **New child…** (`CreateComponent`), **Remove…** (`RemoveComponent`, with a
 * `dryRunRemove` preview before the op enters the queue), **Add extension…**
 * (`AddExtension`), **Link slots…** (`LinkSlots`). Each dialog enqueues a
 * write op into the per-connection pending-store; autoCommit applies it
 * immediately + invalidates the connection's React-Query cache.
 *
 * The visual wire-mode (master-spec §5.5) is out of scope here — link is a
 * plain form. A host `ctx.openView()` hook ("open in Property sheet / Folder
 * view") still isn't there; "Copy ORD" + the four write actions cover M3.
 */

export type ActionKind = 'create' | 'remove' | 'addExtension' | 'linkSlots';

export interface MenuAnchor {
  node: NiagaraNode;
  x: number;
  y: number;
}

export function NodeMenu({
  anchor,
  onClose,
  onPick,
}: {
  anchor: MenuAnchor;
  onClose: () => void;
  onPick: (kind: ActionKind) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if ('key' in e && e.key !== 'Escape') return;
      if ('key' in e || !ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [onClose]);

  const item = (label: string, onClick: () => void): React.ReactElement => (
    <button
      type="button"
      onClick={() => {
        onClick();
        onClose();
      }}
      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-accent"
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      style={{ left: anchor.x, top: anchor.y }}
      className="fixed z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
    >
      <div className="border-b px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {anchor.node.displayName}
      </div>
      {item('Copy ORD', () => void navigator.clipboard.writeText(anchor.node.ord))}
      {item('New child…', () => onPick('create'))}
      {item('Add extension…', () => onPick('addExtension'))}
      {item('Link slots…', () => onPick('linkSlots'))}
      {item('Remove…', () => onPick('remove'))}
    </div>
  );
}

/** Enqueue helper for the dialogs — auto-applies + invalidates if the store's
 *  autoCommit toggle is on. Shared by all four dialogs. */
function useEnqueueWriteOp(ctx: PluginContext): (op: WriteOp) => Promise<void> {
  const cid = ctx.connection.connectionId;
  const enqueue = usePendingStore((s) => s.enqueue);
  const applyAll = usePendingStore((s) => s.applyAll);
  const autoCommit = usePendingStore((s) => s.autoCommit);
  const queryClient = useQueryClient();
  return async (op: WriteOp): Promise<void> => {
    enqueue(cid, op);
    if (autoCommit) {
      await applyAll(cid, ctx);
      await queryClient.invalidateQueries({ queryKey: ['niagara', cid] });
    }
  };
}

export function CreateChildDialog({
  ctx,
  node,
  open,
  onOpenChange,
}: {
  ctx: PluginContext;
  node: NiagaraNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const enqueueOp = useEnqueueWriteOp(ctx);
  const [componentType, setComponentType] = useState('baja:Folder');
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState<'fail' | 'suffix'>('fail');
  const submit = async (): Promise<void> => {
    if (!name.trim() || !componentType.trim()) return;
    await enqueueOp({
      type: 'createComponent',
      parentOrd: node.ord,
      componentType: componentType.trim(),
      name: name.trim(),
      ...(strategy !== 'fail' ? { nameStrategy: strategy } : {}),
    });
    onOpenChange(false);
    setName('');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New child under {node.displayName}</DialogTitle>
          <DialogDescription>Queues a <code>createComponent</code> op. Apply from the Changes view.</DialogDescription>
        </DialogHeader>
        <FieldRow label="Type">
          <input
            value={componentType}
            onChange={(e) => setComponentType(e.target.value)}
            spellCheck={false}
            placeholder="module:TypeName (e.g. baja:Folder)"
            className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          />
        </FieldRow>
        <FieldRow label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            autoFocus
            className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          />
        </FieldRow>
        <FieldRow label="On name collision">
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as 'fail' | 'suffix')}
            className="rounded border bg-background px-2 py-1 text-xs"
          >
            <option value="fail">fail (-32602)</option>
            <option value="suffix">suffix (_2, _3, …)</option>
          </select>
        </FieldRow>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!name.trim() || !componentType.trim()}>Queue create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddExtensionDialog({
  ctx,
  node,
  open,
  onOpenChange,
}: {
  ctx: PluginContext;
  node: NiagaraNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const enqueueOp = useEnqueueWriteOp(ctx);
  const [extensionType, setExtensionType] = useState('history:NumericIntervalExt');
  const [name, setName] = useState('History');
  const submit = async (): Promise<void> => {
    if (!name.trim() || !extensionType.trim()) return;
    await enqueueOp({
      type: 'addExtension',
      parentOrd: node.ord,
      extensionType: extensionType.trim(),
      name: name.trim(),
    });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add extension to {node.displayName}</DialogTitle>
          <DialogDescription>
            Queues an <code>addExtension</code> op (irreversible — the extension config can't be reconstructed
            from a removal later).
          </DialogDescription>
        </DialogHeader>
        <FieldRow label="Extension type">
          <input
            value={extensionType}
            onChange={(e) => setExtensionType(e.target.value)}
            spellCheck={false}
            className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          />
        </FieldRow>
        <FieldRow label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            autoFocus
            className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          />
        </FieldRow>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!name.trim() || !extensionType.trim()}>Queue add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LinkSlotsDialog({
  ctx,
  node,
  open,
  onOpenChange,
}: {
  ctx: PluginContext;
  node: NiagaraNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const enqueueOp = useEnqueueWriteOp(ctx);
  // Default: the menu-anchored node is the *sink* (the link lives on the sink); operator
  // pastes the source ORD. The visual wire-mode is later.
  const [sourceOrd, setSourceOrd] = useState('');
  const [sourceSlot, setSourceSlot] = useState('out');
  const [sinkSlot, setSinkSlot] = useState('in');
  const [converterType, setConverterType] = useState('');
  const submit = async (): Promise<void> => {
    if (!sourceOrd.trim() || !sourceSlot.trim() || !sinkSlot.trim()) return;
    await enqueueOp({
      type: 'linkSlots',
      sourceOrd: sourceOrd.trim(),
      sourceSlot: sourceSlot.trim(),
      sinkOrd: node.ord,
      sinkSlot: sinkSlot.trim(),
      ...(converterType.trim() ? { converterType: converterType.trim() } : {}),
    });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link a slot into {node.displayName}</DialogTitle>
          <DialogDescription>
            The link is stored on the sink (this node). Queues a <code>linkSlots</code> op.
          </DialogDescription>
        </DialogHeader>
        <FieldRow label="Source ORD">
          <input
            value={sourceOrd}
            onChange={(e) => setSourceOrd(e.target.value)}
            spellCheck={false}
            autoFocus
            placeholder="station:|slot:/Logic/SourceComp"
            className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          />
        </FieldRow>
        <FieldRow label="Source slot">
          <input
            value={sourceSlot}
            onChange={(e) => setSourceSlot(e.target.value)}
            spellCheck={false}
            className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          />
        </FieldRow>
        <FieldRow label="Sink slot">
          <input
            value={sinkSlot}
            onChange={(e) => setSinkSlot(e.target.value)}
            spellCheck={false}
            className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          />
        </FieldRow>
        <FieldRow label="Converter (optional)">
          <input
            value={converterType}
            onChange={(e) => setConverterType(e.target.value)}
            spellCheck={false}
            placeholder="module:BConverter"
            className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          />
        </FieldRow>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!sourceOrd.trim() || !sourceSlot.trim() || !sinkSlot.trim()}>
            Queue link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveDialog({
  ctx,
  node,
  open,
  onOpenChange,
}: {
  ctx: PluginContext;
  node: NiagaraNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const enqueueOp = useEnqueueWriteOp(ctx);
  const [force, setForce] = useState(false);
  const preview = useMutation<RemovalPreview, Error, boolean>({
    mutationFn: (withForce: boolean) => dryRunRemove(ctx, node.ord, withForce),
  });
  // Fetch a fresh dry-run when the dialog opens / when force toggles / when
  // the menu's anchor moves to a different node. `preview.mutate` is stable,
  // so we deliberately don't list it.
  const mutate = preview.mutate;
  useEffect(() => {
    if (open) mutate(force);
  }, [open, force, node.ord, mutate]);

  const submit = async (): Promise<void> => {
    await enqueueOp({ type: 'removeComponent', ord: node.ord, ...(force ? { force: true } : {}) });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {node.displayName}?</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{node.ord}</span>
            <br />
            Irreversible — the subtree isn't recaptured locally. The dry-run preview below shows what the
            station would do; queue the op only if you're sure.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border p-2 text-xs">
          {preview.isPending && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Running dry-run…
            </p>
          )}
          {preview.isError && <p className="text-destructive">Dry-run failed — {preview.error.message}</p>}
          {preview.data && (
            <div className="space-y-1">
              <p className={cn('font-medium', preview.data.refused ? 'text-amber-600 dark:text-amber-500' : 'text-emerald-600 dark:text-emerald-400')}>
                {preview.data.refused ? '⚠ Refused' : 'Would remove'}
              </p>
              <p className="text-muted-foreground">{preview.data.message}</p>
              {preview.data.inboundLinks.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    {preview.data.inboundLinks.length} inbound link{preview.data.inboundLinks.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-1 list-disc pl-5 font-mono text-[10px]">
                    {preview.data.inboundLinks.map((l) => <li key={l}>{l}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          force (remove even when inbound links exist)
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            disabled={preview.isPending || (preview.data?.refused === true && !force)}
          >
            Queue remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
