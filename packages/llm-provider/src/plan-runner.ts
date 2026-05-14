/**
 * `runPlan` — the M6 plan-and-execute runner. Sits alongside `runReAct`:
 * a chat-runner picks one or the other based on whether the launched
 * `DiagnosticFlow` has a `plan` field.
 *
 * Shape:
 *   - For each `PlanStep` in order:
 *     - Evaluate `runIf` against the current variable map; if false, emit
 *       `plan-step-skip` + move on.
 *     - For `tool-call` steps: substitute args via {@link substituteValue},
 *       call `dispatchTool(name, args)`, bind the result to
 *       `vars[step.bindResultTo]` if set. Emit `tool-use-start` +
 *       `tool-use-complete` events alongside the new `plan-step-*` so the
 *       existing M5 chat-renderer's envelope logic continues to work.
 *     - For `llm-step` steps: substitute the prompt, append it to the
 *       working history as a `user` message, run `provider.streamResponse`,
 *       yield the standard LlmEvents (text-delta / text-stop / message-stop
 *       — same shapes the M5 ChatView already consumes), bind the
 *       concatenated text to `vars[step.bindResultTo]` if set.
 *   - Returns the final `LlmMessage[]` history at completion (matches the
 *     `runReAct` signature so callers can swap freely).
 *
 * Variable map layout:
 *   `vars` carries the launcher's collected params under a top-level
 *   `param` namespace (e.g. `${param.equipment_query}`) and each step's
 *   bound result at its top-level `bindResultTo` key (e.g. `${equipment}`,
 *   `${alarms}`, `${equipment.ord}`, `${alarms.0.id}`).
 *
 * **Out of scope for M6**: mid-plan pause/edit (the operator's only
 * mid-run lever is Stop, which aborts via the AbortSignal). Mid-plan
 * user messages cancel the plan and revert to ReAct — handled at the
 * chat-view layer, not here.
 */
import {
  evalCondition,
  substituteValue,
  substituteVars,
  type PlanStep,
} from '@mcp-studio/plugin-api';

import type { LlmContentBlock, LlmEvent, LlmMessage, LlmProvider, LlmTool } from './types';

/** Synthetic events the plan runner emits in addition to provider LlmEvents.
 *  The chat view's existing M5 event-handling logic for `text-delta` /
 *  `text-stop` / `tool-use-*` / `message-stop` continues to fire on the
 *  pass-through LlmEvents; the `plan-*` events drive the per-step rendering
 *  in the plan editor card. */
export type PlanRunnerEvent =
  | LlmEvent
  | { type: 'plan-start'; flowId: string; params: Record<string, unknown> }
  | {
      type: 'plan-step-start';
      stepId: string;
      kind: PlanStep['kind'];
      label?: string;
      tool?: string;
    }
  | { type: 'plan-step-skip'; stepId: string; reason: string }
  | {
      type: 'plan-step-complete';
      stepId: string;
      kind: PlanStep['kind'];
      result?: unknown;
    }
  | { type: 'plan-step-error'; stepId: string; message: string }
  | { type: 'plan-stop'; reason: 'complete' | 'aborted' | 'error' };

export interface RunPlanOptions {
  provider: LlmProvider;
  /** The assembled system prompt (host base + plugin sections — M5
   *  `assemblePluginContributions` output). */
  system: string;
  /** Pre-existing conversation history (user message that launched the flow
   *  already appended). The runner mutates a local copy, never the caller's. */
  history: LlmMessage[];
  /** Stable id of the diagnostic flow being executed — surfaces on the
   *  `plan-start` event so the chat view can label per-step output. */
  flowId: string;
  /** The plan to execute. */
  plan: readonly PlanStep[];
  /** Collected params from the flow launcher dialog (M5 `DiagnosticFlow.params`
   *  values). Exposed to plan steps as `${param.<name>}`. */
  params: Record<string, unknown>;
  /** MCP tool catalog — passed to `provider.streamResponse` for `llm-step`
   *  invocations so the LLM can call tools mid-step if it wants. */
  tools?: LlmTool[];
  /** Dispatch one tool call (used by `tool-call` steps + by any tool calls
   *  the LLM emits inside an `llm-step`). Same shape as `runReAct`'s. */
  dispatchTool: (
    name: string,
    args: Record<string, unknown>,
    toolUseId: string,
  ) => Promise<unknown>;
  /** Caller-supplied abort signal (M5 Stop button). The runner checks before
   *  each step + threads into `provider.streamResponse`. */
  signal?: AbortSignal;
  /** Per-step `llm-step` default model — overridden per-step via
   *  `PlanStep.model`. Falls back to the provider's default. */
  defaultModel?: string;
  /** Per-`llm-step` token cap. Falls back to the provider's default. */
  maxTokens?: number;
}

