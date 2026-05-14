import { describe, expect, it, vi } from 'vitest';
import type { PlanStep } from '@mcp-studio/plugin-api';

import { FakeLlmProvider, textTurn } from '../src/fake';
import { runPlan, type PlanRunnerEvent } from '../src/plan-runner';
import type { LlmMessage } from '../src/types';

async function drain(
  gen: AsyncGenerator<PlanRunnerEvent, LlmMessage[], void>,
): Promise<{ events: PlanRunnerEvent[]; finalHistory: LlmMessage[] }> {
  const events: PlanRunnerEvent[] = [];
  let r: IteratorResult<PlanRunnerEvent, LlmMessage[]>;
  do {
    r = await gen.next();
    if (!r.done) events.push(r.value);
  } while (!r.done);
  return { events, finalHistory: r.value };
}

const baseHistory: LlmMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'launch the flow' }] },
];

describe('runPlan — happy path', () => {
  it('runs a single tool-call step + binds the result + emits the standard tool-use envelope events', async () => {
    const dispatchTool = vi.fn<(n: string, a: Record<string, unknown>) => Promise<unknown>>(
      async (n, a) => ({ name: n, args: a, fake: 'result' }),
    );
    const plan: PlanStep[] = [
      {
        kind: 'tool-call',
        id: 'find',
        tool: 'findEquipment',
        args: { query: '${param.q}' },
        bindResultTo: 'equipment',
      },
    ];
    const { events, finalHistory } = await drain(
      runPlan({
        provider: new FakeLlmProvider([]),
        system: 'sys',
        history: baseHistory,
        flowId: 'test',
        plan,
        params: { q: 'rooftop 5' },
        dispatchTool,
      }),
    );

    expect(dispatchTool).toHaveBeenCalledWith('findEquipment', { query: 'rooftop 5' }, expect.any(String));
    expect(events[0]).toMatchObject({ type: 'plan-start', flowId: 'test' });
    expect(events.find((e) => e.type === 'plan-step-start')).toMatchObject({
      stepId: 'find',
      kind: 'tool-call',
      tool: 'findEquipment',
    });
    expect(events.find((e) => e.type === 'tool-use-start')).toMatchObject({ name: 'findEquipment' });
    expect(events.find((e) => e.type === 'tool-use-complete')).toMatchObject({
      name: 'findEquipment',
      input: { query: 'rooftop 5' },
    });
    expect(events.find((e) => e.type === 'plan-step-complete')).toMatchObject({
      stepId: 'find',
      kind: 'tool-call',
      result: { name: 'findEquipment', args: { query: 'rooftop 5' }, fake: 'result' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'plan-stop', reason: 'complete' });

    // History: original user + (assistant tool_use) + (user tool_result).
    expect(finalHistory).toHaveLength(3);
    expect(finalHistory[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'findEquipment' }],
    });
    expect(finalHistory[2]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result' }],
    });
  });

  it('llm-step substitutes ${var.path} into the prompt; binds the assistant text', async () => {
    const provider = new FakeLlmProvider([textTurn('It is sunny.')]);
    const plan: PlanStep[] = [
      {
        kind: 'llm-step',
        id: 'summarise',
        prompt: 'Summarise the weather for ${param.location}.',
        bindResultTo: 'summary',
      },
    ];
    const { events, finalHistory } = await drain(
      runPlan({
        provider,
        system: 'sys',
        history: baseHistory,
        flowId: 'test',
        plan,
        params: { location: 'San Francisco' },
        dispatchTool: async () => 'unreached',
      }),
    );

    // The FakeLlmProvider captured the request; check the prompt substitution.
    expect(provider.seen).toHaveLength(1);
    const userMsg = provider.seen[0]?.messages.at(-1);
    expect(userMsg).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Summarise the weather for San Francisco.' }],
    });

    expect(events.find((e) => e.type === 'text-stop')).toMatchObject({ text: 'It is sunny.' });
    expect(events.find((e) => e.type === 'plan-step-complete')).toMatchObject({
      stepId: 'summarise',
      kind: 'llm-step',
      result: 'It is sunny.',
    });

    // History: orig user + the substituted user prompt + the assistant reply.
    expect(finalHistory).toHaveLength(3);
    expect(finalHistory[2]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'It is sunny.' }],
    });
  });

  it('full plan: tool-call → llm-step uses the bound result via ${var.path}', async () => {
    const dispatchTool = vi.fn(async () => ({ ord: 'station:|slot:/Drivers/AHU1', displayName: 'AHU-1' }));
    const provider = new FakeLlmProvider([textTurn('Done.')]);
    const plan: PlanStep[] = [
      {
        kind: 'tool-call',
        id: 'find',
        tool: 'findEquipment',
        args: { q: '${param.query}' },
        bindResultTo: 'equipment',
      },
      {
        kind: 'llm-step',
        id: 'summary',
        prompt: 'Investigated ${equipment.displayName} at ${equipment.ord}',
      },
    ];
    await drain(
      runPlan({
        provider,
        system: 'sys',
        history: baseHistory,
        flowId: 'test',
        plan,
        params: { query: 'rooftop' },
        dispatchTool,
      }),
    );
    const llmMsg = provider.seen[0]?.messages.at(-1);
    expect(llmMsg).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Investigated AHU-1 at station:|slot:/Drivers/AHU1' }],
    });
  });
});

