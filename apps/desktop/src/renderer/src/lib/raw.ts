import type { RawRequestOutcome } from '@shared/domain/tool-result';

/** Send an arbitrary JSON-RPC request on a connection (the protocol escape hatch). */
export async function sendRawRequest(
  connectionId: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<RawRequestOutcome> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio.invoke('connections:raw', { connectionId, method, params });
}
