import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  EventChannel,
  EventPayload,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse,
} from '../shared/ipc/contract';
import type { StudioBridge } from '../shared/ipc/bridge';

// Thin, typed pass-through to the main process. Validation lives on the main
// side (see shared/ipc/contract.ts) so this script — which also runs in the
// sandboxed preload context — stays minimal and carries no zod.
const studio: StudioBridge = {
  versions: { ...process.versions },

  invoke<C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): Promise<InvokeResponse<C>> {
    return ipcRenderer.invoke(channel, request) as Promise<InvokeResponse<C>>;
  },

  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: EventPayload<C>): void => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  ping(): Promise<InvokeResponse<'app:ping'>> {
    return this.invoke('app:ping', { at: Date.now() });
  },
};

contextBridge.exposeInMainWorld('studio', studio);

export type { StudioBridge };
