/**
 * `FakeLlmProvider` — deterministic test helper. Yields a pre-programmed
 * sequence of `LlmEvent`s per call to `streamResponse`, independent of the
 * request. The runner's tests use it to assert loop behaviour without a real
 * provider.
 *
 * Distinct from `mock-programs.ts` (the programmatic mock for e2e specs,
 * which routes by user-message prompt content): this is one-call-deep,
 * sequence-based, no routing logic.
 */
import type { LlmEvent, LlmProvider, LlmStreamRequest } from './types';

export interface FakeProviderTurn {
  events: LlmEvent[];
}

export class FakeLlmProvider implements LlmProvider {
  private turns: FakeProviderTurn[];
  private cursor = 0;
  /** Captured requests for assertion. */
  public readonly seen: LlmStreamRequest[] = [];

  constructor(turns: FakeProviderTurn[]) {
    this.turns = turns;
  }

  async *streamResponse(req: LlmStreamRequest): AsyncIterable<LlmEvent> {
    this.seen.push(req);
    const turn = this.turns[this.cursor];
    this.cursor++;
    if (!turn) {
      throw new Error(
        `FakeLlmProvider: stream call #${this.cursor} but only ${this.turns.length} turns programmed`,
      );
    }
    for (const ev of turn.events) {
      if (req.signal?.aborted) {
        const reason = req.signal.reason;
        throw new DOMException(
          typeof reason === 'string' ? reason : 'aborted',
          'AbortError',
        );
      }
      yield ev;
    }
  }
}

/** Convenience: build a single-turn "text + end_turn" sequence. */
export function textTurn(text: string): FakeProviderTurn {
  return {
    events: [
      {
        type: 'message-start',
        messageId: 'msg_fake',
        model: 'fake',
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      { type: 'text-stop', index: 0, text },
      {
        type: 'message-stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ],
  };
}

/** Convenience: build a single-turn "tool_use + tool_use stop" sequence. */
export function toolUseTurn(
  name: string,
  input: Record<string, unknown>,
  opts?: { toolUseId?: string; precedingText?: string },
): FakeProviderTurn {
  const toolUseId = opts?.toolUseId ?? `toolu_fake_${name}`;
  const events: LlmEvent[] = [
    {
      type: 'message-start',
      messageId: 'msg_fake',
      model: 'fake',
      usage: { inputTokens: 0, outputTokens: 0 },
    },
  ];
  if (opts?.precedingText) {
    events.push({ type: 'text-stop', index: 0, text: opts.precedingText });
  }
  const toolIndex = opts?.precedingText ? 1 : 0;
  events.push(
    { type: 'tool-use-start', index: toolIndex, toolUseId, name },
    {
      type: 'tool-use-complete',
      index: toolIndex,
      toolUseId,
      name,
      input,
    },
    {
      type: 'message-stop',
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    },
  );
  return { events };
}
