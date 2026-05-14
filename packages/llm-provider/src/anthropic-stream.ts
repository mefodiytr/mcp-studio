/**
 * Pure mapper: Anthropic Messages-API SSE events → normalised `LlmEvent`s.
 *
 * Why a separate module: the SSE shape is the brittle part of the integration
 * (provider-specific event names, partial-JSON-in-input-deltas semantics, the
 * interleaving of text + tool_use blocks). Isolating it as a stateful pure
 * function makes it replay-testable against captured fixtures
 * (`test/fixtures/anthropic-*-stream.jsonl`) without an Anthropic API key —
 * deterministic real-shape coverage that runs in CI.
 *
 * State carried between events: per-index content-block accumulator (tool_use
 * blocks need to buffer `input_json_delta` partial-JSON strings until
 * `content_block_stop` to parse the final object; text blocks accumulate the
 * concatenated text for a `text-stop` event with the final string).
 *
 * Reference: https://docs.anthropic.com/en/api/messages-streaming
 */
import type { LlmEvent, StopReason } from './types';

/** Anthropic SSE event payload — loosely typed; the mapper accepts the
 *  documented superset and ignores unknown fields. */
export interface AnthropicSseEvent {
  type: string;
  message?: {
    id?: string;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string | null;
  };
  index?: number;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    text?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string | null;
    stop_sequence?: string | null;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type: string; message: string };
}

interface BlockState {
  type: 'text' | 'tool_use' | 'other';
  toolUseId?: string;
  name?: string;
  textBuffer: string;
  jsonBuffer: string;
}

/** Stateful mapper. Construct one per stream; feed it events; collect emitted
 *  `LlmEvent`s. The mapper accumulates the per-index content blocks so the
 *  `text-stop` carries the final concatenated text and the `tool-use-complete`
 *  carries the parsed input object. */
export class AnthropicStreamMapper {
  private blocks = new Map<number, BlockState>();
  private model = '';
  private messageId = '';
  private inputTokens = 0;
  private outputTokens = 0;

  /** Feed one Anthropic SSE event. Returns zero or more normalised
   *  `LlmEvent`s (zero for events the mapper ignores — e.g. `ping`). */
  push(ev: AnthropicSseEvent): LlmEvent[] {
    switch (ev.type) {
      case 'message_start':
        return this.handleMessageStart(ev);
      case 'content_block_start':
        return this.handleContentBlockStart(ev);
      case 'content_block_delta':
        return this.handleContentBlockDelta(ev);
      case 'content_block_stop':
        return this.handleContentBlockStop(ev);
      case 'message_delta':
        return this.handleMessageDelta(ev);
      case 'message_stop':
        return this.handleMessageStop(ev);
      case 'error':
        return [
          {
            type: 'error',
            error: ev.error ?? { type: 'unknown', message: 'unknown error event' },
          },
        ];
      case 'ping':
      default:
        return [];
    }
  }

  private handleMessageStart(ev: AnthropicSseEvent): LlmEvent[] {
    const m = ev.message ?? {};
    this.messageId = m.id ?? '';
    this.model = m.model ?? '';
    this.inputTokens = m.usage?.input_tokens ?? 0;
    this.outputTokens = m.usage?.output_tokens ?? 0;
    return [
      {
        type: 'message-start',
        messageId: this.messageId,
        model: this.model,
        usage: { inputTokens: this.inputTokens, outputTokens: this.outputTokens },
      },
    ];
  }

