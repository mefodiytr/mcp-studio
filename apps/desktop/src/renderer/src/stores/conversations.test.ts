import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation, Message } from '../../../shared/domain/conversations';
import type { SummariserResult } from '../lib/summariser';

import { useConversationsStore } from './conversations';

function makeMessage(id: string, role: 'user' | 'assistant', text: string): Message {
  return {
    id,
    role,
    content: [{ type: 'text', text }],
    ts: 1_700_000_000_000,
  };
}

function makeSummaryMarker(id = 'prior-summary'): Message {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text: 'previously: investigated AHU-1' }],
    marker: 'summary',
    ts: 1_700_000_000_000,
  };
}

function makeConversation(id: string, messages: Message[]): Conversation {
  return {
    id,
    title: `conv-${id}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    messages,
  };
}

let invokeMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock = vi.fn().mockResolvedValue({});
  vi.stubGlobal('window', {
    studio: {
      invoke: invokeMock,
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  });
  // Reset the Zustand store between tests.
  useConversationsStore.setState({
    conversationsByProfile: {},
    hydratedProfiles: new Set(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Seed the store with one conversation under one profile. */
function seed(profileId: string, conversation: Conversation): void {
  useConversationsStore.setState({
    conversationsByProfile: { [profileId]: [conversation] },
    hydratedProfiles: new Set([profileId]),
  });
}

describe('summariseAndTrim — happy path', () => {
  it('first-cycle: replaces head slice with a single summary-marker assistant message', async () => {
    const profileId = 'p1';
    // 105 messages, just above HEAD_SLICE_COUNT (100).
    const messages = Array.from({ length: 105 }, (_, i) =>
      makeMessage(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `body-${i}`),
    );
    const conv = makeConversation('conv1', messages);
    seed(profileId, conv);
    const summariseMock = vi.fn<(headSlice: readonly Message[]) => Promise<SummariserResult | null>>().mockResolvedValue({
      text: 'I investigated the rooftop unit; no alarms.',
      usage: { inputTokens: 1200, outputTokens: 180 },
    });

    const result = await useConversationsStore.getState().summariseAndTrim(profileId, 'conv1', {
      summarise: summariseMock,
    });

    expect(result.outcome).toBe('summarised');
    expect(summariseMock).toHaveBeenCalledOnce();
    // Head slice fed to the summariser is the first 100 messages.
    const head = summariseMock.mock.calls[0]![0];
    expect(head).toHaveLength(100);
    expect(head[0]!.id).toBe('m0');
    expect(head[99]!.id).toBe('m99');

    // Stored conversation: [summary marker, tail]; tail = 5 messages (105 − 100).
    const stored = useConversationsStore.getState().conversationsByProfile[profileId]![0]!;
    expect(stored.messages).toHaveLength(6);
    expect(stored.messages[0]).toMatchObject({
      role: 'assistant',
      marker: 'summary',
      content: [{ type: 'text', text: 'I investigated the rooftop unit; no alarms.' }],
      usage: { inputTokens: 1200, outputTokens: 180 },
    });
    expect(stored.messages.slice(1).map((m) => m.id)).toEqual(['m100', 'm101', 'm102', 'm103', 'm104']);
    // Persisted via the IPC bridge.
    expect(invokeMock).toHaveBeenCalledWith('conversations:save', expect.objectContaining({ profileId }));
  });

  it('re-summarisation continuity (promt19 edge case #4): consumes prior summary marker into the next head slice', async () => {
    const profileId = 'p1';
    const priorSummary = makeSummaryMarker('prior');
    // Prior summary + 102 new messages = 103 total. computeHeadSlice should
    // include the prior summary + the next 100 messages in the head; tail = 2.
    const newOnes = Array.from({ length: 102 }, (_, i) => makeMessage(`n${i}`, 'user', `body-${i}`));
    const conv = makeConversation('conv1', [priorSummary, ...newOnes]);
    seed(profileId, conv);
    const summariseMock = vi.fn<(headSlice: readonly Message[]) => Promise<SummariserResult | null>>().mockResolvedValue({
      text: 'updated summary covering both spans',
      usage: { inputTokens: 1500, outputTokens: 200 },
    });

    await useConversationsStore.getState().summariseAndTrim(profileId, 'conv1', {
      summarise: summariseMock,
    });

    const head = summariseMock.mock.calls[0]![0];
    expect(head).toHaveLength(101); // prior summary + 100 new
    expect(head[0]!.marker).toBe('summary');
    expect(head[0]!.id).toBe('prior');
    expect(head[1]!.id).toBe('n0');
    expect(head[100]!.id).toBe('n99');

    // Single summary marker grows in scope — only one 'summary' marker stays.
    const stored = useConversationsStore.getState().conversationsByProfile[profileId]![0]!;
    const summaryCount = stored.messages.filter((m) => m.marker === 'summary').length;
    expect(summaryCount).toBe(1);
    expect(stored.messages).toHaveLength(3); // new summary + 2 tail
    expect(stored.messages[0]!.content[0]).toMatchObject({ type: 'text', text: 'updated summary covering both spans' });
    expect(stored.messages.slice(1).map((m) => m.id)).toEqual(['n100', 'n101']);
  });

  it('summary message carries usage so UsageBadge + workspace-global totals see it (promt19 cost transparency)', async () => {
    const profileId = 'p1';
    const messages = Array.from({ length: 110 }, (_, i) => makeMessage(`m${i}`, 'user', `body-${i}`));
    seed(profileId, makeConversation('conv1', messages));
    const summariseMock = vi.fn<(headSlice: readonly Message[]) => Promise<SummariserResult | null>>().mockResolvedValue({
      text: 'summary',
      usage: { inputTokens: 1234, outputTokens: 567 },
    });

    const result = await useConversationsStore.getState().summariseAndTrim(profileId, 'conv1', {
      summarise: summariseMock,
    });
    expect(result.outcome).toBe('summarised');
    if (result.outcome !== 'summarised') return;
    expect(result.usage).toEqual({ inputTokens: 1234, outputTokens: 567 });
    expect(result.conversation.messages[0]!.usage).toEqual({ inputTokens: 1234, outputTokens: 567 });
  });
});

describe('summariseAndTrim — graceful degradation (promt19 edge cases #1 + #2)', () => {
  it('summariser returns null → silent drop of head slice + outcome: "dropped"', async () => {
    const profileId = 'p1';
    const messages = Array.from({ length: 110 }, (_, i) => makeMessage(`m${i}`, 'user', `body-${i}`));
    seed(profileId, makeConversation('conv1', messages));
    const summariseMock = vi.fn<(headSlice: readonly Message[]) => Promise<SummariserResult | null>>().mockResolvedValue(null);

    const result = await useConversationsStore.getState().summariseAndTrim(profileId, 'conv1', {
      summarise: summariseMock,
    });
    expect(result.outcome).toBe('dropped');
    if (result.outcome !== 'dropped') return;
    expect(result.reason).toBe('summariser-returned-null');
    // Head dropped; tail kept; no synthetic marker injected.
    expect(result.conversation.messages).toHaveLength(10);
    expect(result.conversation.messages.every((m) => m.marker !== 'summary')).toBe(true);
    // Still persisted (otherwise the conversation re-grows past cap on next append).
    expect(invokeMock).toHaveBeenCalledWith('conversations:save', expect.objectContaining({ profileId }));
  });
});

describe('summariseAndTrim — no-op cases', () => {
  it('returns noop:"missing-conversation" if conversationId not found', async () => {
    const summariseMock = vi.fn<(headSlice: readonly Message[]) => Promise<SummariserResult | null>>();
    const result = await useConversationsStore.getState().summariseAndTrim('p1', 'nope', {
      summarise: summariseMock,
    });
    expect(result.outcome).toBe('noop');
    if (result.outcome !== 'noop') return;
    expect(result.reason).toBe('missing-conversation');
    expect(summariseMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('returns noop:"no-head-to-trim" when the conversation is empty', async () => {
    const profileId = 'p1';
    seed(profileId, makeConversation('conv1', []));
    const summariseMock = vi.fn<(headSlice: readonly Message[]) => Promise<SummariserResult | null>>();
    const result = await useConversationsStore.getState().summariseAndTrim(profileId, 'conv1', {
      summarise: summariseMock,
    });
    expect(result.outcome).toBe('noop');
    if (result.outcome !== 'noop') return;
    expect(result.reason).toBe('no-head-to-trim');
    expect(summariseMock).not.toHaveBeenCalled();
  });

  it('returns noop:"no-head-to-trim" when only a prior summary marker exists (nothing new to summarise)', async () => {
    const profileId = 'p1';
    seed(profileId, makeConversation('conv1', [makeSummaryMarker('prior')]));
    const summariseMock = vi.fn<(headSlice: readonly Message[]) => Promise<SummariserResult | null>>();
    const result = await useConversationsStore.getState().summariseAndTrim(profileId, 'conv1', {
      summarise: summariseMock,
    });
    expect(result.outcome).toBe('noop');
    if (result.outcome !== 'noop') return;
    expect(result.reason).toBe('no-head-to-trim');
    expect(summariseMock).not.toHaveBeenCalled();
  });
});
