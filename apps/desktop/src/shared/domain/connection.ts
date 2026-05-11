import { z } from 'zod';

/** A snapshot of a connection (live or errored), safe to send to the renderer. */
export const connectionSummarySchema = z.object({
  connectionId: z.string(),
  profileId: z.string(),
  transportKind: z.enum(['http', 'sse', 'stdio']),
  status: z.enum(['connected', 'error']),
  serverInfo: z.object({ name: z.string(), version: z.string(), title: z.string().optional() }).nullable(),
  capabilities: z.object({ tools: z.number(), resources: z.number(), prompts: z.number() }),
  /** Latest MCP-ping round-trip, in ms (null if unknown). */
  latencyMs: z.number().nullable(),
  /** Recent ping samples (most recent last; capped) for a sparkline. */
  latencyHistory: z.array(z.number()),
  /** Streamable-HTTP session id (`Mcp-Session-Id`); null for stdio/sse. */
  sessionId: z.string().nullable(),
  /** Set when status is "error" — the reason the session dropped. */
  error: z.string().nullable(),
});
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

/** Tool annotation hints (`tools/list` → `Tool.annotations`). */
export const toolAnnotationsSchema = z
  .object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .passthrough();
export type ToolAnnotations = z.infer<typeof toolAnnotationsSchema>;

/** A tool as advertised by `tools/list`, trimmed for the catalog UI. */
export const toolDescriptorSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  /** The raw JSON Schema for the tool's arguments. */
  inputSchema: z.unknown(),
  annotations: toolAnnotationsSchema.optional(),
});
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;
