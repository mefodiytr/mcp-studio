import type { LlmContentBlock, LlmMessage, LlmProvider, LlmUsage } from '@mcp-studio/llm-provider';

import type { Message, ContentBlock } from '../../../shared/domain/conversations';

/**
 * **M6 C86** — head-trim summarisation runner. Takes a slice of conversation
 * messages (the "head" being trimmed) + asks the LLM to summarise them into
 * a single replacement string. Returns the text + the usage tokens on
 * success, or `null` on any failure / abort (the caller falls back to
 * silent-drop per the M5 behaviour — promt19 edge case #1).
 *
 * The summary prompt asks the model to preserve: **key facts, tool
 * results, conclusions reached, pending questions** (per promt19 edge case
 * #3). User content threads full `tool_use` / `tool_result` blocks — the
 * diagnostic value lives in tool results, not just text.
 *
 * Cancellation: the caller threads `AbortSignal` so Stop cancels the
 * summary call same as the main ReAct loop (promt19 edge case #2). On
 * abort, returns null + the caller drops the head as the fallback.
 *
 * `Plugin.summarisationHints?` (per-plugin guidance: e.g. niagara could
 * say "preserve ORDs in narrative") is an m6-followup seam — promt19
 * tracks the future shape.
 */

export const SUMMARISER_SYSTEM_PROMPT = `You compress an earlier slice of a chat conversation into a single concise summary that the assistant can use as context for subsequent turns.

Preserve, in priority order:
- **Key facts** the operator stated (equipment names, ords, constraints, what they're investigating).
- **Tool results** that matter — specific values, alarm IDs, history samples, error messages from tool calls. Cite tool name + the data the operator can act on.
- **Conclusions reached** — what's been determined so far ("the rooftop unit is fine", "the alarm source is X").
- **Pending questions** — what the operator hasn't yet decided / what the assistant was waiting on.

Omit fluff. Aim for ≤200 tokens. Write in first person ("I investigated..." / "we determined..."). The summary will replace the original messages — write it so the assistant can read it and pick up the thread.`;

/** The Anthropic model ids the summariser preference picks. The
 *  `'same-as-main'` choice resolves to the conversation's own model at call
 *  time (the caller passes it in). */
export const SUMMARISER_MODEL_IDS = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
} as const;

export type SummariserModelPreference = 'haiku' | 'sonnet' | 'opus' | 'same-as-main';

/** Resolve the summariser model preference into a concrete model id. */
export function resolveSummariserModel(
  preference: SummariserModelPreference,
  conversationModel: string | undefined,
): string {
  if (preference === 'same-as-main') {
    return conversationModel ?? SUMMARISER_MODEL_IDS.opus;
  }
  return SUMMARISER_MODEL_IDS[preference];
}

export interface RunSummariserOptions {
  provider: LlmProvider;
  /** The head slice of conversation messages being summarised. Includes
   *  full `tool_use` / `tool_result` content blocks — the diagnostic
   *  value lives in tool results. */
  headSlice: readonly Message[];
  /** Resolved model id (e.g. 'claude-haiku-4-5'). */
  model: string;
  /** Threaded through to the provider so the Stop button cancels the
   *  summary in flight. */
  signal?: AbortSignal;
  /** Max tokens — keeps summary calls cheap. Default 400 (room for the
   *  ~200-token target + headroom). */
  maxTokens?: number;
}

export interface SummariserResult {
  text: string;
  /** Cumulative provider usage at message-stop. Credits to UsageBadge +
   *  workspace-global session spend per promt19. */
  usage: LlmUsage | null;
}

/** Run the summariser; returns the summary text + usage on success, null
 *  on any failure / abort. Never throws — graceful degradation is the
 *  caller's path. */
