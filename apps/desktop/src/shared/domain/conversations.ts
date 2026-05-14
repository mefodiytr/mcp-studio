import { z } from 'zod';

/**
 * Conversation persistence shapes — the M5 chat foundation.
 *
 * One conversation = one thread of messages, scoped per-`profileId` (the
 * connection's tool catalog + plugin contributions are shared; chats split
 * the task context so a 50-turn rooftop diagnosis doesn't bleed tokens into
 * the next question). Persisted in `workspace.json` under the M4-style
 * `conversations: Record<profileId, Conversation[]>` field (the watch-list
 * precedent — see `shared/domain/watches.ts`).
 *
 * Content-block shapes mirror Anthropic Messages API conventions so the
 * persisted form maps 1:1 to LLM provider inputs (a conversation history is
 * the same shape the runner threads back into the provider). Strictly typed
 * just enough to round-trip; permissive about extra fields.
 */

export const textBlockSchema = z.object({ type: z.literal('text'), text: z.string() });

export const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
});

export const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.union([textBlockSchema, toolUseBlockSchema]))]),
  isError: z.boolean().optional(),
});

export const contentBlockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  toolUseBlockSchema,
  toolResultBlockSchema,
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.array(contentBlockSchema),
  /** Cumulative provider usage at the end of this message (assistant only). */
  usage: usageSchema.optional(),
  /** Synthetic markers ("[stopped by user at turn N]", "[max-turns reached]")
   *  the chat view surfaces inline. Distinct from `role` so the styling
   *  branch doesn't have to inspect the content. M6 C86 adds `'summary'`
   *  for the LLM-summarised head-trim placeholder. */
  marker: z.enum(['aborted', 'max-turns-reached', 'error', 'summary']).optional(),
  /** **M6.** Optional plan-execution provenance — when this message is part
   *  of a structured plan's execution, `planFlowId` references the flow's
   *  stable id and `planStepId` the step's id. Lets the chat view label the
   *  message "this came from step N of plan X" + the plan editor jump-to-step
   *  feature group all the per-step messages. Absent on non-plan messages
   *  (every M5 message + every ReAct message). */
  planFlowId: z.string().optional(),
  planStepId: z.string().optional(),
  ts: z.number().int().nonnegative(),
});
export type Message = z.infer<typeof messageSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** Model override; null/absent → use the workspace default. */
  model: z.string().nullable().optional(),
  messages: z.array(messageSchema),
  /** Per-conversation system-prompt override (the operator may have tuned the
   *  assembled host+plugin prompt for this thread). Absent → use the assembled
   *  default. */
  systemPromptOverride: z.string().nullable().optional(),
});
export type Conversation = z.infer<typeof conversationSchema>;

/** Per-profile conversation list — keyed by `profileId` (NOT `connectionId`). */
export const conversationsByProfileSchema = z.record(z.array(conversationSchema));
export type ConversationsByProfile = z.infer<typeof conversationsByProfileSchema>;

/** Per-conversation soft cap. Head-trim with a synthetic system message when
 *  exceeded; auto-summarisation is m5-followup. */
export const MAX_MESSAGES_PER_CONVERSATION = 200;
