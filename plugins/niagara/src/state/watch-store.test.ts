import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectWatches, useWatchStore, withWatchesForProfile, type Watch } from './watch-store';

const w = (over: Partial<Watch> = {}): Watch => ({
  ord: 'station:|slot:/Logic/Sensor1',
  intervalMs: 5000,
  ...over,
});

/** Install a fake `window.studio` for the IPC calls. */
function mockBridge() {
  const list = vi.fn<(p: { profileId: string }) => Promise<{ watches: Watch[] }>>(async () => ({ watches: [] }));
  const set = vi.fn<(p: { profileId: string; watches: Watch[] }) => Promise<unknown>>(async () => ({}));
  const invoke = vi.fn(async (channel: string, params: unknown): Promise<unknown> => {
    if (channel === 'watches:list') return list(params as { profileId: string });
    if (channel === 'watches:set') return set(params as { profileId: string; watches: Watch[] });
    throw new Error(`unexpected channel: ${channel}`);
  });
  (globalThis as { window?: { studio?: unknown } }).window = { studio: { invoke } };
  return { list, set };
}

beforeEach(() => {
  useWatchStore.setState({ watches: new Map(), loaded: new Set() });
  (globalThis as { window?: unknown }).window = undefined;
});

describe('withWatchesForProfile (pure reducer)', () => {
  it('writes the list for a profile and marks it loaded', () => {
    const next = withWatchesForProfile({ watches: new Map(), loaded: new Set() }, 'p1', [w()]);
    expect([...next.watches.entries()]).toEqual([['p1', [w()]]]);
    expect([...next.loaded]).toEqual(['p1']);
  });

  it('an empty list removes the profile entry but keeps it loaded', () => {
    const seed = withWatchesForProfile({ watches: new Map(), loaded: new Set() }, 'p1', [w()]);
    const next = withWatchesForProfile(seed, 'p1', []);
    expect(next.watches.has('p1')).toBe(false);
    expect([...next.loaded]).toEqual(['p1']);
  });

  it('does not mutate the input maps/sets', () => {
    const src = { watches: new Map<string, readonly Watch[]>([['p1', [w()]]]), loaded: new Set(['p1']) };
    withWatchesForProfile(src, 'p2', [w({ ord: 'b' })]);
    expect([...src.watches.keys()]).toEqual(['p1']);
    expect([...src.loaded]).toEqual(['p1']);
  });
});

describe('useWatchStore', () => {
  it('ensureLoaded hydrates from `watches:list` and only once per profile', async () => {
    const { list } = mockBridge();
    list.mockResolvedValueOnce({ watches: [w({ ord: 'a' })] });
    await useWatchStore.getState().ensureLoaded('p1');
    await useWatchStore.getState().ensureLoaded('p1');
    expect(list).toHaveBeenCalledTimes(1);
    expect(useWatchStore.getState().watches.get('p1')).toEqual([w({ ord: 'a' })]);
  });

  it('upsert adds a new watch and persists', async () => {
    const { set } = mockBridge();
    await useWatchStore.getState().upsert('p1', w({ ord: 'a' }));
    expect(useWatchStore.getState().watches.get('p1')).toEqual([w({ ord: 'a' })]);
    expect(set).toHaveBeenCalledWith({ profileId: 'p1', watches: [w({ ord: 'a' })] });
  });

  it('upsert updates an existing watch by ord (no duplicate)', async () => {
    mockBridge();
    await useWatchStore.getState().upsert('p1', w({ ord: 'a' }));
    await useWatchStore.getState().upsert('p1', w({ ord: 'a', intervalMs: 10_000 }));
    const list = useWatchStore.getState().watches.get('p1');
    expect(list).toHaveLength(1);
    expect(list?.[0]?.intervalMs).toBe(10_000);
  });

  it('patch tweaks one field (e.g. interval) and persists the new list', async () => {
    const { set } = mockBridge();
    await useWatchStore.getState().upsert('p1', w({ ord: 'a' }));
    set.mockClear();
    await useWatchStore.getState().patch('p1', 'a', { intervalMs: 0 });
    expect(useWatchStore.getState().watches.get('p1')?.[0]?.intervalMs).toBe(0);
    expect(set).toHaveBeenCalledWith({ profileId: 'p1', watches: [w({ ord: 'a', intervalMs: 0 })] });
  });

  it('remove drops by ord; clear drops everything for a profile', async () => {
    mockBridge();
    await useWatchStore.getState().upsert('p1', w({ ord: 'a' }));
    await useWatchStore.getState().upsert('p1', w({ ord: 'b' }));
    await useWatchStore.getState().remove('p1', 'a');
    expect(useWatchStore.getState().watches.get('p1')?.map((x) => x.ord)).toEqual(['b']);
    await useWatchStore.getState().clear('p1');
    expect(useWatchStore.getState().watches.has('p1')).toBe(false);
  });
});

describe('selectWatches', () => {
  it('returns the per-profile list, or a stable empty array (React #185 guard)', () => {
    const state = withWatchesForProfile({ watches: new Map(), loaded: new Set() }, 'p1', [w()]);
    const full: ReturnType<typeof useWatchStore.getState> = {
      ...useWatchStore.getState(),
      ...state,
    } as ReturnType<typeof useWatchStore.getState>;
    expect(selectWatches('p1')(full)).toEqual([w()]);
    // Same empty reference on every call (the M3 Zustand-singleton lesson —
    // a fresh `[]` would loop subscribers via `Object.is`).
    expect(selectWatches('p2')(full)).toBe(selectWatches('pX')(full));
    expect(selectWatches(undefined)(full)).toBe(selectWatches('p2')(full));
  });
});
