import { z } from 'zod';

import { callToolResultSchema, toolCallErrorSchema } from './tool-result';

/** A persisted record of one tool invocation. Large binary payloads in the
 *  result are sanitized before storage (see the repository). */
export const toolHistoryEntrySchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  profileId: z.string(),
  /** Server name at call time (for display when the connection is gone). */
  serverName: z.string().nullable(),
  toolName: z.string(),
  /** The arguments passed (whatever the form produced). */
  args: z.unknown(),
  /** 'ok' — the tool succeeded; 'tool-error' — the tool returned isError;
   *  'error' — the call itself failed (JSON-RPC / transport). */
  status: z.enum(['ok', 'tool-error', 'error']),
  result: callToolResultSchema.nullable(),
  error: toolCallErrorSchema.nullable(),
  /** ISO timestamp of the call. */
  ts: z.string(),
  /** Round-trip duration in milliseconds. */
  durationMs: z.number(),
  /** True if this call mutated server state — computed at call time from the
   *  *effective* tool annotations (after any plugin override), so the audit
   *  trail reflects what the operator actually intended. Absent on entries
   *  written before the audit flag was added. */
  write: z.boolean().optional(),
});
export type ToolHistoryEntry = z.infer<typeof toolHistoryEntrySchema>;