describe('runPlan — runIf skips', () => {
  it('skips a step whose runIf evaluates false; emits plan-step-skip with a reason', async () => {
    const dispatchTool = vi.fn();
    const plan: PlanStep[] = [
      {
        kind: 'tool-call',
        id: 'never',
        tool: 'readHistory',
        args: {},
        runIf: { kind: 'var-length-gt', path: 'alarms', value: 0 },
      },
    ];
    const { events } = await drain(
      runPlan({
        provider: new FakeLlmProvider([]),
        system: 'sys',
        history: baseHistory,
        flowId: 'test',
        plan,
        params: {},
        dispatchTool,
      }),
    );
    expect(dispatchTool).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === 'plan-step-skip')).toMatchObject({
      stepId: 'never',
      reason: expect.stringContaining('alarms.length > 0 failed'),
    });
    // No tool-use-start fired for a skipped step.
    expect(events.some((e) => e.type === 'tool-use-start')).toBe(false);
  });

  it('end-to-end: the rooftop "readHistory if alarms.length > 0" branch fires when alarms are present + skips when empty', async () => {
    const plan: PlanStep[] = [
      {
        kind: 'tool-call',
        id: 'alarms',
        tool: 'getActiveAlarms',
        args: {},
        bindResultTo: 'alarms',
      },
      {
        kind: 'tool-call',
        id: 'history',
        tool: 'readHistory',
        args: {},
        bindResultTo: 'history',
        runIf: { kind: 'var-length-gt', path: 'alarms', value: 0 },
      },
    ];

    // First run: alarms present → history fires.
    const dispatchPresent = vi.fn(async (name: string) =>
      name === 'getActiveAlarms' ? [{ id: 'fire' }] : { rows: 100 },
    );
    const { events: present } = await drain(
      runPlan({
        provider: new FakeLlmProvider([]),
        system: 'sys',
        history: baseHistory,
        flowId: 'test',
        plan,
        params: {},
        dispatchTool: dispatchPresent,
      }),
    );
    expect(dispatchPresent).toHaveBeenCalledTimes(2);
    expect(present.some((e) => e.type === 'plan-step-skip')).toBe(false);

    // Second run: empty alarms → history skips.
    const dispatchEmpty = vi.fn(async () => []);
    const { events: empty } = await drain(
      runPlan({
        provider: new FakeLlmProvider([]),
        system: 'sys',
        history: baseHistory,
        flowId: 'test',
        plan,
        params: {},
        dispatchTool: dispatchEmpty,
      }),
    );
    expect(dispatchEmpty).toHaveBeenCalledTimes(1); // only the alarms call
    expect(empty.find((e) => e.type === 'plan-step-skip')).toMatchObject({ stepId: 'history' });
  });
});