export async function runSummariser(opts: RunSummariserOptions): Promise<SummariserResult | null> {
  if (opts.headSlice.length === 0) return null;
  const userMessages = mapHeadSliceForProvider(opts.headSlice);
  if (userMessages.length === 0) return null;
  // The single user message that holds the head-slice content. Anthropic's
  // tool-use / tool-result blocks must alternate assistant/user roles, so
  // we pass the head slice through as a multi-turn history; the summary
  // call's final user message is a simple instruction.
  const promptHistory: LlmMessage[] = [
    ...userMessages,
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Summarise the conversation above per the rules in the system prompt. Single paragraph; ≤200 tokens; first-person.',
        },
      ],
    },
  ];
  let text = '';
  let usage: LlmUsage | null = null;
  try {
    for await (const ev of opts.provider.streamResponse({
      system: SUMMARISER_SYSTEM_PROMPT,
      messages: promptHistory,
      tools: [],
      model: opts.model,
      maxTokens: opts.maxTokens ?? 400,
      signal: opts.signal,
    })) {
      if (ev.type === 'text-stop') {
        text += ev.text;
      } else if (ev.type === 'message-stop') {
        usage = ev.usage;
      } else if (ev.type === 'error') {
        return null;
      }
    }
  } catch {
    // Abort or transport failure — caller falls back to silent drop.
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  return { text: trimmed, usage };
}

/** Re-shape the persisted Message[] slice into the LlmMessage[] the
 *  provider expects. Identical to the chat-runner's mapHistoryForProvider
 *  (M5) but exported here for the summariser path. */
function mapHeadSliceForProvider(messages: readonly Message[]): LlmMessage[] {
  return messages
    .filter((m) => m.marker !== 'aborted' && m.marker !== 'error' && m.marker !== 'max-turns-reached')
    .map((m) => ({
      role: m.role,
      content: m.content.map(contentBlockToLlm),
    }));
}

function contentBlockToLlm(b: ContentBlock): LlmContentBlock {
  if (b.type === 'text') return { type: 'text', text: b.text };
  if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
  return {
    type: 'tool_result',
    tool_use_id: b.tool_use_id,
    content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
    ...(b.isError ? { isError: true } : {}),
  };
}

/** **Threshold the renderer monitors.** When `messages.length` crosses this
 *  on append, the chat view fires `summariseAndTrim`. Set below
 *  `MAX_MESSAGES_PER_CONVERSATION` (200) so summarisation runs *before*
 *  main's safety-net silent-drop kicks in. Drop count + threshold tuned
 *  to give the operator a 20-message buffer + half-the-conversation
 *  drop-target — promt19 single-summary-marker design (re-summarisation
 *  consumes the prior summary + accumulated new head, producing a new
 *  summary that supersedes the prior one). */
export const SUMMARY_TRIGGER_THRESHOLD = 180;
export const HEAD_SLICE_COUNT = 100;

/**
 * Slice `messages` into the head (to be summarised) + tail (to keep).
 *
 * **Re-summarisation continuity** (promt19 edge case #4): if the conversation
 * already starts with a `marker: 'summary'` message, include it in the head
 * slice. The next summary call sees "(prior summary) + (next N messages)"
 * as its input, so transitive history is preserved across multiple trim
 * cycles. The replacement single `summary` marker grows in scope rather
 * than accumulating multiple markers.
 *
 * Returns the empty-head case (`headSlice.length === 0`) when there's not
 * enough to summarise — the caller treats that as a no-op.
 */
export function computeHeadSlice(
  messages: readonly Message[],
  headSliceCount: number = HEAD_SLICE_COUNT,
): { headSlice: Message[]; tail: Message[]; priorSummaryMarker: Message | null } {
  if (messages.length === 0) {
    return { headSlice: [], tail: [], priorSummaryMarker: null };
  }
  const first = messages[0];
  const hasPriorSummary = first?.marker === 'summary';
  // Take the prior summary marker (if any) + the next N messages from the
  // remaining tail. We require at least one real message past the prior
  // summary to bother re-summarising (otherwise the call would produce a
  // verbatim re-statement of the prior summary).
  const startIndex = hasPriorSummary ? 1 : 0;
  const realCount = Math.min(headSliceCount, messages.length - startIndex);
  if (realCount <= 0) {
    return { headSlice: [], tail: messages.slice(), priorSummaryMarker: hasPriorSummary ? first ?? null : null };
  }
  const headSlice = messages.slice(0, startIndex + realCount);
  const tail = messages.slice(startIndex + realCount);
  return {
    headSlice,
    tail,
    priorSummaryMarker: hasPriorSummary ? first ?? null : null,
  };
}
