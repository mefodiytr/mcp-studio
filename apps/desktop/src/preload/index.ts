import { contextBridge } from 'electron';

// Minimal preload. The typed IPC bridge (request/response + main→renderer
// events, zod-validated at the boundary) lands in C4 under
// apps/desktop/src/shared. For now we only surface the runtime versions so the
// renderer can confirm it is running inside Electron.
const studio = {
  versions: { ...process.versions },
};

contextBridge.exposeInMainWorld('studio', studio);

export type StudioBridge = typeof studio;
