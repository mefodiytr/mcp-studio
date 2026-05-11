import { z } from 'zod';

import { profileInputSchema, profileSchema } from '../domain/profile';

/**
 * The single source of truth for the renderer ↔ main IPC surface.
 *
 * - `invokeChannels`: request/response calls (renderer → main), backed by
 *   `ipcRenderer.invoke` / `ipcMain.handle`.
 * - `eventChannels`: push notifications (main → renderer), backed by
 *   `webContents.send` / `ipcRenderer.on`.
 *
 * Both sides import this for compile-time types; the main process additionally
 * runs the zod parsers below at the boundary (requests in / responses out /
 * events out), so a malformed payload fails loudly with a precise error. The
 * renderer trusts main (a compromised main is game over regardless), so the
 * preload bridge is a thin typed pass-through and carries no zod at runtime.
 */
export const invokeChannels = {
  /** Liveness / round-trip health check. Permanent. */
  'app:ping': {
    request: z.object({ at: z.number() }),
    response: z.object({ pong: z.literal(true), at: z.number(), echoedAt: z.number() }),
  },

  // ── Connection profiles (workspace store; secrets live in the vault) ───────
  'profiles:list': {
    request: z.object({}),
    response: z.array(profileSchema),
  },
  'profiles:get': {
    request: z.object({ id: z.string() }),
    response: profileSchema,
  },
  'profiles:create': {
    request: z.object({ input: profileInputSchema }),
    response: profileSchema,
  },
  'profiles:update': {
    request: z.object({ id: z.string(), input: profileInputSchema }),
    response: profileSchema,
  },
  'profiles:delete': {
    request: z.object({ id: z.string() }),
    response: z.object({ id: z.string() }),
  },
} as const;

export const eventChannels = {
  /** Demo heartbeat — proves the event mechanism; superseded by real sources
   *  (connection status in C11, the protocol tap in C9). */
  'app:tick': z.object({ seq: z.number().int().nonnegative(), at: z.number() }),
} as const;

export type InvokeChannel = keyof typeof invokeChannels;
export type EventChannel = keyof typeof eventChannels;

export type InvokeRequest<C extends InvokeChannel> = z.infer<(typeof invokeChannels)[C]['request']>;
export type InvokeResponse<C extends InvokeChannel> = z.infer<(typeof invokeChannels)[C]['response']>;
export type EventPayload<C extends EventChannel> = z.infer<(typeof eventChannels)[C]>;

// ── Pure boundary validators (no Electron imports — unit-testable on their own) ──

export function parseInvokeRequest<C extends InvokeChannel>(channel: C, raw: unknown): InvokeRequest<C> {
  return invokeChannels[channel].request.parse(raw) as InvokeRequest<C>;
}

export function parseInvokeResponse<C extends InvokeChannel>(channel: C, raw: unknown): InvokeResponse<C> {
  return invokeChannels[channel].response.parse(raw) as InvokeResponse<C>;
}

export function parseEvent<C extends EventChannel>(channel: C, raw: unknown): EventPayload<C> {
  return eventChannels[channel].parse(raw) as EventPayload<C>;
}
