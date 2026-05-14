import { create } from 'zustand';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { fromToolCall, toToolCall, type WriteOp } from '../lib/write-ops';

/**
 * The Niagara diff-and-approve "Hold" queue — per-connection (a connectionId
 * key), session-only (never persisted across a restart; on disconnect the
 * caller is expected to prompt the operator and clear). The Changes view binds
 * to the active connection's queue and runs `applyAll(connectionId, ctx)` to
 * flush. See `docs/milestone-3.md` §D1.
 */

export type OpStatus = 'pending' | 'running' | 'done' | 'error';

/** **M5 C75** — where an op came from. Absent = human-proposed (Property Sheet
 *  edit, tree context menu — the M3 paths); `{type:'ai', conversationId}` =
 *  AI-proposed via the safety boundary. The Changes view badges AI-proposed
 *  ops with an "AI" chip + a deep-link back to the originating conversation. */
export type OpSource = 'human' | { type: 'ai'; conversationId: string; agentId?: string };

export interface QueuedOp {
  /** Stable id within a session — survives status transitions; not the op's
   *  identity (two enqueues of identical ops are two distinct entries). */
  id: string;
  op: WriteOp;
  status: OpStatus;
  errorMessage?: string;
  /** Provenance. Absent on every op enqueued before M5 C75 / from M3 callsites
   *  that haven't been migrated; treated as `'human'` for badge purposes. */
  source?: OpSource;
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
  enqueue: (connectionId: string, op: WriteOp, source?: OpSource) => string;
  /**
   * **M5 C75** — enqueue from an AI-attributed `{name, args}` tool-call shape
   * (what the safety boundary intercepts at `connections:call`). Parses via
   * {@link fromToolCall}; returns the queued id on success, `null` if the
   * tool name is not one this plugin understands (the chat view surfaces "no
   * plugin can render this op" in that case).
   */
  enqueueFromAi: (
    connectionId: string,
    toolCall: { name: string; args: Record<string, unknown> },
    source: { type: 'ai'; conversationId: string; agentId?: string },
  ) => string | null;
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

  enqueue: (connectionId, op, source) => {
    const id = newId();
    set((s) => {
      const next = new Map(s.queues);
      const cur = next.get(connectionId) ?? [];
      next.set(connectionId, [
        ...cur,
        { id, op, status: 'pending', ...(source ? { source } : {}) },
      ]);
      return { queues: next };
    });
    return id;
  },

  enqueueFromAi: (connectionId, toolCall, source) => {
    const op = fromToolCall(toolCall.name, toolCall.args);
    if (!op) return null;
    return get().enqueue(connectionId, op, source);
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

// A single shared reference for "no queue" — returning a fresh `[]` per render
// would make Zustand's `Object.is` selector compare see a change every render
// and loop the consumer (React #185).
const EMPTY_QUEUE: readonly QueuedOp[] = [];

/** Selector helper: the current queue for a connection (or a stable empty array). */
export function selectQueue(connectionId: string | undefined) {
  return (s: PendingState): readonly QueuedOp[] =>
    connectionId ? (s.queues.get(connectionId) ?? EMPTY_QUEUE) : EMPTY_QUEUE;
}