  private handleContentBlockStart(ev: AnthropicSseEvent): LlmEvent[] {
    if (ev.index === undefined) return [];
    const cb = ev.content_block ?? {};
    if (cb.type === 'text') {
      this.blocks.set(ev.index, { type: 'text', textBuffer: cb.text ?? '', jsonBuffer: '' });
      // The opening empty-text block emits nothing — text-deltas follow.
      return [];
    }
    if (cb.type === 'tool_use') {
      const toolUseId = cb.id ?? '';
      const name = cb.name ?? '';
      this.blocks.set(ev.index, {
        type: 'tool_use',
        toolUseId,
        name,
        textBuffer: '',
        jsonBuffer: '',
      });
      return [{ type: 'tool-use-start', index: ev.index, toolUseId, name }];
    }
    // Thinking blocks / future block types — accumulate nothing, ignore.
    this.blocks.set(ev.index, { type: 'other', textBuffer: '', jsonBuffer: '' });
    return [];
  }

  private handleContentBlockDelta(ev: AnthropicSseEvent): LlmEvent[] {
    if (ev.index === undefined) return [];
    const block = this.blocks.get(ev.index);
    if (!block) return [];
    const d = ev.delta ?? {};
    if (d.type === 'text_delta' && typeof d.text === 'string') {
      block.textBuffer += d.text;
      return [{ type: 'text-delta', index: ev.index, text: d.text }];
    }
    if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
      block.jsonBuffer += d.partial_json;
      return [{ type: 'tool-use-input-delta', index: ev.index, partialJson: d.partial_json }];
    }
    // thinking_delta / signature_delta / unknown — ignored (M5 doesn't surface them yet).
    return [];
  }

  private handleContentBlockStop(ev: AnthropicSseEvent): LlmEvent[] {
    if (ev.index === undefined) return [];
    const block = this.blocks.get(ev.index);
    if (!block) return [];
    if (block.type === 'text') {
      return [{ type: 'text-stop', index: ev.index, text: block.textBuffer }];
    }
    if (block.type === 'tool_use') {
      let parsed: Record<string, unknown> = {};
      const raw = block.jsonBuffer;
      if (raw.length > 0) {
        try {
          const value: unknown = JSON.parse(raw);
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            parsed = value as Record<string, unknown>;
          }
        } catch {
          // Malformed partial-JSON accumulation — surface as an error event
          // so the runner can abort rather than dispatch with garbage input.
          return [
            {
              type: 'error',
              error: {
                type: 'tool_use_input_parse_error',
                message: `failed to parse accumulated tool_use input JSON for index ${ev.index}: ${raw}`,
              },
            },
          ];
        }
      }
      return [
        {
          type: 'tool-use-complete',
          index: ev.index,
          toolUseId: block.toolUseId ?? '',
          name: block.name ?? '',
          input: parsed,
        },
      ];
    }
    return [];
  }

  private handleMessageDelta(ev: AnthropicSseEvent): LlmEvent[] {
    const d = ev.delta ?? {};
    // usage in message_delta is cumulative output_tokens (per the docs note).
    if (typeof ev.usage?.output_tokens === 'number') {
      this.outputTokens = ev.usage.output_tokens;
    }
    if (typeof ev.usage?.input_tokens === 'number') {
      this.inputTokens = ev.usage.input_tokens;
    }
    if (d.stop_reason !== undefined && d.stop_reason !== null) {
      // Stash the stop_reason on the mapper; emitted by handleMessageStop.
      this.pendingStopReason = d.stop_reason as StopReason;
    }
    return [];
  }

  private pendingStopReason: StopReason = null;

  private handleMessageStop(_ev: AnthropicSseEvent): LlmEvent[] {
    const stop = this.pendingStopReason;
    return [
      {
        type: 'message-stop',
        stopReason: stop,
        usage: { inputTokens: this.inputTokens, outputTokens: this.outputTokens },
      },
    ];
  }
}

/** Convenience: replay a captured fixture as an `AsyncIterable<LlmEvent>`. */
export async function* replayFixture(
  events: AnthropicSseEvent[],
): AsyncGenerator<LlmEvent, void, void> {
  const mapper = new AnthropicStreamMapper();
  for (const ev of events) {
    const out = mapper.push(ev);
    for (const item of out) {
      yield item;
    }
  }
}
