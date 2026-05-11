import { z } from 'zod';

/** A snapshot of a live connection, safe to send to the renderer. */
export const connectionSummarySchema = z.object({
  connectionId: z.string(),
  profileId: z.string(),
  transportKind: z.enum(['http', 'sse', 'stdio']),
  serverInfo: z.object({ name: z.string(), version: z.string(), title: z.string().optional() }).nullable(),
  capabilities: z.object({ tools: z.number(), resources: z.number(), prompts: z.number() }),
});
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

/** A trimmed tool descriptor for the dev harness (the full schema lands in C14). */
export const toolSummarySchema = z.object({ name: z.string(), description: z.string().optional() });
export type ToolSummary = z.infer<typeof toolSummarySchema>;
