import { describe, expect, it } from 'vitest';
import type { LlmEvent } from '@mcp-studio/llm-provider';
import { FakeLlmProvider, textTurn } from '@mcp-studio/llm-provider';

import type { Message } from '../../../shared/domain/conversations';

import {
  computeHeadSlice,
  HEAD_SLICE_COUNT,
  resolveSummariserModel,
  runSummariser,
  SUMMARISER_MODEL_IDS,
  SUMMARY_TRIGGER_THRESHOLD,
  SUMMARISER_SYSTEM_PROMPT,
} from './summariser';

function userMessage(text: string, id = `m_${text}`): Message {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    ts: 1_000_000,
  };
}

function assistantToolUse(
  toolUseId: string,
  name: string,
  input: Record<string, unknown>,
  id = `m_assistant_${toolUseId}`,
): Message {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'tool_use', id: toolUseId, name, input }],
    ts: 1_000_001,
  };
}

function userToolResult(toolUseId: string, content: string, id = `m_result_${toolUseId}`): Message {
  return {
    id,
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
    ts: 1_000_002,
  };
}

describe('resolveSummariserModel', () => {
  it('maps haiku / sonnet / opus preferences to concrete model ids', () => {
    expect(resolveSummariserModel('haiku', 'claude-opus-4-7')).toBe('claude-haiku-4-5');
    expect(resolveSummariserModel('sonnet', 'claude-opus-4-7')).toBe('claude-sonnet-4-6');
    expect(resolveSummariserModel('opus', 'claude-haiku-4-5')).toBe('claude-opus-4-7');
  });

  it('"same-as-main" returns the conversation model when present', () => {
    expect(resolveSummariserModel('same-as-main', 'claude-opus-4-7')).toBe('claude-opus-4-7');
    expect(resolveSummariserModel('same-as-main', 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('"same-as-main" falls back to opus when the conversation model is unknown', () => {
    expect(resolveSummariserModel('same-as-main', undefined)).toBe(SUMMARISER_MODEL_IDS.opus);
  });
});

describe('SUMMARISER_SYSTEM_PROMPT', () => {
  it('asks the model to preserve key facts / tool results / conclusions / pending questions (promt19 edge case #3)', () => {
    expect(SUMMARISER_SYSTEM_PROMPT).toMatch(/key facts/i);
    expect(SUMMARISER_SYSTEM_PROMPT).toMatch(/tool results/i);
    expect(SUMMARISER_SYSTEM_PROMPT).toMatch(/conclusions/i);
    expect(SUMMARISER_SYSTEM_PROMPT).toMatch(/pending questions/i);
  });

  it('asks for first-person narrative the assistant can pick up from', () => {
    expect(SUMMARISER_SYSTEM_PROMPT).toMatch(/first person/i);
  });

  it('asks for ≤200 tokens', () => {
    expect(SUMMARISER_SYSTEM_PROMPT).toMatch(/200 tokens/);
  });
});

describe('SUMMARY_TRIGGER_THRESHOLD + HEAD_SLICE_COUNT', () => {
  it('threshold is below MAX_MESSAGES_PER_CONVERSATION so summarisation runs before main\'s safety-net drop', () => {
    // MAX is 200 per the M5 D3 cap. Threshold 180 leaves a 20-message
    // buffer for the operator to keep typing during the summary call.
    expect(SUMMARY_TRIGGER_THRESHOLD).toBeLessThan(200);
    expect(SUMMARY_TRIGGER_THRESHOLD).toBe(180);
    expect(HEAD_SLICE_COUNT).toBe(100);
  });
});

describe('runSummariser — happy path', () => {
  it('returns the summary text + usage on a successful summariser call', async () => {
    const provider = new FakeLlmProvider([textTurn('Summary: the assistant investigated AHU-1; no alarms.')]);
    const headSlice: Message[] = [
      userMessage('Investigate the rooftop unit.'),
      assistantToolUse('t1', 'findEquipment', { query: 'rooftop' }),
      userToolResult('t1', JSON.stringify({ ord: 'station:|slot:/Drivers/AHU1', displayName: 'AHU-1' })),
    ];
    const result = await runSummariser({
      provider,
      headSlice,
      model: 'claude-haiku-4-5',
    });
    expect(result).not.toBeNull();
    expect(result?.text).toBe('Summary: the assistant investigated AHU-1; no alarms.');
    expect(result?.usage).toMatchObject({ inputTokens: expect.any(Number) as number, outputTokens: expect.any(Number) as number });
  });

  it('threads the head slice as the prompt history (tool_use + tool_result blocks preserved)', async () => {
    const provider = new FakeLlmProvider([textTurn('summary text')]);
    const headSlice: Message[] = [
      userMessage('Find AHU-1'),
      assistantToolUse('tA', 'findEquipment', { query: 'AHU-1' }),
      userToolResult('tA', JSON.stringify({ ord: 'station:|slot:/Drivers/AHU1' })),
      assistantToolUse('tB', 'inspectComponent', { ord: 'station:|slot:/Drivers/AHU1' }),
      userToolResult('tB', JSON.stringify({ type: 'AHU' })),
    ];
    await runSummariser({ provider, headSlice, model: 'claude-haiku-4-5' });

    expect(provider.seen).toHaveLength(1);
    const sent = provider.seen[0]!;
    // System prompt is the summariser instructions.
    expect(sent.system).toBe(SUMMARISER_SYSTEM_PROMPT);
    // Model override threaded through.
    expect(sent.model).toBe('claude-haiku-4-5');
    // Last message is the "now summarise" instruction; everything before it
    // is the head slice re-shaped from Message[] into LlmMessage[].
    const last = sent.messages.at(-1);
    expect(last).toMatchObject({ role: 'user', content: [{ type: 'text', text: expect.stringMatching(/Summarise the conversation above/) }] });
    // Head-slice messages mapped — five originals + one summarise-trailer = 6.
    expect(sent.messages).toHaveLength(headSlice.length + 1);
    // Tool blocks survived the round-trip.
    expect(sent.messages[1]?.content[0]).toMatchObject({ type: 'tool_use', name: 'findEquipment' });
    expect(sent.messages[2]?.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tA' });
  });

  it('passes the maxTokens cap through (default 400)', async () => {
    const provider = new FakeLlmProvider([textTurn('summary')]);
    await runSummariser({
      provider,
      headSlice: [userMessage('first')],
      model: 'claude-haiku-4-5',
    });
    expect(provider.seen[0]?.maxTokens).toBe(400);
  });

  it('honours a maxTokens override', async () => {
    const provider = new FakeLlmProvider([textTurn('summary')]);
    await runSummariser({
      provider,
      headSlice: [userMessage('first')],
      model: 'claude-haiku-4-5',
      maxTokens: 250,
    });
    expect(provider.seen[0]?.maxTokens).toBe(250);
  });
});

describe('runSummariser — graceful degradation (promt19 edge cases #1 + #2)', () => {
  it('returns null on an empty head slice (no input to summarise)', async () => {
    const provider = new FakeLlmProvider([]);
    expect(await runSummariser({ provider, headSlice: [], model: 'claude-haiku-4-5' })).toBeNull();
  });

  it('returns null on an error event in the provider stream', async () => {
    const provider = new FakeLlmProvider([
      {
        events: [
          {
            type: 'message-start',
            messageId: 'm',
            model: 'mock',
            usage: { inputTokens: 0, outputTokens: 0 },
          },
          { type: 'error', error: { type: 'rate_limit', message: 'slow down' } },
          {
            type: 'message-stop',
            stopReason: null,
            usage: { inputTokens: 0, outputTokens: 0 },
          },
        ],
      },
    ]);
    const out = await runSummariser({
      provider,
      headSlice: [userMessage('content')],
      model: 'claude-haiku-4-5',
    });
    expect(out).toBeNull();
  });

  it('returns null on an empty / whitespace-only summary (no signal to commit)', async () => {
    const provider = new FakeLlmProvider([textTurn('   ')]);
    const out = await runSummariser({
      provider,
      headSlice: [userMessage('content')],
      model: 'claude-haiku-4-5',
    });
    expect(out).toBeNull();
  });

  it('returns null when the AbortSignal is aborted before the call', async () => {
    const provider = new FakeLlmProvider([textTurn('unreached')]);
    const controller = new AbortController();
    controller.abort();
    const out = await runSummariser({
      provider,
      headSlice: [userMessage('content')],
      model: 'claude-haiku-4-5',
      signal: controller.signal,
    });
    expect(out).toBeNull();
  });

  it('returns null on provider throw (network failure etc.)', async () => {
    const throwingProvider = {
      streamResponse: () => {
        // eslint-disable-next-line require-yield
        async function* gen(): AsyncGenerator<LlmEvent, void, void> {
          throw new Error('upstream 500');
        }
        return gen();
      },
    };
    const out = await runSummariser({
      provider: throwingProvider,
      headSlice: [userMessage('content')],
      model: 'claude-haiku-4-5',
    });
    expect(out).toBeNull();
  });
});

describe('computeHeadSlice', () => {
  function plain(id: string): Message {
    return { id, role: 'user', content: [{ type: 'text', text: id }], ts: 1 };
  }
  function summaryMarker(id = 'summary-marker'): Message {
    return {
      id,
      role: 'assistant',
      content: [{ type: 'text', text: 'prior summary text' }],
      marker: 'summary',
      ts: 1,
    };
  }

  it('first-cycle: no prior summary → headSlice = first N messages, tail = rest', () => {
    const messages = Array.from({ length: 5 }, (_, i) => plain(`m${i}`));
    const out = computeHeadSlice(messages, 3);
    expect(out.headSlice.map((m) => m.id)).toEqual(['m0', 'm1', 'm2']);
    expect(out.tail.map((m) => m.id)).toEqual(['m3', 'm4']);
    expect(out.priorSummaryMarker).toBeNull();
  });

  it('re-summarisation continuity (promt19 edge case #4): prior summary marker is included in head slice', () => {
    const messages: Message[] = [
      summaryMarker('prior'),
      ...Array.from({ length: 5 }, (_, i) => plain(`m${i}`)),
    ];
    const out = computeHeadSlice(messages, 3);
    // Prior summary + next 3 new messages = head slice of 4; tail is 2.
    expect(out.headSlice.map((m) => m.id)).toEqual(['prior', 'm0', 'm1', 'm2']);
    expect(out.tail.map((m) => m.id)).toEqual(['m3', 'm4']);
    expect(out.priorSummaryMarker?.id).toBe('prior');
  });

  it('empty input → empty result (no-op)', () => {
    expect(computeHeadSlice([], 100)).toEqual({ headSlice: [], tail: [], priorSummaryMarker: null });
  });

  it('only a prior summary, no new content → headSlice empty (nothing new to summarise)', () => {
    const out = computeHeadSlice([summaryMarker('p')], 100);
    expect(out.headSlice).toEqual([]);
    expect(out.tail).toHaveLength(1);
    expect(out.priorSummaryMarker?.id).toBe('p');
  });

  it('fewer real messages than the slice count → headSlice = all-real (still valid)', () => {
    const messages = [plain('a'), plain('b')];
    const out = computeHeadSlice(messages, 10);
    expect(out.headSlice.map((m) => m.id)).toEqual(['a', 'b']);
    expect(out.tail).toEqual([]);
  });

  it('default headSliceCount is HEAD_SLICE_COUNT (100)', () => {
    const messages = Array.from({ length: 120 }, (_, i) => plain(`m${i}`));
    const out = computeHeadSlice(messages);
    expect(out.headSlice).toHaveLength(HEAD_SLICE_COUNT);
    expect(out.tail).toHaveLength(20);
  });
});

describe('runSummariser — message filtering', () => {
  it('drops aborted / error / max-turns-reached markers from the head slice (synthetic, no value to summariser)', async () => {
    const provider = new FakeLlmProvider([textTurn('summary')]);
    const headSlice: Message[] = [
      userMessage('first', 'm1'),
      {
        id: 'm-aborted',
        role: 'assistant',
        content: [],
        marker: 'aborted',
        ts: 1_000_001,
      },
      userMessage('second', 'm2'),
      {
        id: 'm-error',
        role: 'assistant',
        content: [],
        marker: 'error',
        ts: 1_000_002,
      },
    ];
    await runSummariser({ provider, headSlice, model: 'claude-haiku-4-5' });
    const sent = provider.seen[0]!;
    // 2 user messages + 1 summarise-trailer = 3, not 5.
    expect(sent.messages).toHaveLength(3);
  });
});