describe('runPlan — error + abort', () => {
  it('a tool-call throw halts the plan + emits plan-step-error + plan-stop', async () => {
    const plan: PlanStep[] = [
      { kind: 'tool-call', id: 'fails', tool: 'broken', args: {} },
      { kind: 'tool-call', id: 'unreached', tool: 'b', args: {} },
    ];
    const dispatchTool = vi.fn(async () => {
      throw new Error('upstream 500');
    });
    const { events } = await drain(
      runPlan({
        provider: new FakeLlmProvider([]),
        system: 'sys',
        history: baseHistory,
        flowId: 'test',
        plan,
        params: {},
        dispatchTool,
      }),
    );
    expect(dispatchTool).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.type === 'plan-step-error')).toMatchObject({
      stepId: 'fails',
      message: 'upstream 500',
    });
    expect(events.at(-1)).toMatchObject({ type: 'plan-stop', reason: 'error' });
  });

  it('aborted signal terminates between steps + emits plan-stop:aborted', async () => {
    const controller = new AbortController();
    const plan: PlanStep[] = [
      { kind: 'tool-call', id: 'first', tool: 'a', args: {} },
      { kind: 'tool-call', id: 'second', tool: 'b', args: {} },
    ];
    const dispatchTool = vi.fn(async () => {
      controller.abort();
      return 'ok';
    });
    const { events } = await drain(
      runPlan({
        provider: new FakeLlmProvider([]),
        system: 'sys',
        history: baseHistory,
        flowId: 'test',
        plan,
        params: {},
        dispatchTool,
        signal: controller.signal,
      }),
    );
    expect(dispatchTool).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.type === 'plan-stop')).toMatchObject({ reason: 'aborted' });
  });

  it('pre-aborted signal returns immediately with plan-stop:aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const dispatchTool = vi.fn();
    const { events } = await drain(
      runPlan({
        provider: new FakeLlmProvider([]),
        system: 'sys',
        history: baseHistory,
        flowId: 'test',
        plan: [{ kind: 'tool-call', id: 'x', tool: 't', args: {} }],
        params: {},
        dispatchTool,
        signal: controller.signal,
      }),
    );
    expect(dispatchTool).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'plan-start', flowId: 'test', params: {} },
      { type: 'plan-stop', reason: 'aborted' },
    ]);
  });
});

describe('runPlan — argument substitution', () => {
  it('preserves typed values for whole-token args (numbers, arrays, booleans)', async () => {
    const dispatchTool = vi.fn(async () => ({}));
    const plan: PlanStep[] = [
      {
        kind: 'tool-call',
        id: 'x',
        tool: 'mixed',
        args: {
          ord: '${param.ord}', // string
          limit: '${param.limit}', // number (preserved typed)
          force: '${param.force}', // boolean
          tags: '${param.tags}', // array
          combined: 'ord-${param.suffix}', // mixed-form → string interp
        },
      },
    ];
    await drain(
      runPlan({
        provider: new FakeLlmProvider([]),
        system: 'sys',
        history: baseHistory,
        flowId: 'test',
        plan,
        params: {
          ord: 'station:|slot:/X',
          limit: 100,
          force: true,
          tags: ['a', 'b'],
          suffix: 'X1',
        },
        dispatchTool,
      }),
    );
    expect(dispatchTool).toHaveBeenCalledWith(
      'mixed',
      {
        ord: 'station:|slot:/X',
        limit: 100,
        force: true,
        tags: ['a', 'b'],
        combined: 'ord-X1',
      },
      expect.any(String),
    );
  });
});

describe('runPlan — does not mutate the caller history', () => {
  it('leaves the caller-supplied history array untouched', async () => {
    const provider = new FakeLlmProvider([textTurn('hi')]);
    const input: LlmMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'go' }] }];
    const snapshot = JSON.parse(JSON.stringify(input)) as LlmMessage[];
    await drain(
      runPlan({
        provider,
        system: 'sys',
        history: input,
        flowId: 'test',
        plan: [{ kind: 'llm-step', id: 'x', prompt: 'say hi' }],
        params: {},
        dispatchTool: async () => 'unreached',
      }),
    );
    expect(input).toEqual(snapshot);
  });
});
