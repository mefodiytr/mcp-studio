import { z } from 'zod';

/** One block of a tool result's `content`. Loose by design — every block has a
 *  `type`; the renderer dispatches on it and falls back to JSON for unknowns. */
export const contentBlockSchema = z.object({ type: z.string() }).passthrough();
export type ContentBlock = z.infer<typeof contentBlockSchema>;

/** The result of `tools/call` (the modern `content` shape). */
export const callToolResultSchema = z
  .object({
    content: z.array(contentBlockSchema),
    isError: z.boolean().optional(),
    structuredContent: z.unknown().optional(),
  })
  .passthrough();
export type CallToolResult = z.infer<typeof callToolResultSchema>;

/** A JSON-RPC-level failure of the call itself (distinct from the tool
 *  reporting an error via `isError`). */
export const toolCallErrorSchema = z.object({
  code: z.number().optional(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type ToolCallError = z.infer<typeof toolCallErrorSchema>;

/** Caller attribution for a `tools:call` invocation. **M5 C75** — used by the
 *  AI-write safety boundary at `ConnectionManager.callTool`:
 *   - absent / `'human'` → execute normally (back-compat for every M1–M4
 *     code path, all of which omit this field);
 *   - `{type:'ai', …}` → main intercepts effective-write calls and returns
 *     a `pendingEnqueued` outcome instead of dispatching to the SDK. */
export const toolCallerSchema = z.union([
  z.literal('human'),
  z.object({
    type: z.literal('ai'),
    conversationId: z.string(),
    agentId: z.string().optional(),
  }),
]);
export type ToolCaller = z.infer<typeof toolCallerSchema>;

/** Returned by main in place of `result` / `error` when an AI-attributed write
 *  call is intercepted at the safety boundary (M5 C75). The renderer routes
 *  this to the active plugin's pending-changes queue for operator approval;
 *  the actual MCP `tools/call` is NOT made. */
export const pendingEnqueuedSchema = z.object({
  toolName: z.string(),
  args: z.record(z.unknown()),
  attribution: toolCallerSchema,
});
export type PendingEnqueued = z.infer<typeof pendingEnqueuedSchema>;

/** The outcome of an invocation: exactly one of `result` / `error` /
 *  `pendingEnqueued` is non-null. (Pre-M5 callers ignore `pendingEnqueued`
 *  and treat the response as the existing `{result, error}` discriminant —
 *  back-compat is preserved because human-attributed calls never produce
 *  this branch.) */
export const toolCallOutcomeSchema = z.object({
  result: callToolResultSchema.nullable(),
  error: toolCallErrorSchema.nullable(),
  pendingEnqueued: pendingEnqueuedSchema.nullable().optional(),
});
export type ToolCallOutcome = z.infer<typeof toolCallOutcomeSchema>;

/** The outcome of a raw JSON-RPC pass-through request. `ok` disambiguates a
 *  legitimately-`null` result from a failure. */
export const rawRequestOutcomeSchema = z.object({
  ok: z.boolean(),
  result: z.unknown(),
  error: toolCallErrorSchema.nullable(),
});
export type RawRequestOutcome = z.infer<typeof rawRequestOutcomeSchema>;
