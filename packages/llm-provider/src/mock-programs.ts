/**
 * `MockLlmProvider` — the deterministic programmatic mock for e2e specs (D9
 * recon decision). Pick a *program* (a pre-canned sequence of provider events)
 * based on the first user message's content, replay it.
 *
 * Activated by setting `MCPSTUDIO_LLM_PROVIDER=mock` in the e2e environment;
 * the desktop app's provider factory (lands in C71) picks this in place of
 * the Anthropic adapter when the env var is set. The four M5 e2e programs
 * (`greeting` / `rooftop` / `write-propose` / `cancel`) are registered by the
 * specs themselves at startup time so each spec carries its own program
 * library.
 *
 * Distinct from `FakeLlmProvider` (sequence-based, one-call-deep, no routing):
 * this picks by prompt content + supports multi-turn programs for ReAct flows.
 */
import type { LlmEvent, LlmMessage, LlmProvider, LlmStreamRequest } from './types';

export interface MockProgram {
  /** Stable id; used for `MCPSTUDIO_LLM_PROVIDER=mock` debugging. */
  id: string;
  /** Match function — true if this program should handle the request. The
   *  e2e specs typically match on the **last** user message's text. */
  match: (req: LlmStreamRequest) => boolean;
  /** Sequence of turns. The Nth call to `streamResponse` yields the Nth
   *  turn's events. */
  turns: { events: LlmEvent[] }[];
}

export class MockLlmProvider implements LlmProvider {
  private cursors = new WeakMap<MockProgram, number>();

  constructor(private readonly programs: MockProgram[]) {}

  async *streamResponse(req: LlmStreamRequest): AsyncIterable<LlmEvent> {
    const program = this.programs.find((p) => p.match(req));
    if (!program) {
      yield {
        type: 'error',
        error: {
          type: 'mock_no_program_matched',
          message: `MockLlmProvider: no program matched (last user text: ${JSON.stringify(
            lastUserText(req.messages).slice(0, 80),
          )})`,
        },
      };
      yield {
        type: 'message-stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      return;
    }
    const cursor = this.cursors.get(program) ?? 0;
    const turn = program.turns[cursor];
    this.cursors.set(program, cursor + 1);
    if (!turn) {
      yield {
        type: 'error',
        error: {
          type: 'mock_program_exhausted',
          message: `MockLlmProvider: program "${program.id}" only has ${program.turns.length} turns but turn ${cursor + 1} was requested`,
        },
      };
      yield {
        type: 'message-stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      return;
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

/** Match-by-last-user-message-substring — the convenience the e2e specs use. */
export function matchUserText(substring: string): (req: LlmStreamRequest) => boolean {
  return (req) => lastUserText(req.messages).toLowerCase().includes(substring.toLowerCase());
}

function lastUserText(messages: LlmMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    for (const block of m.content) {
      if (block.type === 'text') return block.text;
    }
  }
  return '';
}
