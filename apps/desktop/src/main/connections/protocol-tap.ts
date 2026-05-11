import type { JSONRPCMessage, MessageDirection } from '@mcp-studio/mcp-client';

import type { ProtocolEvent } from '../../shared/domain/protocol';

const DEFAULT_CAP = 2_000;

interface JsonRpcLike {
  method?: unknown;
  id?: unknown;
  error?: unknown;
}

function classify(message: JsonRpcLike): {
  kind: ProtocolEvent['kind'];
  method?: string;
  id?: string | number;
  isError?: boolean;
} {
  const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : undefined;
  const method = typeof message.method === 'string' ? message.method : undefined;
  if (method !== undefined && id !== undefined) return { kind: 'request', method, id };
  if (method !== undefined) return { kind: 'notification', method };
  return { kind: 'response', id, isError: message.error != null };
}

/**
 * Ring-buffers the JSON-RPC traffic of every connection and emits each message
 * to the renderer. Correlates an incoming response with its outgoing request
 * (by id) to compute round-trip duration. The protocol inspector (C20) renders
 * these; for now they just accumulate. Honest by design — no payload redaction
 * (the HTTP Authorization header never enters the JSON-RPC body, and tool args
 * are shown as the user supplied them).
 */
export class ProtocolTap {
  private readonly buffer: ProtocolEvent[] = [];
  private readonly pending = new Map<string, number>(); // `${connectionId}:${id}` → request ts

  constructor(
    private readonly emit: (event: ProtocolEvent) => void,
    private readonly cap = DEFAULT_CAP,
  ) {}

  record(connectionId: string, direction: MessageDirection, message: JSONRPCMessage): void {
    const ts = Date.now();
    const { kind, method, id, isError } = classify(message as JsonRpcLike);

    let durationMs: number | undefined;
    if (kind === 'request' && direction === 'outgoing' && id !== undefined) {
      this.pending.set(`${connectionId}:${id}`, ts);
    } else if (kind === 'response' && direction === 'incoming' && id !== undefined) {
      const key = `${connectionId}:${id}`;
      const startedAt = this.pending.get(key);
      if (startedAt !== undefined) {
        durationMs = ts - startedAt;
        this.pending.delete(key);
      }
    }

    const event: ProtocolEvent = {
      connectionId,
      direction,
      kind,
      method,
      id,
      ts,
      durationMs,
      isError,
      payload: message,
    };
    this.buffer.push(event);
    if (this.buffer.length > this.cap) this.buffer.splice(0, this.buffer.length - this.cap);
    this.emit(event);
  }

  /** Drop pending-request correlations for a connection that closed (keeps its
   *  buffered events — the inspector may still want to see them). */
  forget(connectionId: string): void {
    const prefix = `${connectionId}:`;
    for (const key of [...this.pending.keys()]) {
      if (key.startsWith(prefix)) this.pending.delete(key);
    }
  }

  backlog(): ProtocolEvent[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer.length = 0;
    this.pending.clear();
  }
}
