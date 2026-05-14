import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { AnthropicStreamMapper, type AnthropicSseEvent } from '../src/anthropic-stream';
import type { LlmEvent } from '../src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): AnthropicSseEvent[] {
  const path = resolve(__dirname, 'fixtures', `${name}.jsonl`);
  const text = readFileSync(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AnthropicSseEvent);
}

function runFixture(name: string): LlmEvent[] {
  const events = loadFixture(name);
  const mapper = new AnthropicStreamMapper();
  return events.flatMap((ev) => mapper.push(ev));
}

describe('AnthropicStreamMapper — fixtures (real wire shape from Anthropic docs)', () => {
  it('text-only stream — emits message-start, one text-delta per token, text-stop, message-stop', () => {
    const out = runFixture('anthropic-text-only-stream');
    expect(out[0]).toMatchObject({ type: 'message-start', model: 'claude-opus-4-7' });
    const textDeltas = out.filter((e) => e.type === 'text-delta');
    expect(textDeltas.map((e) => 'text' in e ? e.text : '')).toEqual(['Hello', '!']);
    const textStop = out.find((e) => e.type === 'text-stop');
    expect(textStop).toMatchObject({ type: 'text-stop', index: 0, text: 'Hello!' });
    const stop = out.at(-1);
    expect(stop).toMatchObject({ type: 'message-stop', stopReason: 'end_turn' });
  });

  it('interleaved text + tool_use stream — text block followed by tool_use, parsed input', () => {
    const out = runFixture('anthropic-interleaved-stream');
    // Sequence: message-start → text-deltas → text-stop → tool-use-start →
    // tool-use-input-deltas → tool-use-complete → message-stop.
    const types = out.map((e) => e.type);
    expect(types[0]).toBe('message-start');
    expect(types).toContain('text-stop');
    expect(types).toContain('tool-use-start');
    expect(types).toContain('tool-use-complete');
    expect(types.at(-1)).toBe('message-stop');

    const textStop = out.find((e) => e.type === 'text-stop');
    expect(textStop).toMatchObject({
      type: 'text-stop',
      index: 0,
      text: "Okay, let's check the weather for San Francisco, CA:",
    });

    const toolStart = out.find((e) => e.type === 'tool-use-start');
    expect(toolStart).toMatchObject({
      type: 'tool-use-start',
      index: 1,
      name: 'get_weather',
      toolUseId: 'toolu_01T1x1fJ34qAmk2tNTrN7Up6',
    });

    const toolComplete = out.find((e) => e.type === 'tool-use-complete');
    expect(toolComplete).toMatchObject({
      type: 'tool-use-complete',
      index: 1,
      name: 'get_weather',
      input: { location: 'San Francisco, CA' },
    });

    const stop = out.at(-1);
    expect(stop).toMatchObject({ type: 'message-stop', stopReason: 'tool_use' });
  });

  it('partial_json deltas accumulate; final parse only on content_block_stop', () => {
    const out = runFixture('anthropic-interleaved-stream');
    // The mapper emits one tool-use-input-delta per partial_json event.
    const inputDeltas = out.filter((e) => e.type === 'tool-use-input-delta');
    expect(inputDeltas.length).toBeGreaterThanOrEqual(5);
    // None of the intermediate deltas should expose a parsed `input` — only the
    // tool-use-complete event carries it.
    for (const d of inputDeltas) {
      expect(d).not.toHaveProperty('input');
    }
  });

  it('tool_use without preceding text (edge case) — block 0 is tool_use directly', () => {
    const out = runFixture('anthropic-tool-only-stream');
    const types = out.map((e) => e.type);
    expect(types[0]).toBe('message-start');
    expect(types).not.toContain('text-stop');
    expect(types).toContain('tool-use-start');
    expect(types).toContain('tool-use-complete');

    const toolStart = out.find((e) => e.type === 'tool-use-start');
    expect(toolStart).toMatchObject({ index: 0, name: 'get_weather' });
    const toolComplete = out.find((e) => e.type === 'tool-use-complete');
    expect(toolComplete).toMatchObject({
      index: 0,
      input: { location: 'Paris, FR' },
    });
  });

  it('multiple tool_use blocks in one assistant message — both surface with their indices', () => {
    const out = runFixture('anthropic-multi-tool-stream');
    const toolStarts = out.filter((e) => e.type === 'tool-use-start');
    expect(toolStarts).toHaveLength(2);
    const toolCompletes = out.filter((e) => e.type === 'tool-use-complete');
    expect(toolCompletes).toHaveLength(2);
    const inputs = toolCompletes.map((e) => 'input' in e ? e.input : null);
    expect(inputs).toEqual([{ location: 'Paris, FR' }, { location: 'London, UK' }]);
  });

  it('ping events are dropped silently', () => {
    const mapper = new AnthropicStreamMapper();
    expect(mapper.push({ type: 'ping' })).toEqual([]);
  });

  it('malformed partial_json accumulation surfaces as an error event', () => {
    const mapper = new AnthropicStreamMapper();
    mapper.push({
      type: 'message_start',
      message: { id: 'msg_bad', model: 'm', usage: { input_tokens: 1, output_tokens: 0 } },
    });
    mapper.push({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 't1', name: 'x', input: {} },
    });
    mapper.push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"bad: json' },
    });
    const out = mapper.push({ type: 'content_block_stop', index: 0 });
    expect(out[0]).toMatchObject({
      type: 'error',
      error: { type: 'tool_use_input_parse_error' },
    });
  });

  it('text_delta on an unstarted block is ignored (defensive)', () => {
    const mapper = new AnthropicStreamMapper();
    const out = mapper.push({
      type: 'content_block_delta',
      index: 99,
      delta: { type: 'text_delta', text: 'orphan' },
    });
    expect(out).toEqual([]);
  });

  it('message-stop carries the cumulative output_tokens usage from message_delta', () => {
    const out = runFixture('anthropic-interleaved-stream');
    const stop = out.at(-1);
    expect(stop).toMatchObject({
      type: 'message-stop',
      usage: { inputTokens: 472, outputTokens: 89 },
    });
  });
});
