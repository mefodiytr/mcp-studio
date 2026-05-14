import { describe, expect, it } from 'vitest';
import type { Plugin, PluginContext } from '@mcp-studio/plugin-api';

import {
  HOST_BASE_SYSTEM_PROMPT,
  assemblePluginContributions,
  substituteFlowPrompt,
} from './plugin-prompts';

function makeCtx(): PluginContext {
  return {
    connection: {
      connectionId: 'c',
      profileId: 'p',
      serverInfo: { name: 'x', version: '0.1.0' },
      status: 'connected',
    },
    callTool: async () => ({}),
    listTools: async () => [],
    listResources: async () => [],
    listResourceTemplates: async () => [],
    readResource: async () => ({}),
    listPrompts: async () => [],
    getPrompt: async () => ({}),
    rawRequest: async () => ({}),
    setCwd: () => undefined,
  };
}

const empty: Plugin = {
  manifest: { name: 'empty', version: '0.1.0', matches: /empty/ },
  views: [],
};

describe('assemblePluginContributions', () => {
  it('with no plugins, returns the host base system prompt unchanged + empty starter/flow lists', () => {
    const out = assemblePluginContributions([], makeCtx());
    expect(out.systemPrompt).toBe(HOST_BASE_SYSTEM_PROMPT);
    expect(out.starterQuestions).toEqual([]);
    expect(out.diagnosticFlows).toEqual([]);
  });

  it('with a no-contribution plugin, returns the host base system prompt unchanged (host does not crash)', () => {
    const out = assemblePluginContributions([empty], makeCtx());
    expect(out.systemPrompt).toBe(HOST_BASE_SYSTEM_PROMPT);
    expect(out.starterQuestions).toEqual([]);
    expect(out.diagnosticFlows).toEqual([]);
  });

  it('with a contributing plugin, joins the section onto the host base with --- separators', () => {
    const plugin: Plugin = {
      manifest: { name: 'p', version: '0.1.0', matches: /p/ },
      views: [],
      systemPrompt: () => 'PLUGIN BLOCK',
      starterQuestions: () => ['q1', 'q2'],
      diagnosticFlows: () => [{ id: 'f', title: 'F', description: 'd', prompt: 'do f' }],
    };
    const out = assemblePluginContributions([plugin], makeCtx());
    expect(out.systemPrompt).toContain(HOST_BASE_SYSTEM_PROMPT);
    expect(out.systemPrompt).toContain('\n\n---\n\n');
    expect(out.systemPrompt).toContain('PLUGIN BLOCK');
    expect(out.starterQuestions).toEqual(['q1', 'q2']);
    expect(out.diagnosticFlows).toEqual([
      { id: 'f', title: 'F', description: 'd', prompt: 'do f', pluginName: 'p' },
    ]);
  });

  it('caps starter questions at 6 across all plugins', () => {
    const many: Plugin = {
      manifest: { name: 'many', version: '0.1.0', matches: /many/ },
      views: [],
      starterQuestions: () => Array.from({ length: 10 }, (_, i) => `q${i}`),
    };
    const out = assemblePluginContributions([many], makeCtx());
    expect(out.starterQuestions).toHaveLength(6);
    expect(out.starterQuestions[0]).toBe('q0');
    expect(out.starterQuestions[5]).toBe('q5');
  });

  it('skips empty / whitespace-only contributions defensively', () => {
    const plugin: Plugin = {
      manifest: { name: 'p', version: '0.1.0', matches: /p/ },
      views: [],
      systemPrompt: () => '   ',
      starterQuestions: () => ['', '  ', 'q1'],
    };
    const out = assemblePluginContributions([plugin], makeCtx());
    expect(out.systemPrompt).toBe(HOST_BASE_SYSTEM_PROMPT);
    expect(out.starterQuestions).toEqual(['q1']);
  });

  it('a plugin that throws in a contribution does not break the assembly (its section is dropped)', () => {
    const ok: Plugin = {
      manifest: { name: 'ok', version: '0.1.0', matches: /ok/ },
      views: [],
      systemPrompt: () => 'OK PLUGIN',
    };
    const broken: Plugin = {
      manifest: { name: 'broken', version: '0.1.0', matches: /broken/ },
      views: [],
      systemPrompt: () => {
        throw new Error('intentional');
      },
      starterQuestions: () => {
        throw new Error('intentional');
      },
      diagnosticFlows: () => {
        throw new Error('intentional');
      },
    };
    const out = assemblePluginContributions([broken, ok], makeCtx());
    expect(out.systemPrompt).toContain('OK PLUGIN');
    expect(out.systemPrompt).not.toContain('intentional');
    expect(out.starterQuestions).toEqual([]);
    expect(out.diagnosticFlows).toEqual([]);
  });

  it('joins multiple plugin sections in plugin-list order', () => {
    const a: Plugin = {
      manifest: { name: 'a', version: '0.1.0', matches: /a/ },
      views: [],
      systemPrompt: () => 'AAA',
    };
    const b: Plugin = {
      manifest: { name: 'b', version: '0.1.0', matches: /b/ },
      views: [],
      systemPrompt: () => 'BBB',
    };
    const out = assemblePluginContributions([a, b], makeCtx());
    const aPos = out.systemPrompt.indexOf('AAA');
    const bPos = out.systemPrompt.indexOf('BBB');
    expect(aPos).toBeGreaterThan(0);
    expect(bPos).toBeGreaterThan(aPos);
  });

  it('host base system prompt includes the M5 chart-fence syntax (D8)', () => {
    expect(HOST_BASE_SYSTEM_PROMPT).toMatch(/```chart/);
    expect(HOST_BASE_SYSTEM_PROMPT).toMatch(/timeseries/);
  });

  it('host base system prompt mentions the write-tool pending-queue safety pattern', () => {
    expect(HOST_BASE_SYSTEM_PROMPT).toMatch(/pending-changes queue|pending changes/i);
  });
});

describe('substituteFlowPrompt', () => {
  it('substitutes ${name} tokens with the param value', () => {
    expect(substituteFlowPrompt('Look at ${equipment}', { equipment: 'AHU-1' })).toBe('Look at AHU-1');
  });

  it('leaves unknown tokens in place so the LLM can ask the user', () => {
    expect(substituteFlowPrompt('Run ${flow} on ${item}', { flow: 'rooftop' })).toBe(
      'Run rooftop on ${item}',
    );
  });

  it('handles multiple substitutions + repeats', () => {
    expect(
      substituteFlowPrompt('Find ${q} then summarise ${q}', { q: 'X' }),
    ).toBe('Find X then summarise X');
  });

  it('preserves the template when no params apply', () => {
    expect(substituteFlowPrompt('no tokens here', {})).toBe('no tokens here');
  });
});
