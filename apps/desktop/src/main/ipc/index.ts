import { BrowserWindow, ipcMain } from 'electron';

import {
  parseEvent,
  parseInvokeRequest,
  parseInvokeResponse,
  type EventChannel,
  type EventPayload,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
} from '@shared/ipc/contract';

type InvokeHandler<C extends InvokeChannel> = (
  request: InvokeRequest<C>,
) => InvokeResponse<C> | Promise<InvokeResponse<C>>;

/** Register a typed `ipcMain.handle` whose request and response are zod-checked. */
function handle<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>): void {
  ipcMain.handle(channel, async (_event, raw: unknown) => {
    const request = parseInvokeRequest(channel, raw);
    const response = await handler(request);
    return parseInvokeResponse(channel, response);
  });
}

/** Validate and broadcast an event payload to every open renderer. */
export function emitToRenderers<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
  const validated = parseEvent(channel, payload);
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, validated);
  }
}

/** Wire all IPC request handlers. Called once after `app.whenReady()`. */
export function registerIpcHandlers(): void {
  handle('app:ping', (request) => ({ pong: true, at: Date.now(), echoedAt: request.at }));
}

/**
 * Demo event producer: emits `app:tick` periodically so the event channel has a
 * source from day one. Replaced by real producers (connection status in C11,
 * the protocol tap in C9). Returns a stop function.
 */
export function startDemoEventSource(): () => void {
  let seq = 0;
  const timer = setInterval(() => {
    emitToRenderers('app:tick', { seq: ++seq, at: Date.now() });
  }, 3000);
  return () => clearInterval(timer);
}
