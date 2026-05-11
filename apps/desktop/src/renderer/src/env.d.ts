/// <reference types="vite/client" />
import type { StudioBridge } from '@shared/ipc/bridge';

declare global {
  interface Window {
    /** Bridge exposed by the preload script (contextBridge). Undefined only
     *  outside Electron. */
    studio?: StudioBridge;
  }
}
