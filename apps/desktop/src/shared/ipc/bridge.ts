import type {
  EventChannel,
  EventPayload,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse,
} from './contract';

/**
 * The API the preload script exposes on `window.studio` via `contextBridge`.
 * Kept in `shared/` so the preload implementation and the renderer's ambient
 * `Window` typing reference one definition.
 */
export interface StudioBridge {
  /** Electron / Chromium / Node runtime versions (from `process.versions`). */
  versions: Record<string, string | undefined>;
  /** Typed request/response call into the main process. */
  invoke<C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): Promise<InvokeResponse<C>>;
  /** Subscribe to a main→renderer event channel; returns an unsubscribe fn. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void;
  /** Round-trip health check. */
  ping(): Promise<InvokeResponse<'app:ping'>>;
}
