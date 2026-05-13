import { create } from 'zustand';

/**
 * Structural mirror of the host's `@shared/domain/watches.Watch` shape. The
 * plugin reaches the host through raw IPC (`window.studio.invoke('watches:*')`)
 * — same abstraction-leak pattern as the M3 bootstrap's `credentials:set` —
 * so a local type definition avoids a cross-package `@shared` import. Tracked
 * in `docs/m4-followups.md` as a plugin-api seam (`ctx.workspace.watches`) to
 * surface now that there's a second `window.studio` IPC consumer.
 */
export interface Watch {
  ord: string;
  intervalMs: number;
  threshold?: { low?: number; high?: number };
  displayName?: string;
  unit?: string;
}

/**
 * The Niagara live monitor's watch list (M4 C65). Per-profileId, persisted in
 * `workspace.json` via the host's `watches:*` IPC; the Zustand store is the
 * renderer-side mirror — read it cheaply, write through the IPC on every
 * mutation (the list per profile is small enough that bulk-replace is fine).
 * Hydrates on `ensureLoaded(profileId)`; mutating actions are no-ops until
 * `loaded` for that profile.
 *
 * The plugin reaches into `window.studio.invoke('watches:list' / 'watches:set')`
 * directly — same abstraction leak as the M3 bootstrap; tracked in
 * `docs/m3-followups.md` as a plugin-api seam to surface
 * (`ctx.workspace.watches` or similar) when a second plugin asks. One caller
 * doesn't justify the contract extension yet.
 */

export const DEFAULT_INTERVAL_MS = 5000;
/** The intervals exposed in the per-row popover (UI: a select).
 *  `0` is the "paused" sentinel — the monitor view freezes the sparkline. */
export const POLL_INTERVALS_MS = [0, 1000, 5000, 10_000, 30_000, 60_000] as const;
export type PollIntervalMs = (typeof POLL_INTERVALS_MS)[number];

interface WatchState {
  /** profileId → its watch list (insertion order). */
  watches: ReadonlyMap<string, readonly Watch[]>;
  loaded: ReadonlySet<string>;
  /** Hydrate the local mirror from the persisted store; idempotent. */
  ensureLoaded: (profileId: string) => Promise<void>;
  /** Add (or update by ord) a watch for the profile. Persists. */
  upsert: (profileId: string, watch: Watch) => Promise<void>;
  /** Remove by ord. Persists. */
  remove: (profileId: string, ord: string) => Promise<void>;
  /** Patch a watch's mutable fields (interval / threshold / displayName / unit). */
  patch: (profileId: string, ord: string, patch: Partial<Watch>) => Promise<void>;
  /** Drop every watch on the profile. Persists. */
  clear: (profileId: string) => Promise<void>;
}

interface IpcBridge {
  invoke(channel: 'watches:list', params: { profileId: string }): Promise<{ watches: Watch[] }>;
  invoke(channel: 'watches:set', params: { profileId: string; watches: Watch[] }): Promise<unknown>;
}

function bridge(): IpcBridge {
  const win = globalThis as { window?: { studio?: IpcBridge } };
  const studio = win.window?.studio;
  if (!studio) throw new Error('IPC bridge unavailable.');
  return studio;
}

/** Replace one profile's list in the local mirror — pure reducer for the
 *  internal `set` calls below + the tests. */
export function withWatchesForProfile(
  state: Pick<WatchState, 'watches' | 'loaded'>,
  profileId: string,
  next: readonly Watch[],
): Pick<WatchState, 'watches' | 'loaded'> {
  const m = new Map(state.watches);
  if (next.length === 0) m.delete(profileId);
  else m.set(profileId, next);
  const loaded = new Set(state.loaded);
  loaded.add(profileId);
  return { watches: m, loaded };
}

export const useWatchStore = create<WatchState>((set, get) => ({
  watches: new Map(),
  loaded: new Set(),

  ensureLoaded: async (profileId) => {
    if (get().loaded.has(profileId)) return;
    const { watches: list } = await bridge().invoke('watches:list', { profileId });
    set((s) => withWatchesForProfile(s, profileId, list));
  },

  upsert: async (profileId, watch) => {
    const cur = get().watches.get(profileId) ?? [];
    const idx = cur.findIndex((w) => w.ord === watch.ord);
    const next = idx >= 0 ? cur.map((w, i) => (i === idx ? { ...w, ...watch } : w)) : [...cur, watch];
    set((s) => withWatchesForProfile(s, profileId, next));
    await bridge().invoke('watches:set', { profileId, watches: [...next] });
  },

  remove: async (profileId, ord) => {
    const cur = get().watches.get(profileId) ?? [];
    const next = cur.filter((w) => w.ord !== ord);
    set((s) => withWatchesForProfile(s, profileId, next));
    await bridge().invoke('watches:set', { profileId, watches: [...next] });
  },

  patch: async (profileId, ord, patchObj) => {
    const cur = get().watches.get(profileId) ?? [];
    const next = cur.map((w) => (w.ord === ord ? { ...w, ...patchObj } : w));
    set((s) => withWatchesForProfile(s, profileId, next));
    await bridge().invoke('watches:set', { profileId, watches: [...next] });
  },

  clear: async (profileId) => {
    set((s) => withWatchesForProfile(s, profileId, []));
    await bridge().invoke('watches:set', { profileId, watches: [] });
  },
}));

// A stable empty array — see the M3 Zustand-singleton lesson (selectors that
// return a derived collection must return the same reference for the empty
// case, else `Object.is` triggers an infinite re-render).
const EMPTY: readonly Watch[] = [];

/** Selector helper — the per-profile watch list (or a stable empty array). */
export function selectWatches(profileId: string | undefined) {
  return (s: WatchState): readonly Watch[] =>
    profileId ? (s.watches.get(profileId) ?? EMPTY) : EMPTY;
}
