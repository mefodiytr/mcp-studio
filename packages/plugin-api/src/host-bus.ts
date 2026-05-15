import { create } from 'zustand';

/**
 * **M5 C79** — small renderer-side pub/sub bus the host + plugins share. Lives
 * in `plugin-api` (not in `apps/desktop`) so plugins can subscribe via a
 * stable workspace import; pnpm's hoisted node_modules give both sides the
 * same module instance — every consumer sees the same Zustand store.
 *
 * Two channels live here today, distinguished by their lifecycle shape:
 *
 *   **Event channels** (one-shot, `publish` → `peek`/`consume`):
 *   - `pendingOrdNav` — the chat view's `<ord>X</ord>` chip click publishes;
 *     AppShell peeks to switch view; the plugin's Explorer consumes to
 *     reveal-and-clear. Split peek/consume so the two consumers don't race.
 *
 *   **State channels** (continuous, `publish` overwrites; `peek` is the read):
 *   - `selectedOrd` (M6 C87) — the active plugin's Explorer publishes its
 *     current selection (ord + display label) whenever it changes; the chat
 *     empty state + command palette read the value at render time to
 *     decorate diagnostic-flow buttons ("Run rooftop diagnosis on `AHU1`")
 *     and pre-fill flow-launch params. Null when nothing is selected (or
 *     when the Explorer view is unmounted — the publisher clears on unmount).
 *
 * Future channels (M7+) — flow-builder run requests / RAG document refs /
 * cross-plugin "open this thing" intents — land here as additional fields
 * on the same store shape, following the event-vs-state shape distinction
 * above.
 */
export interface HostBusSelection {
  /** ORD of the currently selected node (the canonical id consumers
   *  template against — e.g. niagara plan params take an ord-or-name
   *  string). */
  ord: string;
  /** Human-readable label for UI decoration (e.g. "AHU-1"). Optional —
   *  consumers fall back to a short suffix of `ord` if absent. */
  displayName?: string;
}

interface HostBusState {
  pendingOrdNav: { ord: string } | null;
  publishOrdNav: (ord: string) => void;
  /** Peek without clearing — used by the AppShell's view-switch effect. */
  peekOrdNav: () => { ord: string } | null;
  /** Consume + clear — used by the plugin Explorer's select-and-reveal
   *  effect. After this returns, subsequent peek/consume calls see null
   *  until the next publish. */
  consumeOrdNav: () => { ord: string } | null;

  /** **M6 C87 — state channel.** The plugin's Explorer publishes its current
   *  selection (or null when nothing is selected / the view unmounts). */
  selectedOrd: HostBusSelection | null;
  /** Replace the current selection. `null` clears it. */
  publishSelectedOrd: (selection: HostBusSelection | null) => void;
  /** Pure read — does not clear. Returns the last published selection or
   *  null. Safe to call from a render path. */
  peekSelectedOrd: () => HostBusSelection | null;
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

  selectedOrd: null,
  publishSelectedOrd: (selection) => {
    // Cheap reference-equality short-circuit: if the publisher fires for
    // every render of the upstream selector (Niagara's selected/known
    // useEffect) but the value hasn't changed, we don't want to trigger
    // every consumer's re-render. Compare structurally on the small shape.
    const prev = get().selectedOrd;
    if (
      (prev === null && selection === null) ||
      (prev && selection && prev.ord === selection.ord && prev.displayName === selection.displayName)
    ) {
      return;
    }
    set({ selectedOrd: selection });
  },
  peekSelectedOrd: () => get().selectedOrd,
}));
