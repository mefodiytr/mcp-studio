/**
 * The LLM provider contract — provider-agnostic shapes the chat view + the
 * ReAct runner consume. Adapters (Anthropic v1; OpenAI / Ollama later) map
 * their wire formats onto this union.
 *
 * Design intent: a single normalised stream-event union expressive enough to
 * cover Anthropic's interleaved text + tool_use shape (the streaming docs'
 * §"Streaming request with tool use" example — a tool_use block can appear
 * mid-stream, between text blocks) without leaking provider-specific event
 * names into the renderer.
 *
 * @see packages/llm-provider/test/fixtures/anthropic-interleaved-stream.jsonl
 */

/** One conversational message in the LLM history. `tool_result` blocks belong
 *  to a `user` role per Anthropic's Messages API convention (the model's
 *  tool_use blocks are answered by user-role tool_result blocks). */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmContentBlock[];
}

export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | LlmContentBlock[];
      isError?: boolean;
    };

/** Tool definition handed to the provider. Shape mirrors Anthropic's
 *  `tools` arg (`name` / `description?` / `input_schema`) but uses camelCase
 *  for renderer-side consistency. */
export interface LlmTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/** A normalised stream event the provider emits. The Anthropic adapter maps
 *  the SSE `message_start` / `content_block_*` / `message_delta` / `message_stop`
 *  events onto this union; the runner + chat view consume it. */
export type LlmEvent =
  | {
      type: 'message-start';
      messageId: string;
      model: string;
      usage: LlmUsage;
    }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'text-stop'; index: number; text: string }
  | {
      type: 'tool-use-start';
      index: number;
      toolUseId: string;
      name: string;
    }
  | { type: 'tool-use-input-delta'; index: number; partialJson: string }
  | {
      type: 'tool-use-complete';
      index: number;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'message-stop';
      stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
      usage: LlmUsage;
    }
  | { type: 'error'; error: { type: string; message: string } };

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;

/** The stop reasons that mean "I want to call a tool — please continue the
 *  loop after dispatching." Everything else terminates the loop. */
export const TOOL_LOOP_STOP_REASONS: ReadonlySet<StopReason> = new Set(['tool_use']);

export interface LlmStreamRequest {
  /** The assembled system prompt (host base + plugin contributions + optional
   *  per-conversation override). */
  system: string;
  /** Conversation history; the runner mutates a local copy across turns but
   *  never the caller's array. */
  messages: LlmMessage[];
  /** The MCP tool catalog mapped to LLM tool definitions. Empty for a
   *  read-only / no-tools chat. */
  tools?: LlmTool[];
  model?: string;
  /** Provider-specific token cap; the runner doesn't interpret this. */
  maxTokens?: number;
  /** Caller can cancel mid-stream. Adapters thread this into their HTTP
   *  client's signal arg. */
  signal?: AbortSignal;
}

export interface LlmProvider {
  /** Stream one assistant turn. Resolves a sequence of normalised events;
   *  the caller assembles them into an `LlmMessage` and decides whether to
   *  continue (tool_use → loop) or terminate (end_turn). Aborts on
   *  `req.signal`. */
  streamResponse(req: LlmStreamRequest): AsyncIterable<LlmEvent>;
}
