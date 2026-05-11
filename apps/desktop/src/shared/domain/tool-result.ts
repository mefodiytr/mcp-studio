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

/** The outcome of an invocation: exactly one of `result` / `error` is non-null. */
export const toolCallOutcomeSchema = z.object({
  result: callToolResultSchema.nullable(),
  error: toolCallErrorSchema.nullable(),
});
export type ToolCallOutcome = z.infer<typeof toolCallOutcomeSchema>;
