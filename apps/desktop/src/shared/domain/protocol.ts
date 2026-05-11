import { z } from 'zod';

/** One JSON-RPC message observed on a connection's transport (renderer ↔ no —
 *  client ↔ server). The protocol inspector (C20) consumes these. */
export const protocolEventSchema = z.object({
  connectionId: z.string(),
  /** Relative to the app: outgoing = client → server, incoming = server → client. */
  direction: z.enum(['outgoing', 'incoming']),
  kind: z.enum(['request', 'response', 'notification']),
  /** JSON-RPC method (absent on responses). */
  method: z.string().optional(),
  /** JSON-RPC id (absent on notifications). */
  id: z.union([z.string(), z.number()]).optional(),
  /** When the message was observed (epoch ms). */
  ts: z.number(),
  /** For incoming responses: time since the matching outgoing request, in ms. */
  durationMs: z.number().optional(),
  /** Whether the response carried a JSON-RPC error. */
  isError: z.boolean().optional(),
  /** The raw JSON-RPC message. */
  payload: z.unknown(),
});
export type ProtocolEvent = z.infer<typeof protocolEventSchema>;
