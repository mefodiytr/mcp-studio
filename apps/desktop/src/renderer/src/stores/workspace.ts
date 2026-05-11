import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { AppView } from '@renderer/app/LeftRail';

let counter = 0;
const newId = (): string => `tab-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** One tab in the workspace = an instance of a view, optionally bound to a
 *  specific connection (the binding is forward-looking; in M1 each view-tab
 *  still carries its own connection picker, so `connectionId` is unused). */
export interface Tab {
  id: string;
  view: AppView;
  connectionId?: string;
  pinned: boolean;
}

interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  /** Append a new tab and (unless `activate: false`) focus it. */
  openTab: (view: AppView, opts?: { connectionId?: string; activate?: boolean }) => string;
  /** Focus an existing plain tab for `view`, or open one if there isn't one. */
  focusOrOpen: (view: AppView) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  moveTab: (id: string, toIndex: number) => void;
  togglePin: (id: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      openTab: (view, opts = {}) => {
        const tab: Tab = { id: newId(), view, connectionId: opts.connectionId, pinned: false };
        set((state) => ({
          tabs: [...state.tabs, tab],
          activeTabId: opts.activate === false ? state.activeTabId : tab.id,
        }));
        return tab.id;
      },
      focusOrOpen: (view) => {
        const existing = get().tabs.find((t) => t.view === view && t.connectionId === undefined);
        if (existing) set({ activeTabId: existing.id });
        else get().openTab(view);
      },
      closeTab: (id) =>
        set((state) => {
          const index = state.tabs.findIndex((t) => t.id === id);
          if (index < 0) return state;
          const tabs = state.tabs.filter((t) => t.id !== id);
          let activeTabId = state.activeTabId;
          if (activeTabId === id) activeTabId = (tabs[index] ?? tabs[index - 1])?.id ?? null;
          return { tabs, activeTabId };
        }),
      activateTab: (id) => set({ activeTabId: id }),
      moveTab: (id, toIndex) =>
        set((state) => {
          const from = state.tabs.findIndex((t) => t.id === id);
          if (from < 0) return state;
          const tabs = state.tabs.slice();
          const [moved] = tabs.splice(from, 1);
          if (!moved) return state;
          tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, moved);
          return { tabs };
        }),
      togglePin: (id) =>
        set((state) => ({ tabs: state.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)) })),
    }),
    {
      name: 'mcp-studio.workspace',
      // Connections don't survive a restart, so a persisted `connectionId` would
      // be stale — drop it (and any other transient field) on the way out.
      partialize: (state) => ({
        tabs: state.tabs.map(({ id, view, pinned }) => ({ id, view, pinned })),
        activeTabId: state.activeTabId,
      }),
    },
  ),
);
