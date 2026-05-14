import { describe, expect, it, vi } from 'vitest';
import type { Plugin, PluginContext } from '@mcp-studio/plugin-api';

import {
  HOST_BASE_SYSTEM_PROMPT,
  PluginSystemPromptTimeoutError,
  SYSTEM_PROMPT_TIMEOUT_MS,
  assemblePluginContributions,
  collectStaticContributions,
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

describe('assemblePluginContributions (M6 C84 — async with timeout)', () => {
  it('with no plugins, returns the host base system prompt unchanged + empty starter/flow lists', async () => {
    const out = await assemblePluginContributions([], makeCtx());
    expect(out.systemPrompt).toBe(HOST_BASE_SYSTEM_PROMPT);
    expect(out.starterQuestions).toEqual([]);
    expect(out.diagnosticFlows).toEqual([]);
  });

  it('with a no-contribution plugin, returns the host base system prompt unchanged (host does not crash)', async () => {
    const out = await assemblePluginContributions([empty], makeCtx());
    expect(out.systemPrompt).toBe(HOST_BASE_SYSTEM_PROMPT);
    expect(out.starterQuestions).toEqual([]);
    expect(out.diagnosticFlows).toEqual([]);
  });

  it('synchronous systemPrompt return continues to satisfy the new signature (M5 back-compat)', async () => {
    const plugin: Plugin = {
      manifest: { name: 'p', version: '0.1.0', matches: /p/ },
      views: [],
      systemPrompt: () => 'PLUGIN BLOCK',
      starterQuestions: () => ['q1', 'q2'],
      diagnosticFlows: () => [{ id: 'f', title: 'F', description: 'd', prompt: 'do f' }],
    };
    const out = await assemblePluginContributions([plugin], makeCtx());
    expect(out.systemPrompt).toContain(HOST_BASE_SYSTEM_PROMPT);
    expect(out.systemPrompt).toContain('\n\n---\n\n');
    expect(out.systemPrompt).toContain('PLUGIN BLOCK');
    expect(out.starterQuestions).toEqual(['q1', 'q2']);
    expect(out.diagnosticFlows).toEqual([
      { id: 'f', title: 'F', description: 'd', prompt: 'do f', pluginName: 'p' },
    ]);
  });

  it('async systemPrompt return resolves + lands in the prompt', async () => {
    const plugin: Plugin = {
      manifest: { name: 'p', version: '0.1.0', matches: /p/ },
      views: [],
      systemPrompt: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 'ASYNC PLUGIN BLOCK';
      },
    };
    const out = await assemblePluginContributions([plugin], makeCtx());
    expect(out.systemPrompt).toContain('ASYNC PLUGIN BLOCK');
  });

  it('caps starter questions at 6 across all plugins', async () => {
    const many: Plugin = {
      manifest: { name: 'many', version: '0.1.0', matches: /many/ },
      views: [],
      starterQuestions: () => Array.from({ length: 10 }, (_, i) => `q${i}`),
    };
    const out = await assemblePluginContributions([many], makeCtx());
    expect(out.starterQuestions).toHaveLength(6);
    expect(out.starterQuestions[0]).toBe('q0');
    expect(out.starterQuestions[5]).toBe('q5');
  });

  it('skips empty / whitespace-only contributions defensively', async () => {
    const plugin: Plugin = {
      manifest: { name: 'p', version: '0.1.0', matches: /p/ },
      views: [],
      systemPrompt: () => '   ',
      starterQuestions: () => ['', '  ', 'q1'],
    };
    const out = await assemblePluginContributions([plugin], makeCtx());
    expect(out.systemPrompt).toBe(HOST_BASE_SYSTEM_PROMPT);
    expect(out.starterQuestions).toEqual(['q1']);
  });

  it('a plugin that throws synchronously in systemPrompt is dropped (host does not crash)', async () => {
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
    const out = await assemblePluginContributions([broken, ok], makeCtx());
    expect(out.systemPrompt).toContain('OK PLUGIN');
    expect(out.systemPrompt).not.toContain('intentional');
    expect(out.starterQuestions).toEqual([]);
    expect(out.diagnosticFlows).toEqual([]);
  });

  it('a plugin whose async systemPrompt rejects is dropped (host does not crash)', async () => {
    const broken: Plugin = {
      manifest: { name: 'broken', version: '0.1.0', matches: /broken/ },
      views: [],
      systemPrompt: async () => {
        throw new Error('intentional rejection');
      },
    };
    const out = await assemblePluginContributions([broken], makeCtx());
    expect(out.systemPrompt).toBe(HOST_BASE_SYSTEM_PROMPT);
  });

  it('joins multiple plugin sections in plugin-list order', async () => {
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
    const out = await assemblePluginContributions([a, b], makeCtx());
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

describe('assemblePluginContributions — defensive timeout (M6 C84 / D4)', () => {
  it('default timeout is 10s per the M6 D4 promt17 nuance', () => {
    expect(SYSTEM_PROMPT_TIMEOUT_MS).toBe(10_000);
  });

  it('fires PluginSystemPromptTimeoutError when systemPrompt(ctx) outlasts timeoutMs; the plugin section is dropped', async () => {
    const slow: Plugin = {
      manifest: { name: 'slow', version: '0.1.0', matches: /slow/ },
      views: [],
      systemPrompt: () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('NEVER RENDERED'), 200);
        }),
    };
    const onTimeout = vi.fn();
    const out = await assemblePluginContributions([slow], makeCtx(), {
      timeoutMs: 20,
      onSystemPromptTimeout: onTimeout,
    });
    expect(out.systemPrompt).toBe(HOST_BASE_SYSTEM_PROMPT);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledWith('slow');
  });

  it('does NOT fire onSystemPromptTimeout for non-timeout rejections', async () => {
    const broken: Plugin = {
      manifest: { name: 'broken', version: '0.1.0', matches: /broken/ },
      views: [],
      systemPrompt: async () => {
        throw new Error('not a timeout');
      },
    };
    const onTimeout = vi.fn();
    await assemblePluginContributions([broken], makeCtx(), {
      timeoutMs: 1_000,
      onSystemPromptTimeout: onTimeout,
    });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('timing-out one plugin does not block the next plugin from contributing', async () => {
    const slow: Plugin = {
      manifest: { name: 'slow', version: '0.1.0', matches: /slow/ },
      views: [],
      systemPrompt: () => new Promise((resolve) => setTimeout(() => resolve('NEVER'), 200)),
    };
    const fast: Plugin = {
      manifest: { name: 'fast', version: '0.1.0', matches: /fast/ },
      views: [],
      systemPrompt: () => 'FAST PROMPT',
    };
    const out = await assemblePluginContributions([slow, fast], makeCtx(), {
      timeoutMs: 20,
    });
    expect(out.systemPrompt).toContain('FAST PROMPT');
    expect(out.systemPrompt).not.toContain('NEVER');
  });

  it('PluginSystemPromptTimeoutError carries the plugin name + the timeout ms', () => {
    const err = new PluginSystemPromptTimeoutError('niagara', 10_000);
    expect(err.pluginName).toBe('niagara');
    expect(err.message).toContain('niagara');
    expect(err.message).toContain('10000');
    expect(err.name).toBe('PluginSystemPromptTimeoutError');
  });
});

describe('collectStaticContributions (M6 C84 — sync subset)', () => {
  it('returns starter chips + diagnostic flows synchronously, no system-prompt computation', () => {
    const plugin: Plugin = {
      manifest: { name: 'p', version: '0.1.0', matches: /p/ },
      views: [],
      systemPrompt: () => 'never read by collectStatic',
      starterQuestions: () => ['q1', 'q2'],
      diagnosticFlows: () => [{ id: 'f', title: 'F', description: 'd', prompt: 'p' }],
    };
    const out = collectStaticContributions([plugin], makeCtx());
    expect(out.starterQuestions).toEqual(['q1', 'q2']);
    expect(out.diagnosticFlows).toMatchObject([{ id: 'f', pluginName: 'p' }]);
  });

  it('skips throwing starterQuestions / diagnosticFlows without aborting other plugins', () => {
    const broken: Plugin = {
      manifest: { name: 'broken', version: '0.1.0', matches: /broken/ },
      views: [],
      starterQuestions: () => {
        throw new Error('boom');
      },
      diagnosticFlows: () => {
        throw new Error('boom');
      },
    };
    const ok: Plugin = {
      manifest: { name: 'ok', version: '0.1.0', matches: /ok/ },
      views: [],
      starterQuestions: () => ['hi'],
    };
    const out = collectStaticContributions([broken, ok], makeCtx());
    expect(out.starterQuestions).toEqual(['hi']);
    expect(out.diagnosticFlows).toEqual([]);
  });

  it('caps starter questions at 6 across all plugins (same cap as the async path)', () => {
    const many: Plugin = {
      manifest: { name: 'many', version: '0.1.0', matches: /many/ },
      views: [],
      starterQuestions: () => Array.from({ length: 10 }, (_, i) => `q${i}`),
    };
    const out = collectStaticContributions([many], makeCtx());
    expect(out.starterQuestions).toHaveLength(6);
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