/** Run the plan. Yields the merged stream of provider events + runner
 *  out-of-band `plan-*` events; returns the final history at completion. */
export async function* runPlan(
  opts: RunPlanOptions,
): AsyncGenerator<PlanRunnerEvent, LlmMessage[], void> {
  const messages: LlmMessage[] = [...opts.history];
  // Variable map. `param` namespace carries launcher params; each step's
  // `bindResultTo` lands at its top-level key.
  const vars: Record<string, unknown> = { param: { ...opts.params } };

  yield { type: 'plan-start', flowId: opts.flowId, params: opts.params };

  let toolUseCounter = 0;

  for (const step of opts.plan) {
    if (opts.signal?.aborted) {
      yield { type: 'plan-stop', reason: 'aborted' };
      return messages;
    }

    if (!evalCondition(step.runIf, vars)) {
      yield {
        type: 'plan-step-skip',
        stepId: step.id,
        reason: describeCondition(step.runIf),
      };
      continue;
    }

    yield {
      type: 'plan-step-start',
      stepId: step.id,
      kind: step.kind,
      ...(step.label !== undefined ? { label: step.label } : {}),
      ...(step.kind === 'tool-call' ? { tool: step.tool } : {}),
    };

    if (step.kind === 'tool-call') {
      // Substitute args, dispatch, bind. The runner emits the
      // tool-use-start / tool-use-complete events the M5 chat envelope
      // depends on; the assistant message that records the call lands
      // via the chat view's runner-event handler exactly as a ReAct
      // tool-use would.
      const resolvedArgs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(step.args)) {
        resolvedArgs[k] = substituteValue(v, vars);
      }
      const toolUseId = `plan_${step.id}_${++toolUseCounter}`;
      const planIndex = toolUseCounter - 1;
      yield {
        type: 'tool-use-start',
        index: planIndex,
        toolUseId,
        name: step.tool,
      };
      let result: unknown;
      try {
        result = await opts.dispatchTool(step.tool, resolvedArgs, toolUseId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield { type: 'plan-step-error', stepId: step.id, message };
        yield { type: 'plan-stop', reason: 'error' };
        return messages;
      }
      yield {
        type: 'tool-use-complete',
        index: planIndex,
        toolUseId,
        name: step.tool,
        input: resolvedArgs,
      };
      // Append the tool_use + tool_result blocks to the working history so
      // a subsequent llm-step sees the prior plan steps' results in context.
      const assistantBlock: LlmContentBlock = {
        type: 'tool_use',
        id: toolUseId,
        name: step.tool,
        input: resolvedArgs,
      };
      messages.push({ role: 'assistant', content: [assistantBlock] });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: stringifyToolOutput(result),
          },
        ],
      });
      if (step.bindResultTo) {
        vars[step.bindResultTo] = extractBoundValue(result);
      }
      yield {
        type: 'plan-step-complete',
        stepId: step.id,
        kind: 'tool-call',
        result,
      };
      continue;
    }

    // llm-step.
    const prompt = substituteVars(step.prompt, vars);
    const userMessage: LlmMessage = {
      role: 'user',
      content: [{ type: 'text', text: prompt }],
    };
    messages.push(userMessage);
    let textBuffer = '';
    const assistantBlocks: LlmContentBlock[] = [];
    try {
      // Pass a snapshot so the provider's captured request stays consistent
      // — later mutations to `messages` (the assistant reply, tool_result
      // turns from mid-step LLM tool calls) don't retroactively change what
      // the provider was "given".
      for await (const ev of opts.provider.streamResponse({
        system: opts.system,
        messages: messages.slice(),
        tools: opts.tools ?? [],
        model: step.model ?? opts.defaultModel,
        maxTokens: opts.maxTokens,
        signal: opts.signal,
      })) {
        yield ev;
        if (ev.type === 'text-stop') {
          // The text-stop event carries the canonical full text per the
          // M5 AnthropicStreamMapper convention. Use it as the source of
          // truth for the bound result (the FakeLlmProvider's textTurn
          // helper skips text-delta + emits text-stop directly).
          textBuffer += ev.text;
          assistantBlocks.push({ type: 'text', text: ev.text });
        } else if (ev.type === 'tool-use-complete') {
          // The LLM called a tool mid-llm-step (e.g. an unanticipated
          // dispatch). Dispatch + thread the result back as a tool_result
          // turn the LLM can react to. Same shape as ReAct's loop step.
          let toolResult: unknown;
          try {
            toolResult = await opts.dispatchTool(ev.name, ev.input, ev.toolUseId);
          } catch (err) {
            toolResult = err instanceof Error ? err.message : String(err);
          }
          assistantBlocks.push({
            type: 'tool_use',
            id: ev.toolUseId,
            name: ev.name,
            input: ev.input,
          });
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: ev.toolUseId,
                content: stringifyToolOutput(toolResult),
              },
            ],
          });
        }
      }
    } catch (err) {
      if (opts.signal?.aborted || isAbort(err)) {
        yield { type: 'plan-stop', reason: 'aborted' };
        return messages;
      }
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'plan-step-error', stepId: step.id, message };
      yield { type: 'plan-stop', reason: 'error' };
      return messages;
    }
    if (assistantBlocks.length > 0) {
      messages.push({ role: 'assistant', content: assistantBlocks });
    }
    if (step.bindResultTo) {
      vars[step.bindResultTo] = textBuffer;
    }
    yield {
      type: 'plan-step-complete',
      stepId: step.id,
      kind: 'llm-step',
      ...(step.bindResultTo ? { result: textBuffer } : {}),
    };
  }

  yield { type: 'plan-stop', reason: 'complete' };
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

