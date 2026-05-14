/**
 * Anthropic Messages-API adapter. Thin wrapper over `@anthropic-ai/sdk` —
 * we pass the request shape through, consume the streaming response, and
 * route each SSE event through `AnthropicStreamMapper`.
 *
 * The adapter is **renderer-only** today (the chat view holds the
 * `LlmProvider` instance + the user's API key in memory after `llm:getKey`).
 * Main never imports this package — main only sees AI-attributed tool calls
 * via the M5 `caller` arg on `tools:call` IPC (the C75 safety boundary).
 *
 * ESM-first SDK note: `@anthropic-ai/sdk` ships ESM. Renderer-only consumption
 * means we don't fight Electron-33 main's CJS bundle. If a future scenario
 * needs main to invoke the provider (background agent loops, scheduled flows
 * in M6+), the manualChunks split + a CJS-compatible bundling pass at main
 * lands then; not M5 v1 territory.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { LlmEvent, LlmProvider, LlmStreamRequest, LlmTool } from './types';
import { AnthropicStreamMapper, type AnthropicSseEvent } from './anthropic-stream';

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  /** Default token cap if the caller doesn't supply `maxTokens`. */
  defaultMaxTokens?: number;
}

const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 4096;

export function createAnthropicProvider(opts: AnthropicProviderOptions): LlmProvider {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const defaultModel = opts.model ?? DEFAULT_MODEL;
  const defaultMaxTokens = opts.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async *streamResponse(req: LlmStreamRequest): AsyncIterable<LlmEvent> {
      const mapper = new AnthropicStreamMapper();
      const messages = req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const tools = req.tools ? mapTools(req.tools) : undefined;

      // The Anthropic SDK's `.stream()` returns an AsyncIterable<MessageStreamEvent>;
      // each yielded value is the parsed SSE event payload (no `data: ` prefix).
      // Pass `signal` so the underlying fetch is aborted on caller cancel.
      const stream = client.messages.stream(
        {
          model: req.model ?? defaultModel,
          max_tokens: req.maxTokens ?? defaultMaxTokens,
          system: req.system,
          messages: messages as Anthropic.MessageParam[],
          ...(tools ? { tools } : {}),
        },
        { signal: req.signal },
      );

      try {
        for await (const ev of stream) {
          // The SDK's event objects are shape-compatible with the documented
          // SSE event payloads (the `type` discriminator + the per-type fields).
          const out = mapper.push(ev as unknown as AnthropicSseEvent);
          for (const item of out) {
            yield item;
          }
        }
      } catch (err: unknown) {
        // Surface as an error event instead of throwing — the runner needs
        // to treat aborts + transport errors uniformly.
        if (isAbortError(err)) {
          // Caller's signal aborted — let it propagate; the runner handles abort.
          throw err;
        }
        yield {
          type: 'error',
          error: {
            type: 'anthropic_stream_error',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
  };
}

function mapTools(tools: LlmTool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || /aborted/i.test(err.message);
  }
  return false;
}
