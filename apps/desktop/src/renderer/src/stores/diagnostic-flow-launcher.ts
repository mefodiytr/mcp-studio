import { create } from 'zustand';

import type { TaggedDiagnosticFlow } from '@renderer/lib/plugin-prompts';

/**
 * Cross-cut launcher state — the command palette enqueues a diagnostic-flow
 * launch request, the chat view consumes it on mount or on the next render.
 *
 * Why a store and not props through AppShell: the palette commands are built
 * inside `useAppCommands`, which doesn't have a clean handle to the chat
 * view's state. A small pub/sub store keeps the palette → chat path explicit
 * without prop-drilling through AppShell + LeftRail + tabs.
 */
interface LauncherState {
  pending: TaggedDiagnosticFlow | null;
  enqueue: (flow: TaggedDiagnosticFlow) => void;
  consume: () => TaggedDiagnosticFlow | null;
}

export const useDiagnosticFlowLauncher = create<LauncherState>((set, get) => ({
  pending: null,
  enqueue: (flow) => set({ pending: flow }),
  consume: () => {
    const flow = get().pending;
    if (flow) set({ pending: null });
    return flow;
  },
}));
