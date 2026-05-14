import { describe, expect, it, vi } from 'vitest';
import { FakeLlmProvider, textTurn, toolUseTurn } from '../src/fake';
import { runReAct, type RunnerEvent } from '../src/runner';
import type { LlmMessage } from '../src/types';

async function drain(
  gen: AsyncGenerator<RunnerEvent, LlmMessage[], void>,
): Promise<{ events: RunnerEvent[]; finalHistory: LlmMessage[] }> {
  const events: RunnerEvent[] = [];
  let result: IteratorResult<RunnerEvent, LlmMessage[]>;
  do {
    result = await gen.next();
    if (!result.done) events.push(result.value);
  } while (!result.done);
  return { events, finalHistory: result.value };
}

describe('runReAct', () => {
  it('terminates on end_turn — single text turn, no tools', async () => {
    const provider = new FakeLlmProvider([textTurn('Hello, world.')]);
    const { events, finalHistory } = await drain(
      runReAct({
        provider,
        system: 'sys',
        history: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [],
        dispatchTool: async () => 'unreached',
      }),
    );
    const types = events.map((e) => e.type);
    expect(types).toContain('turn-start');
    expect(types).toContain('text-stop');
    expect(types).toContain('message-stop');
    expect(types).toContain('turn-stop');
    expect(provider.seen).toHaveLength(1);
    expect(finalHistory).toHaveLength(2);
    expect(finalHistory[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello, world.' }],
    });
  });

  it('tool_use → dispatch → tool_result → next turn (ReAct happy path)', async () => {
    const provider = new FakeLlmProvider([
      toolUseTurn('get_weather', { location: 'Paris' }),
      textTurn('It is sunny in Paris.'),
    ]);
    const dispatchTool = vi.fn<
      (n: string, a: Record<string, unknown>, id: string) => Promise<unknown>
    >(async (_n, _a, _id) => '21°C, sunny');
    const { events, finalHistory } = await drain(
      runReAct({
        provider,
        system: 'sys',
        history: [{ role: 'user', content: [{ type: 'text', text: 'weather?' }] }],
        tools: [
          { name: 'get_weather', inputSchema: { type: 'object', properties: { location: { type: 'string' } } } },
        ],
        dispatchTool,
      }),
    );
    expect(dispatchTool).toHaveBeenCalledOnce();
    expect(dispatchTool).toHaveBeenCalledWith('get_weather', { location: 'Paris' }, 'toolu_fake_get_weather');
    expect(events.some((e) => e.type === 'tool-dispatched')).toBe(true);
    // History: user → assistant(tool_use) → user(tool_result) → assistant(text).
    expect(finalHistory).toHaveLength(4);
    expect(finalHistory[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'get_weather', input: { location: 'Paris' } }],
    });
    expect(finalHistory[2]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_fake_get_weather' }],
    });
    expect(finalHistory[3]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'It is sunny in Paris.' }],
    });
  });

  it('failed dispatch surfaces isError on the tool_result; loop continues', async () => {
    const provider = new FakeLlmProvider([
      toolUseTurn('get_weather', { location: 'X' }),
      textTurn('I could not find that location.'),
    ]);
    const { events, finalHistory } = await drain(
      runReAct({
        provider,
        system: 'sys',
        history: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
        tools: [],
        dispatchTool: async () => {
          throw new Error('upstream 404');
        },
      }),
    );
    const dispatchedEvent = events.find((e) => e.type === 'tool-dispatched');
    expect(dispatchedEvent).toMatchObject({ isError: true, output: 'upstream 404' });
    expect(finalHistory[2]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', isError: true }],
    });
  });

  it('max-turns reached — emits the marker and returns', async () => {
    // Always tool_use → infinite-loop without the cap.
    const provider = new FakeLlmProvider(
      Array.from({ length: 5 }, () => toolUseTurn('noop', {})),
    );
    const { events } = await drain(
      runReAct({
        provider,
        system: 'sys',
        history: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        tools: [],
        dispatchTool: async () => 'ok',
        maxTurns: 3,
      }),
    );
    const marker = events.find((e) => e.type === 'max-turns-reached');
    expect(marker).toMatchObject({ type: 'max-turns-reached', turn: 3 });
    expect(provider.seen).toHaveLength(3);
  });

  it('AbortSignal aborted mid-stream — emits aborted, no further turns', async () => {
    const controller = new AbortController();
    const provider = new FakeLlmProvider([textTurn('blah')]);
    // Abort before invocation.
    controller.abort();
    const { events } = await drain(
      runReAct({
        provider,
        system: 'sys',
        history: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
        tools: [],
        dispatchTool: async () => 'unreached',
        signal: controller.signal,
      }),
    );
    expect(events.find((e) => e.type === 'aborted')).toBeTruthy();
    expect(events.find((e) => e.type === 'text-stop')).toBeFalsy();
  });

  it('AbortSignal aborted between tool dispatch and next turn — terminates after the dispatch yield', async () => {
    const controller = new AbortController();
    const provider = new FakeLlmProvider([
      toolUseTurn('go', {}),
      textTurn('reached'),
    ]);
    const { events } = await drain(
      runReAct({
        provider,
        system: 'sys',
        history: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
        tools: [],
        dispatchTool: async () => {
          controller.abort();
          return 'mid-flight';
        },
        signal: controller.signal,
      }),
    );
    expect(events.find((e) => e.type === 'tool-dispatched')).toBeTruthy();
    expect(events.find((e) => e.type === 'aborted')).toBeTruthy();
    // The second textTurn should not have been requested.
    expect(provider.seen).toHaveLength(1);
  });

  it('does not mutate the caller-provided history array', async () => {
    const provider = new FakeLlmProvider([textTurn('hi')]);
    const inputHistory: LlmMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
    ];
    const snapshot = JSON.parse(JSON.stringify(inputHistory)) as LlmMessage[];
    await drain(
      runReAct({
        provider,
        system: 'sys',
        history: inputHistory,
        tools: [],
        dispatchTool: async () => 'x',
      }),
    );
    expect(inputHistory).toEqual(snapshot);
  });

  it('provider error event terminates the loop without throwing', async () => {
    const provider = new FakeLlmProvider([
      {
        events: [
          {
            type: 'message-start',
            messageId: 'm',
            model: 'm',
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
    const { events } = await drain(
      runReAct({
        provider,
        system: 'sys',
        history: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
        tools: [],
        dispatchTool: async () => 'unreached',
      }),
    );
    expect(events.find((e) => e.type === 'error')).toMatchObject({
      type: 'error',
      error: { type: 'rate_limit' },
    });
    expect(provider.seen).toHaveLength(1);
  });
});
