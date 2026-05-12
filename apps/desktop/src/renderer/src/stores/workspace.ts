import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { AppView } from '@renderer/app/LeftRail';

let counter = 0;
const newId = (): string => `tab-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** A plugin-contributed view, identified by the plugin name + the view id. */
export interface PluginViewRef {
  plugin: string;
  viewId: string;
}

/** What a tab shows: a built-in `AppView`, or a plugin view (which is bound to
 *  a connection — `Tab.connectionId` is then required). */
export type TabView = AppView | PluginViewRef;

function isPluginView(view: TabView): view is PluginViewRef {
  return typeof view === 'object';
}
function sameView(a: TabView, b: TabView): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.plugin === b.plugin && a.viewId === b.viewId;
}

/** One tab in the workspace = an instance of a view, optionally bound to a
 *  connection. Built-in views (`view: string`) carry their own connection
 *  picker so `connectionId` is unused; a plugin view is always connection-bound. */
export interface Tab {
  id: string;
  view: TabView;
  connectionId?: string;
  pinned: boolean;
}

interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  /** Append a new tab and (unless `activate: false`) focus it. */
  openTab: (view: TabView, opts?: { connectionId?: string; activate?: boolean }) => string;
  /** Focus an existing tab for `view` (+ `connectionId`), or open one. */
  focusOrOpen: (view: TabView, connectionId?: string) => void;
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
      focusOrOpen: (view, connectionId) => {
        const existing = get().tabs.find((t) => sameView(t.view, view) && t.connectionId === connectionId);
        if (existing) set({ activeTabId: existing.id });
        else get().openTab(view, { connectionId });
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
      // Plugin tabs are inherently ephemeral (bound to a live connection, which
      // doesn't survive a restart) — persist only the built-in ones, and keep
      // `activeTabId` valid against what's left.
      partialize: (state) => {
        const tabs = state.tabs
          .filter((t): t is Tab & { view: AppView } => !isPluginView(t.view))
          .map(({ id, view, pinned }) => ({ id, view, pinned }));
        const activeStillThere = tabs.some((t) => t.id === state.activeTabId);
        return { tabs, activeTabId: activeStillThere ? state.activeTabId : (tabs[0]?.id ?? null) };
      },
    },
  ),
);
