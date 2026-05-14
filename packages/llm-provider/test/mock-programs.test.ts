import { describe, expect, it } from 'vitest';
import { MockLlmProvider, matchUserText, type MockProgram } from '../src/mock-programs';
import type { LlmEvent } from '../src/types';

async function collect(it: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

const greetingProgram: MockProgram = {
  id: 'greeting',
  match: matchUserText('hello'),
  turns: [
    {
      events: [
        {
          type: 'message-start',
          messageId: 'm1',
          model: 'mock',
          usage: { inputTokens: 0, outputTokens: 0 },
        },
        { type: 'text-stop', index: 0, text: 'Hi there!' },
        {
          type: 'message-stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ],
    },
  ],
};

describe('MockLlmProvider', () => {
  it('routes by last user message substring (case-insensitive)', async () => {
    const provider = new MockLlmProvider([greetingProgram]);
    const out = await collect(
      provider.streamResponse({
        system: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello there' }] }],
        tools: [],
      }),
    );
    const text = out.find((e) => e.type === 'text-stop');
    expect(text).toMatchObject({ text: 'Hi there!' });
  });

  it('emits an error event when no program matches', async () => {
    const provider = new MockLlmProvider([greetingProgram]);
    const out = await collect(
      provider.streamResponse({
        system: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'goodbye' }] }],
        tools: [],
      }),
    );
    expect(out[0]).toMatchObject({
      type: 'error',
      error: { type: 'mock_no_program_matched' },
    });
  });

  it('exhausting a program emits a program-exhausted error', async () => {
    const provider = new MockLlmProvider([greetingProgram]);
    const req = {
      system: '',
      messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] }],
      tools: [],
    };
    await collect(provider.streamResponse(req));
    const out = await collect(provider.streamResponse(req));
    expect(out[0]).toMatchObject({
      type: 'error',
      error: { type: 'mock_program_exhausted' },
    });
  });

  it('routes multi-turn programs in order across calls', async () => {
    const multi: MockProgram = {
      id: 'multi',
      match: matchUserText('multi'),
      turns: [
        {
          events: [
            {
              type: 'message-start',
              messageId: 'a',
              model: 'mock',
              usage: { inputTokens: 0, outputTokens: 0 },
            },
            { type: 'text-stop', index: 0, text: 'first' },
            {
              type: 'message-stop',
              stopReason: 'end_turn',
              usage: { inputTokens: 0, outputTokens: 0 },
            },
          ],
        },
        {
          events: [
            {
              type: 'message-start',
              messageId: 'b',
              model: 'mock',
              usage: { inputTokens: 0, outputTokens: 0 },
            },
            { type: 'text-stop', index: 0, text: 'second' },
            {
              type: 'message-stop',
              stopReason: 'end_turn',
              usage: { inputTokens: 0, outputTokens: 0 },
            },
          ],
        },
      ],
    };
    const provider = new MockLlmProvider([multi]);
    const req = {
      system: '',
      messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'multi' }] }],
      tools: [],
    };
    const first = await collect(provider.streamResponse(req));
    const second = await collect(provider.streamResponse(req));
    expect(first.find((e) => e.type === 'text-stop')).toMatchObject({ text: 'first' });
    expect(second.find((e) => e.type === 'text-stop')).toMatchObject({ text: 'second' });
  });
});
