import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, textTurn, toolUseTurn } from '../src/fake';
import type { LlmEvent } from '../src/types';

async function collect(it: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

describe('FakeLlmProvider', () => {
  it('replays each programmed turn in order', async () => {
    const provider = new FakeLlmProvider([
      textTurn('one'),
      textTurn('two'),
    ]);
    const first = await collect(
      provider.streamResponse({ system: '', messages: [], tools: [] }),
    );
    const second = await collect(
      provider.streamResponse({ system: '', messages: [], tools: [] }),
    );
    expect(first.some((e) => e.type === 'text-stop' && e.text === 'one')).toBe(true);
    expect(second.some((e) => e.type === 'text-stop' && e.text === 'two')).toBe(true);
  });

  it('throws when called past the programmed turn count', async () => {
    const provider = new FakeLlmProvider([textTurn('only')]);
    await collect(provider.streamResponse({ system: '', messages: [], tools: [] }));
    await expect(
      collect(provider.streamResponse({ system: '', messages: [], tools: [] })),
    ).rejects.toThrow(/only 1 turns programmed/);
  });

  it('captures the request via `seen` for assertion', async () => {
    const provider = new FakeLlmProvider([textTurn('x')]);
    await collect(
      provider.streamResponse({
        system: 'sys',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [],
      }),
    );
    expect(provider.seen).toHaveLength(1);
    expect(provider.seen[0]).toMatchObject({ system: 'sys' });
  });

  it('toolUseTurn — with precedingText emits text-stop at index 0, tool at index 1', async () => {
    const provider = new FakeLlmProvider([
      toolUseTurn('weather', { city: 'NYC' }, { precedingText: 'checking…' }),
    ]);
    const out = await collect(
      provider.streamResponse({ system: '', messages: [], tools: [] }),
    );
    const txt = out.find((e) => e.type === 'text-stop');
    const toolStart = out.find((e) => e.type === 'tool-use-start');
    expect(txt).toMatchObject({ index: 0, text: 'checking…' });
    expect(toolStart).toMatchObject({ index: 1, name: 'weather' });
  });

  it('respects an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new FakeLlmProvider([textTurn('x')]);
    await expect(
      collect(
        provider.streamResponse({
          system: '',
          messages: [],
          tools: [],
          signal: controller.signal,
        }),
      ),
    ).rejects.toThrow(/abort/i);
  });
});
