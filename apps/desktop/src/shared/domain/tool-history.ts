import { z } from 'zod';

import { callToolResultSchema, toolCallerSchema, toolCallErrorSchema } from './tool-result';

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
   *  'error' — the call itself failed (JSON-RPC / transport);
   *  'queued' — **M5 C75** — an AI-attributed write was intercepted at the
   *   safety boundary and routed to the operator's pending-changes queue;
   *   the MCP call was NOT made. (Status remains 'queued' even after the
   *   operator applies the op — the apply itself is a separate audit entry
   *   with `actor:'human'` from the Changes view.) */
  status: z.enum(['ok', 'tool-error', 'error', 'queued']),
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
  /** **M5 C75** — caller attribution. Absent = 'human' (every M1–M4 entry
   *  predates this field); present-and-'human' = explicit human intent;
   *  `{type:'ai', conversationId, agentId?}` = the call came from a chat
   *  session's ReAct loop. The History panel "AI-initiated" filter (M5
   *  polish) reads this. */
  actor: toolCallerSchema.optional(),
});
export type ToolHistoryEntry = z.infer<typeof toolHistoryEntrySchema>;
