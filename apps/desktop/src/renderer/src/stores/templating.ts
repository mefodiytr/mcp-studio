import { create } from 'zustand';

/**
 * The active plugin view's "current directory" (e.g. the Niagara explorer's
 * selected ORD), published via `PluginContext.setCwd` and read by the tool-call
 * argument templater for the `{{cwd}}` token. Ephemeral (not persisted) — a
 * single global value (the most-recently-set one); per-connection cwd is a
 * follow-up if it's needed.
 */
interface TemplatingState {
  cwd: string | undefined;
  setCwd: (path: string | undefined) => void;
}

export const useTemplatingStore = create<TemplatingState>((set) => ({
  cwd: undefined,
  setCwd: (path) => set({ cwd: path }),
}));
