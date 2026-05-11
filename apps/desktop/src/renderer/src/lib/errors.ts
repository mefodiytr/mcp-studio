export interface MappedError {
  message: string;
  /** JSON-RPC / MCP error code, when the cause carried one. */
  code?: number;
  /** A short hint for the user, when the code is recognised. */
  suggestion?: string;
}

const KNOWN_CODES = new Map<number, { label: string; suggestion?: string }>([
  [-32700, { label: 'Parse error', suggestion: 'The server sent malformed JSON.' }],
  [-32600, { label: 'Invalid request' }],
  [-32601, { label: 'Method not found', suggestion: "The server doesn't implement this method." }],
  [-32602, { label: 'Invalid params', suggestion: 'Check the arguments against the schema.' }],
  [-32603, { label: 'Internal error', suggestion: 'Something went wrong on the server side.' }],
  [-32002, { label: 'Server not initialized' }],
  [-32001, { label: 'Request timed out' }],
]);

// Electron prefixes errors thrown in ipcMain.handle handlers.
const IPC_PREFIX = /^Error invoking remote method '[^']+':\s*(?:[A-Za-z]+Error:\s*)?(.*)$/s;

function unwrapMessage(message: string): string {
  const match = IPC_PREFIX.exec(message);
  return match?.[1]?.trim() || message;
}

function hasNumber<K extends string>(value: unknown, key: K): value is Record<K, number> {
  return (
    typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[key] === 'number'
  );
}

/** Best-effort interpretation of an error from main: an `Error`, a JSON-RPC
 *  error envelope `{ code, message, data }`, or a bare string. */
export function mapError(cause: unknown): MappedError {
  if (hasNumber(cause, 'code')) {
    const obj = cause as { code: number; message?: unknown };
    const known = KNOWN_CODES.get(obj.code);
    const rawMessage = typeof obj.message === 'string' ? obj.message : (known?.label ?? 'Error');
    return { message: unwrapMessage(rawMessage), code: obj.code, suggestion: known?.suggestion };
  }
  if (cause instanceof Error) return { message: unwrapMessage(cause.message) };
  if (typeof cause === 'string') return { message: cause };
  return { message: 'Unexpected error' };
}

export function describeError(cause: unknown): string {
  const mapped = mapError(cause);
  return mapped.code != null ? `[${mapped.code}] ${mapped.message}` : mapped.message;
}
