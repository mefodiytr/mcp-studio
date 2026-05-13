import { create } from 'zustand';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { toToolCall, type WriteOp } from '../lib/write-ops';

/**
 * The Niagara diff-and-approve "Hold" queue — per-connection (a connectionId
 * key), session-only (never persisted across a restart; on disconnect the
 * caller is expected to prompt the operator and clear). The Changes view binds
 * to the active connection's queue and runs `applyAll(connectionId, ctx)` to
 * flush. See `docs/milestone-3.md` §D1.
 */

export type OpStatus = 'pending' | 'running' | 'done' | 'error';

export interface QueuedOp {
  /** Stable id within a session — survives status transitions; not the op's
   *  identity (two enqueues of identical ops are two distinct entries). */
  id: string;
  op: WriteOp;
  status: OpStatus;
  errorMessage?: string;
}

export interface ApplyResult {
  /** Ops the server accepted (status: done). */
  ok: number;
  /** Ops that errored (status: error). On the first error, `applyAll` returns
   *  early — the rest of the queue stays `pending`. */
  failed: number;
  /** True if `commitStation` succeeded at the end of a fully-ok run; false
   *  when nothing was applied, or when an op errored, or when commit itself
   *  failed (the per-op statuses still record the truth). */
  committed: boolean;
}

interface PendingState {
  /** connectionId → its queue, in enqueue order. */
  queues: ReadonlyMap<string, readonly QueuedOp[]>;
  /** When on, an `enqueue` is followed by an immediate `applyAll` of the
   *  single op — fast iteration on dev stations. The Changes view exposes
   *  this as a toggle with a visible warning. */
  autoCommit: boolean;
  enqueue: (connectionId: string, op: WriteOp) => string;
  remove: (connectionId: string, id: string) => void;
  clear: (connectionId: string) => void;
  setAutoCommit: (on: boolean) => void;
  /** Run the queue sequentially via `ctx.callTool(..., {write:true})`, then a
   *  final `commitStation`. Stops on first error, leaving the rest pending. */
  applyAll: (connectionId: string, ctx: PluginContext) => Promise<ApplyResult>;
}

let nextId = 0;
const newId = (): string => `op-${++nextId}-${Date.now().toString(36)}`;

function updateItem(
  queues: ReadonlyMap<string, readonly QueuedOp[]>,
  connectionId: string,
  id: string,
  patch: Partial<QueuedOp>,
): Map<string, readonly QueuedOp[]> {
  const cur = queues.get(connectionId);
  const next = new Map(queues);
  if (!cur) return next;
  next.set(
    connectionId,
    cur.map((q) => (q.id === id ? { ...q, ...patch } : q)),
  );
  return next;
}

export const usePendingStore = create<PendingState>((set, get) => ({
  queues: new Map(),
  autoCommit: false,

  enqueue: (connectionId, op) => {
    const id = newId();
    set((s) => {
      const next = new Map(s.queues);
      const cur = next.get(connectionId) ?? [];
      next.set(connectionId, [...cur, { id, op, status: 'pending' }]);
      return { queues: next };
    });
    return id;
  },

  remove: (connectionId, id) =>
    set((s) => {
      const cur = s.queues.get(connectionId);
      if (!cur) return s;
      const filtered = cur.filter((q) => q.id !== id);
      const next = new Map(s.queues);
      if (filtered.length > 0) next.set(connectionId, filtered);
      else next.delete(connectionId);
      return { queues: next };
    }),

  clear: (connectionId) =>
    set((s) => {
      if (!s.queues.has(connectionId)) return s;
      const next = new Map(s.queues);
      next.delete(connectionId);
      return { queues: next };
    }),

  setAutoCommit: (on) => set({ autoCommit: on }),

  applyAll: async (connectionId, ctx) => {
    const snapshot = get().queues.get(connectionId) ?? [];
    let ok = 0;
    let failed = 0;
    for (const item of snapshot) {
      // Skip already-done ops (e.g. a retry of a partially-applied queue).
      if (item.status === 'done') {
        ok++;
        continue;
      }
      set((s) => ({ queues: updateItem(s.queues, connectionId, item.id, { status: 'running', errorMessage: undefined }) }));
      const tc = toToolCall(item.op);
      try {
        await ctx.callTool(tc.name, tc.arguments, { write: true });
        ok++;
        set((s) => ({ queues: updateItem(s.queues, connectionId, item.id, { status: 'done' }) }));
      } catch (e) {
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        set((s) => ({ queues: updateItem(s.queues, connectionId, item.id, { status: 'error', errorMessage: message }) }));
        return { ok, failed, committed: false };
      }
    }
    if (ok === 0) return { ok: 0, failed: 0, committed: false };
    try {
      await ctx.callTool('commitStation', {}, { write: true });
      return { ok, failed, committed: true };
    } catch {
      // The per-op writes landed but the explicit commit didn't — the station
      // will still auto-save within ~30s; the Changes view surfaces this.
      return { ok, failed, committed: false };
    }
  },
}));

/** Selector helper: the current queue for a connection (or an empty array). */
export function selectQueue(connectionId: string | undefined) {
  return (s: PendingState): readonly QueuedOp[] => (connectionId ? (s.queues.get(connectionId) ?? []) : []);
}
