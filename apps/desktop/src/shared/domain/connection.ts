import { z } from 'zod';

/** A snapshot of a connection (live or errored), safe to send to the renderer. */
export const connectionSummarySchema = z.object({
  connectionId: z.string(),
  profileId: z.string(),
  transportKind: z.enum(['http', 'sse', 'stdio']),
  status: z.enum(['connected', 'error']),
  serverInfo: z.object({ name: z.string(), version: z.string(), title: z.string().optional() }).nullable(),
  capabilities: z.object({ tools: z.number(), resources: z.number(), prompts: z.number() }),
  /** Round-trip latency of an MCP ping at connect time, in ms (null if unknown). */
  latencyMs: z.number().nullable(),
  /** Set when status is "error" — the reason the session dropped. */
  error: z.string().nullable(),
});
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

/** A trimmed tool descriptor for the dev harness (the full schema lands in C14). */
export const toolSummarySchema = z.object({ name: z.string(), description: z.string().optional() });
export type ToolSummary = z.infer<typeof toolSummarySchema>;
