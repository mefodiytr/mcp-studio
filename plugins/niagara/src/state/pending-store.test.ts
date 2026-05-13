import type { PluginContext } from '@mcp-studio/plugin-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WriteOp } from '../lib/write-ops';

import { usePendingStore } from './pending-store';

const op = (over: Partial<Extract<WriteOp, { type: 'setSlot' }>> = {}): WriteOp => ({
  type: 'setSlot',
  ord: 'station:|slot:/x',
  slotName: 'enabled',
  oldValue: false,
  newValue: true,
  ...over,
});

function fakeCtx(callTool: (name: string, args?: Record<string, unknown>, opts?: { write?: boolean }) => Promise<unknown>): PluginContext {
  return { connection: { connectionId: 'c1', profileId: 'p1', serverInfo: null, status: 'connected' }, callTool } as PluginContext;
}

// Reset the store between tests.
beforeEach(() => {
  usePendingStore.setState({ queues: new Map(), autoCommit: false });
});

describe('usePendingStore — per-connection queueing', () => {
  it('two connectionIds carry independent queues', () => {
    const { enqueue } = usePendingStore.getState();
    enqueue('cA', op());
    enqueue('cA', op({ slotName: 'b' }));
    enqueue('cB', op({ slotName: 'c' }));
    const q = usePendingStore.getState().queues;
    expect(q.get('cA')).toHaveLength(2);
    expect(q.get('cB')).toHaveLength(1);
  });

  it('remove drops one entry; clear empties one connection only', () => {
    const { enqueue, remove, clear } = usePendingStore.getState();
    const idA = enqueue('cA', op());
    enqueue('cA', op({ slotName: 'b' }));
    enqueue('cB', op());

    remove('cA', idA);
    expect(usePendingStore.getState().queues.get('cA')).toHaveLength(1);
    expect(usePendingStore.getState().queues.get('cB')).toHaveLength(1);

    clear('cA');
    expect(usePendingStore.getState().queues.has('cA')).toBe(false);
    expect(usePendingStore.getState().queues.get('cB')).toHaveLength(1);
  });
});

describe('usePendingStore — applyAll', () => {
  it('runs the queue sequentially, marks done, then calls commitStation', async () => {
    const calls: { name: string; args?: Record<string, unknown>; opts?: { write?: boolean } }[] = [];
    const ctx = fakeCtx(async (name, args, opts) => {
      calls.push({ name, args, opts });
      return {};
    });
    const { enqueue, applyAll } = usePendingStore.getState();
    enqueue('c1', op({ slotName: 'a' }));
    enqueue('c1', op({ slotName: 'b' }));

    const result = await applyAll('c1', ctx);
    expect(result).toEqual({ ok: 2, failed: 0, committed: true });
    expect(calls.map((c) => c.name)).toEqual(['setSlot', 'setSlot', 'commitStation']);
    expect(calls.every((c) => c.opts?.write === true)).toBe(true);
    expect(usePendingStore.getState().queues.get('c1')?.every((q) => q.status === 'done')).toBe(true);
  });

  it('stops on the first error; the failed op gets the error message; the rest stay pending', async () => {
    const ctx = fakeCtx(async (_name, args) => {
      if (args?.['slotName'] === 'b') throw new Error('nope');
      return {};
    });
    const { enqueue, applyAll } = usePendingStore.getState();
    enqueue('c1', op({ slotName: 'a' }));
    const idB = enqueue('c1', op({ slotName: 'b' }));
    enqueue('c1', op({ slotName: 'c' }));

    const result = await applyAll('c1', ctx);
    expect(result).toEqual({ ok: 1, failed: 1, committed: false });
    const q = usePendingStore.getState().queues.get('c1')!;
    expect(q[0]?.status).toBe('done');
    expect(q[1]?.status).toBe('error');
    expect(q[1]?.id).toBe(idB);
    expect(q[1]?.errorMessage).toBe('nope');
    expect(q[2]?.status).toBe('pending');
  });

  it('returns committed=false (but ok>0) when commitStation itself fails', async () => {
    const ctx = fakeCtx(async (name) => {
      if (name === 'commitStation') throw new Error('save timed out');
      return {};
    });
    const { enqueue, applyAll } = usePendingStore.getState();
    enqueue('c1', op());
    const result = await applyAll('c1', ctx);
    expect(result).toEqual({ ok: 1, failed: 0, committed: false });
  });

  it('skips already-done ops on a retry and re-runs the rest', async () => {
    const calls: { name: string; args?: Record<string, unknown> }[] = [];
    const ctx = fakeCtx(async (name, args) => {
      calls.push({ name, args });
      return {};
    });
    const { enqueue, applyAll } = usePendingStore.getState();
    enqueue('c1', op({ slotName: 'a' }));
    const idB = enqueue('c1', op({ slotName: 'b' }));
    // Pretend 'a' is already done from a prior partial run.
    usePendingStore.setState((s) => {
      const next = new Map(s.queues);
      next.set('c1', (s.queues.get('c1') ?? []).map((q, i) => (i === 0 ? { ...q, status: 'done' } : q)));
      return { queues: next };
    });
    await applyAll('c1', ctx);
    // setSlot for 'b' + commitStation; 'a' skipped.
    expect(calls.map((c) => c.name)).toEqual(['setSlot', 'commitStation']);
    expect(calls[0]?.args).toMatchObject({ slotName: 'b' });
    expect(usePendingStore.getState().queues.get('c1')?.find((q) => q.id === idB)?.status).toBe('done');
  });

  it('does nothing (no commitStation) when the queue is empty', async () => {
    const callTool = vi.fn(async () => ({}));
    const ctx = fakeCtx(callTool);
    const result = await usePendingStore.getState().applyAll('cX', ctx);
    expect(result).toEqual({ ok: 0, failed: 0, committed: false });
    expect(callTool).not.toHaveBeenCalled();
  });
});
