/// <reference types="vite/client" />

interface Window {
  /**
   * Bridge exposed by the preload script. Currently minimal; the full typed
   * IPC surface arrives in C4.
   */
  studio?: {
    versions: Record<string, string>;
  };
}