function isAbort(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || /aborted/i.test(err.message);
  }
  return false;
}

/** Extract the structured value to bind into the `vars` map from a raw
 *  tool-call result. The host-side `dispatchTool` returns whatever shape
 *  the underlying MCP `tools/call` returned (typically a `CallToolResult`:
 *  `{content, isError, structuredContent?}`). For variable substitution to
 *  work cleanly in downstream `${var.path}` references, the plan runner
 *  unwraps:
 *    - `structuredContent` (MCP modern shape — used by niagara-mock's
 *      `ok()` helper) → bind that directly;
 *    - else if `content[0]` is a text block carrying JSON → parse + bind
 *      the parsed value;
 *    - else if `content` is an array of text blocks → bind the concatenated
 *      text;
 *    - else → bind the raw result (the M5 fall-through).
 *
 *  This unwrap is invisible to LLM steps — they get the JSON-stringified
 *  raw result threaded back as a `tool_result` block via the chat view's
 *  `dispatchTool`, so the LLM sees the full original payload regardless of
 *  what the plan binds for substitution.
 */
function extractBoundValue(raw: unknown): unknown {
  if (raw === null || raw === undefined || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if ('structuredContent' in obj && obj.structuredContent !== undefined) {
    return obj.structuredContent;
  }
  if ('content' in obj && Array.isArray(obj.content) && obj.content.length > 0) {
    const first = obj.content[0];
    if (first && typeof first === 'object' && (first as { type?: unknown }).type === 'text') {
      const text = (first as { text?: unknown }).text;
      if (typeof text === 'string') {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
    }
  }
  return raw;
}

function describeCondition(expr: PlanStep['runIf']): string {
  if (!expr) return 'skipped';
  switch (expr.kind) {
    case 'always':
      return 'condition always true (cannot reach this branch)';
    case 'never':
      return 'condition: never';
    case 'var-truthy':
      return `condition: ${expr.path} not truthy`;
    case 'var-defined':
      return `condition: ${expr.path} not defined`;
    case 'var-compare':
      return `condition: ${expr.path} ${expr.op} ${JSON.stringify(expr.value)} failed`;
    case 'var-length-gt':
      return `condition: ${expr.path}.length > ${expr.value} failed`;
  }
}
