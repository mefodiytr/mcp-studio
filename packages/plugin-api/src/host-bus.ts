import { create } from 'zustand';

/**
 * **M5 C79** — small renderer-side pub/sub bus the host + plugins share. Lives
 * in `plugin-api` (not in `apps/desktop`) so plugins can subscribe via a
 * stable workspace import; pnpm's hoisted node_modules give both sides the
 * same module instance — every consumer sees the same Zustand store.
 *
 * Currently carries one channel: **ord navigation**. The chat view's
 * `<ord>X</ord>` chip click publishes; the host's AppShell consumes the
 * trigger (switches to the active plugin's Explorer view if one exists);
 * the plugin's Explorer view also subscribes (calls its `select(ord)` to
 * reveal the ord in its tree). The two consumers don't race because the
 * publisher's API splits **peek** (non-destructive — used by AppShell to
 * trigger a view switch on render) from **consume** (clears — used by the
 * plugin's effect that needs to fire once per publication).
 *
 * Future channels (M6+) — flow-builder run requests / RAG document refs /
 * cross-plugin "open this thing" intents — land here as additional fields
 * on the same store shape.
 */
interface HostBusState {
  pendingOrdNav: { ord: string } | null;
  publishOrdNav: (ord: string) => void;
  /** Peek without clearing — used by the AppShell's view-switch effect. */
  peekOrdNav: () => { ord: string } | null;
  /** Consume + clear — used by the plugin Explorer's select-and-reveal
   *  effect. After this returns, subsequent peek/consume calls see null
   *  until the next publish. */
  consumeOrdNav: () => { ord: string } | null;
}

export const useHostBus = create<HostBusState>((set, get) => ({
  pendingOrdNav: null,
  publishOrdNav: (ord) => set({ pendingOrdNav: { ord } }),
  peekOrdNav: () => get().pendingOrdNav,
  consumeOrdNav: () => {
    const pending = get().pendingOrdNav;
    if (pending) set({ pendingOrdNav: null });
    return pending;
  },
}));
