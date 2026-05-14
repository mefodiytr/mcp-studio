/**
 * The ReAct loop (Reasoning + Acting interleaved). Bounded N turns; each
 * turn streams one provider response, dispatches any tool_use blocks via
 * the caller-provided `dispatchTool`, threads the results back as
 * `tool_result` user-role messages, repeats until the provider emits an
 * `end_turn` (or until the turn cap is hit, or the signal is aborted).
 *
 * Provider-agnostic — works for the Anthropic adapter, the FakeLlmProvider,
 * and any future adapter that conforms to the `LlmProvider` interface.
 *
 * Returns the final `LlmMessage[]` history (caller's input, plus the
 * assistant turns + the tool_result turns that the loop produced) via the
 * AsyncGenerator's return value.
 *
 * Out-of-band events emitted by the runner (in addition to provider
 * `LlmEvent`s):
 *   - `{type:'turn-start',turn:number}` — before each provider call
 *   - `{type:'turn-stop',turn:number,assistantMessage}` — after each turn's
 *     assistant message is finalised
 *   - `{type:'tool-dispatched',toolUseId,name,output,isError}` — after each
 *     tool_use's dispatch completes (or fails)
 *   - `{type:'aborted',reason}` — caller signalled abort; loop terminates
 *   - `{type:'max-turns-reached',turn}` — hit the cap before end_turn
 */
import type {
  LlmContentBlock,
  LlmEvent,
  LlmMessage,
  LlmProvider,
  LlmTool,
  StopReason,
} from './types';
import { TOOL_LOOP_STOP_REASONS } from './types';

export type RunnerEvent =
  | LlmEvent
  | { type: 'turn-start'; turn: number }
  | { type: 'turn-stop'; turn: number; assistantMessage: LlmMessage }
  | {
      type: 'tool-dispatched';
      toolUseId: string;
      name: string;
      output: unknown;
      isError: boolean;
    }
  | { type: 'aborted'; reason: string }
  | { type: 'max-turns-reached'; turn: number };

export interface RunReActOptions {
  provider: LlmProvider;
  system: string;
  history: LlmMessage[];
  tools: LlmTool[];
  /** Dispatch one tool call. Throw / reject to surface as `isError: true`. */
  dispatchTool: (
    name: string,
    args: Record<string, unknown>,
    toolUseId: string,
  ) => Promise<unknown>;
  signal?: AbortSignal;
  /** Bounded loop guard. Default: 12. */
  maxTurns?: number;
  model?: string;
  maxTokens?: number;
}

const DEFAULT_MAX_TURNS = 12;

/** Run the ReAct loop. Yields the merged stream of provider events + runner
 *  out-of-band events; returns the final history at completion. */
export async function* runReAct(
  opts: RunReActOptions,
): AsyncGenerator<RunnerEvent, LlmMessage[], void> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const messages: LlmMessage[] = [...opts.history];

  for (let turn = 1; turn <= maxTurns; turn++) {
    if (opts.signal?.aborted) {
      yield { type: 'aborted', reason: signalReason(opts.signal) };
      return messages;
    }

    yield { type: 'turn-start', turn };

    const assistantContent: LlmContentBlock[] = [];
    let stopReason: StopReason = null;
    let streamErr = false;

    try {
      for await (const ev of opts.provider.streamResponse({
        system: opts.system,
        messages,
        tools: opts.tools,
        model: opts.model,
        maxTokens: opts.maxTokens,
        signal: opts.signal,
      })) {
        yield ev;
        switch (ev.type) {
          case 'text-stop':
            assistantContent.push({ type: 'text', text: ev.text });
            break;
          case 'tool-use-complete':
            assistantContent.push({
              type: 'tool_use',
              id: ev.toolUseId,
              name: ev.name,
              input: ev.input,
            });
            break;
          case 'message-stop':
            stopReason = ev.stopReason;
            break;
          case 'error':
            streamErr = true;
            break;
          default:
            break;
        }
      }
    } catch (err: unknown) {
      if (opts.signal?.aborted || isAbort(err)) {
        yield { type: 'aborted', reason: signalReason(opts.signal) };
        return messages;
      }
      throw err;
    }

    const assistantMessage: LlmMessage = { role: 'assistant', content: assistantContent };
    messages.push(assistantMessage);
    yield { type: 'turn-stop', turn, assistantMessage };

    if (streamErr) {
      // The provider emitted an error event; surface and terminate.
      return messages;
    }

    if (!TOOL_LOOP_STOP_REASONS.has(stopReason)) {
      // end_turn / max_tokens / stop_sequence / null → loop terminates.
      return messages;
    }

    // tool_use stop → dispatch each tool_use block, append tool_result
    // messages, continue.
    const toolUses = assistantContent.filter(
      (b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    if (toolUses.length === 0) {
      // stop_reason said tool_use but no tool_use blocks present — defensive
      // termination.
      return messages;
    }

    const toolResults: LlmContentBlock[] = [];
    for (const use of toolUses) {
      if (opts.signal?.aborted) {
        yield { type: 'aborted', reason: signalReason(opts.signal) };
        return messages;
      }
      let output: unknown;
      let isError = false;
      try {
        output = await opts.dispatchTool(use.name, use.input, use.id);
      } catch (err: unknown) {
        output = err instanceof Error ? err.message : String(err);
        isError = true;
      }
      yield {
        type: 'tool-dispatched',
        toolUseId: use.id,
        name: use.name,
        output,
        isError,
      };
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: stringifyToolOutput(output),
        ...(isError ? { isError: true } : {}),
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  yield { type: 'max-turns-reached', turn: maxTurns };
  return messages;
}

function stringifyToolOutput(out: unknown): string {
  if (typeof out === 'string') return out;
  try {
    return JSON.stringify(out);
  } catch {
    return String(out);
  }
}

function signalReason(signal: AbortSignal | undefined): string {
  if (!signal) return 'aborted';
  const reason: unknown = signal.reason;
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message;
  return 'aborted';
}

function isAbort(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || /aborted/i.test(err.message);
  }
  return false;
}
