import { create } from 'zustand';

import type { NiagaraNode } from '../lib/niagara-api';
import { ancestorOrds, ROOT_ORD } from '../lib/ord';

/**
 * Shared state for the Niagara explorer views (tree, breadcrumbs, and — later —
 * the property sheet, folder view and quick-nav). Module-global: M2 surfaces one
 * Niagara connection at a time (the rail binds the first connected one); a
 * per-connection split is a follow-up. Survives tab switches; not persisted.
 */
interface ExplorerState {
  /** ORDs whose children are shown in the tree (the root is always expanded). */
  expanded: ReadonlySet<string>;
  /** The selected node — drives the breadcrumb / property sheet / `{{cwd}}`. */
  selected: string | null;
  /** Every node seen so far, by ORD — feeds quick-nav and breadcrumb labels. */
  known: ReadonlyMap<string, NiagaraNode>;
  toggle: (ord: string) => void;
  collapse: (ord: string) => void;
  select: (ord: string | null) => void;
  /** Expand every ancestor of `ord` (so the tree renders down to it) and select it. */
  reveal: (ord: string) => void;
  /** Record nodes (and their nested children) in the `known` map. */
  remember: (nodes: NiagaraNode[]) => void;
}

export const useExplorerStore = create<ExplorerState>((set) => ({
  expanded: new Set([ROOT_ORD]),
  selected: null,
  known: new Map(),
  toggle: (ord) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (next.has(ord)) next.delete(ord);
      else next.add(ord);
      return { expanded: next };
    }),
  collapse: (ord) =>
    set((s) => {
      if (!s.expanded.has(ord)) return s;
      const next = new Set(s.expanded);
      next.delete(ord);
      return { expanded: next };
    }),
  select: (ord) => set({ selected: ord }),
  reveal: (ord) =>
    set((s) => {
      const next = new Set(s.expanded);
      for (const a of ancestorOrds(ord)) next.add(a);
      return { expanded: next, selected: ord };
    }),
  remember: (nodes) =>
    set((s) => {
      const next = new Map(s.known);
      const add = (n: NiagaraNode): void => {
        if (n.ord) next.set(n.ord, n);
        n.children?.forEach(add);
      };
      nodes.forEach(add);
      return { known: next };
    }),
}));
