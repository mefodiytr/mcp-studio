import { describe, expect, it } from 'vitest';

import type { ConditionExpr, DiagnosticFlow, PlanStep, Plugin, PluginContext } from './index';
import {
  evalCondition,
  getVarPath,
  matchesServerName,
  mergeToolAnnotations,
  pluginManifestSchema,
  substituteValue,
  substituteVars,
} from './index';

describe('matchesServerName', () => {
  it('matches by RegExp (case-insensitive when the pattern is)', () => {
    const m = { matches: /^niagara/i };
    expect(matchesServerName(m, 'niagaramcp')).toBe(true);
    expect(matchesServerName(m, 'NiagaraMCP')).toBe(true);
    expect(matchesServerName(m, 'echo-server')).toBe(false);
  });

  it('matches by string pattern (coerced to RegExp)', () => {
    const m = { matches: 'niagara' };
    expect(matchesServerName(m, 'my-niagara-station')).toBe(true);
    expect(matchesServerName(m, 'echo')).toBe(false);
  });

  it('returns false for an absent server name', () => {
    expect(matchesServerName({ matches: /.*/ }, null)).toBe(false);
    expect(matchesServerName({ matches: /.*/ }, undefined)).toBe(false);
    expect(matchesServerName({ matches: /.*/ }, '')).toBe(false);
  });
});

describe('pluginManifestSchema', () => {
  it('accepts a valid manifest with a RegExp or a string `matches`', () => {
    expect(pluginManifestSchema.safeParse({ name: 'niagara', version: '0.1.0', matches: /niagara/i }).success).toBe(true);
    expect(pluginManifestSchema.safeParse({ name: 'niagara', version: '0.1.0', matches: 'niagara' }).success).toBe(true);
  });

  it('treats `title` as an optional human label', () => {
    expect(pluginManifestSchema.safeParse({ name: 'niagara', version: '0.1.0', matches: /x/ }).data?.title).toBeUndefined();
    expect(
      pluginManifestSchema.safeParse({ name: 'niagara', version: '0.1.0', title: 'Niagara station', matches: /x/ }).data
        ?.title,
    ).toBe('Niagara station');
    expect(pluginManifestSchema.safeParse({ name: 'x', version: '0.1.0', title: '', matches: /x/ }).success).toBe(false);
  });

  it('rejects a malformed manifest', () => {
    expect(pluginManifestSchema.safeParse({ name: '', version: '0.1.0', matches: /x/ }).success).toBe(false);
    expect(pluginManifestSchema.safeParse({ name: 'x', version: '', matches: /x/ }).success).toBe(false);
    expect(pluginManifestSchema.safeParse({ name: 'x', version: '0.1.0' }).success).toBe(false);
    expect(pluginManifestSchema.safeParse({ name: 'x', version: '0.1.0', matches: 123 }).success).toBe(false);
  });
});

describe('mergeToolAnnotations', () => {
  it('overlays defined keys from the override, leaving the rest of the base alone', () => {
    expect(
      mergeToolAnnotations({ readOnlyHint: true, idempotentHint: true }, { readOnlyHint: false, destructiveHint: true }),
    ).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
  });

  it('treats an absent override key as "leave the base value" (no clobber)', () => {
    expect(mergeToolAnnotations({ readOnlyHint: true, destructiveHint: false }, { destructiveHint: true })).toEqual({
      readOnlyHint: true,
      destructiveHint: true,
    });
    // an explicit `undefined` in the override is also a no-op for that key
    expect(mergeToolAnnotations({ readOnlyHint: true }, { readOnlyHint: undefined, destructiveHint: true })).toEqual({
      readOnlyHint: true,
      destructiveHint: true,
    });
  });

  it('returns the base unchanged when there is no override, and a fresh object from the override over no base', () => {
    const base = { readOnlyHint: true };
    expect(mergeToolAnnotations(base, undefined)).toBe(base);
    const merged = mergeToolAnnotations(undefined, { destructiveHint: true });
    expect(merged).toEqual({ destructiveHint: true });
    expect(mergeToolAnnotations(undefined, undefined)).toBeUndefined();
  });

  it('does not mutate its inputs', () => {
    const base = { readOnlyHint: true };
    const override = { readOnlyHint: false };
    mergeToolAnnotations(base, override);
    expect(base).toEqual({ readOnlyHint: true });
    expect(override).toEqual({ readOnlyHint: false });
  });
});

describe('Plugin — M5 AI co-pilot contract surface', () => {
  // A no-contribution plugin: manifest + an empty views array, no M5 hooks.
  // The host must handle this gracefully (the assembly helper lives in the
  // host package; this test only verifies the *type contract* — that
  // each M5 field is optional and a plugin can ship without them).
  const minimalPlugin: Plugin = {
    manifest: { name: 'minimal', version: '0.1.0', matches: /minimal/ },
    views: [],
  };

  it('a minimal plugin has all M5 hooks as undefined', () => {
    expect(minimalPlugin.systemPrompt).toBeUndefined();
    expect(minimalPlugin.starterQuestions).toBeUndefined();
    expect(minimalPlugin.diagnosticFlows).toBeUndefined();
    expect(minimalPlugin.canHandleWrite).toBeUndefined();
  });

  it('a fully-loaded plugin exposes typed M5 contributions', () => {
    const ctx: PluginContext = {
      connection: {
        connectionId: 'c1',
        profileId: 'p1',
        serverInfo: { name: 'minimal', version: '0.1.0' },
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
    const flow: DiagnosticFlow = {
      id: 'rooftop',
      title: 'Rooftop diagnosis',
      description: 'Walk the rooftop unit',
      prompt: 'Investigate ${equipment}',
      params: [{ name: 'equipment', label: 'Equipment', placeholder: 'e.g. RTU-5' }],
    };
    const plugin: Plugin = {
      manifest: { name: 'p', version: '0.1.0', matches: /p/ },
      views: [],
      systemPrompt: () => 'plugin-specific instructions',
      starterQuestions: () => ['What is X?', 'Show me Y'],
      diagnosticFlows: () => [flow],
      canHandleWrite: (op) => op.name === 'setSlot',
    };
    expect(plugin.systemPrompt?.(ctx)).toBe('plugin-specific instructions');
    expect(plugin.starterQuestions?.(ctx)).toEqual(['What is X?', 'Show me Y']);
    expect(plugin.diagnosticFlows?.(ctx)).toEqual([flow]);
    expect(plugin.canHandleWrite?.({ name: 'setSlot', args: {} })).toBe(true);
    expect(plugin.canHandleWrite?.({ name: 'unknown', args: {} })).toBe(false);
  });
});

describe('getVarPath (M6 — variable-map dotted-path resolver)', () => {
  it('resolves a top-level scalar', () => {
    expect(getVarPath({ a: 1 }, 'a')).toBe(1);
  });

  it('resolves nested object paths', () => {
    expect(getVarPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('resolves array indices', () => {
    expect(getVarPath({ list: ['x', 'y', 'z'] }, 'list.1')).toBe('y');
    expect(getVarPath({ list: [{ name: 'one' }, { name: 'two' }] }, 'list.0.name')).toBe('one');
  });

  it('returns undefined for missing segments + non-traversable values', () => {
    expect(getVarPath({}, 'a.b')).toBeUndefined();
    expect(getVarPath({ a: null }, 'a.b')).toBeUndefined();
    expect(getVarPath({ a: 'string' }, 'a.b')).toBeUndefined();
    expect(getVarPath({ list: [1, 2] }, 'list.99')).toBeUndefined();
    expect(getVarPath({ list: [1, 2] }, 'list.notANumber')).toBeUndefined();
  });

  it('returns undefined for an empty path', () => {
    expect(getVarPath({ a: 1 }, '')).toBeUndefined();
  });
});

describe('evalCondition (M6 — six-tag ConditionExpr DSL)', () => {
  it('"always" returns true; "never" returns false', () => {
    expect(evalCondition({ kind: 'always' }, {})).toBe(true);
    expect(evalCondition({ kind: 'never' }, {})).toBe(false);
  });

  it('absent condition is treated as "always"', () => {
    expect(evalCondition(undefined, {})).toBe(true);
  });

  it('var-truthy: truthy resolution wins', () => {
    expect(evalCondition({ kind: 'var-truthy', path: 'x' }, { x: true })).toBe(true);
    expect(evalCondition({ kind: 'var-truthy', path: 'x' }, { x: 1 })).toBe(true);
    expect(evalCondition({ kind: 'var-truthy', path: 'x' }, { x: 'hi' })).toBe(true);
    expect(evalCondition({ kind: 'var-truthy', path: 'x' }, { x: false })).toBe(false);
    expect(evalCondition({ kind: 'var-truthy', path: 'x' }, { x: 0 })).toBe(false);
    expect(evalCondition({ kind: 'var-truthy', path: 'x' }, { x: '' })).toBe(false);
    expect(evalCondition({ kind: 'var-truthy', path: 'missing' }, {})).toBe(false);
  });

  it('var-defined: distinguishes null/undefined from falsy', () => {
    expect(evalCondition({ kind: 'var-defined', path: 'x' }, { x: false })).toBe(true);
    expect(evalCondition({ kind: 'var-defined', path: 'x' }, { x: 0 })).toBe(true);
    expect(evalCondition({ kind: 'var-defined', path: 'x' }, { x: '' })).toBe(true);
    expect(evalCondition({ kind: 'var-defined', path: 'x' }, { x: null })).toBe(false);
    expect(evalCondition({ kind: 'var-defined', path: 'x' }, {})).toBe(false);
  });

  it('var-compare: numeric ops', () => {
    expect(evalCondition({ kind: 'var-compare', path: 'n', op: '>', value: 5 }, { n: 10 })).toBe(true);
    expect(evalCondition({ kind: 'var-compare', path: 'n', op: '>', value: 5 }, { n: 5 })).toBe(false);
    expect(evalCondition({ kind: 'var-compare', path: 'n', op: '>=', value: 5 }, { n: 5 })).toBe(true);
    expect(evalCondition({ kind: 'var-compare', path: 'n', op: '<', value: 5 }, { n: 4 })).toBe(true);
    expect(evalCondition({ kind: 'var-compare', path: 'n', op: '<=', value: 5 }, { n: 5 })).toBe(true);
  });

  it('var-compare: equality on strings + booleans', () => {
    expect(evalCondition({ kind: 'var-compare', path: 's', op: '==', value: 'hi' }, { s: 'hi' })).toBe(true);
    expect(evalCondition({ kind: 'var-compare', path: 's', op: '!=', value: 'hi' }, { s: 'bye' })).toBe(true);
    expect(evalCondition({ kind: 'var-compare', path: 'b', op: '==', value: true }, { b: true })).toBe(true);
  });

  it('var-compare: missing path resolves to undefined → comparisons fail safely', () => {
    expect(evalCondition({ kind: 'var-compare', path: 'missing', op: '>', value: 0 }, {})).toBe(false);
    expect(evalCondition({ kind: 'var-compare', path: 'missing', op: '==', value: 'x' }, {})).toBe(false);
  });

  it('var-length-gt: array-length predicate (the rooftop "alarms.length > 0" case)', () => {
    expect(evalCondition({ kind: 'var-length-gt', path: 'alarms', value: 0 }, { alarms: [] })).toBe(false);
    expect(
      evalCondition({ kind: 'var-length-gt', path: 'alarms', value: 0 }, { alarms: [{}] }),
    ).toBe(true);
    expect(
      evalCondition({ kind: 'var-length-gt', path: 'alarms', value: 2 }, { alarms: [{}, {}, {}] }),
    ).toBe(true);
    expect(evalCondition({ kind: 'var-length-gt', path: 'missing', value: 0 }, {})).toBe(false);
    // Non-array values aren't lengths.
    expect(
      evalCondition({ kind: 'var-length-gt', path: 'alarms', value: 0 }, { alarms: 'string' }),
    ).toBe(false);
  });

  it('end-to-end: the rooftop-flow conditional skip ("readHistory if alarms.length > 0")', () => {
    const cond: ConditionExpr = { kind: 'var-length-gt', path: 'alarms', value: 0 };
    expect(evalCondition(cond, { alarms: [{ id: 'fire' }] })).toBe(true);
    expect(evalCondition(cond, { alarms: [] })).toBe(false);
  });
});

describe('substituteVars (M6 — string-template substitution)', () => {
  it('substitutes top-level + nested paths', () => {
    expect(substituteVars('Look at ${equipment.displayName}', { equipment: { displayName: 'AHU-1' } })).toBe(
      'Look at AHU-1',
    );
  });

  it('substitutes launcher params via the same `${param.x}` syntax', () => {
    expect(substituteVars('Investigate ${param.equipment_query}', { param: { equipment_query: 'rooftop 5' } })).toBe(
      'Investigate rooftop 5',
    );
  });

  it('leaves unknown tokens in place so the LLM sees them', () => {
    expect(substituteVars('Run ${flow} on ${item}', { flow: 'rooftop' })).toBe('Run rooftop on ${item}');
  });

  it('handles array-index paths', () => {
    expect(substituteVars('First alarm: ${alarms.0.id}', { alarms: [{ id: 'fire' }] })).toBe('First alarm: fire');
  });

  it('JSON-stringifies non-string values', () => {
    expect(substituteVars('Equipment: ${equipment}', { equipment: { name: 'AHU-1', count: 2 } })).toBe(
      'Equipment: {"name":"AHU-1","count":2}',
    );
    expect(substituteVars('Count: ${n}', { n: 42 })).toBe('Count: 42');
  });

  it('preserves the template when no tokens apply', () => {
    expect(substituteVars('no tokens here', {})).toBe('no tokens here');
  });
});

describe('substituteValue (M6 — typed substitution for tool-call args)', () => {
  it('preserves the typed value when the entire string is a single token', () => {
    expect(substituteValue('${equipment.alarms}', { equipment: { alarms: [1, 2] } })).toEqual([1, 2]);
    expect(substituteValue('${param.limit}', { param: { limit: 100 } })).toBe(100);
    expect(substituteValue('${param.force}', { param: { force: true } })).toBe(true);
  });

  it('interpolates as a string when the input mixes tokens with text', () => {
    expect(substituteValue('ord-${equipment.id}', { equipment: { id: 'X1' } })).toBe('ord-X1');
  });

  it('non-string values pass through unchanged', () => {
    expect(substituteValue(42, {})).toBe(42);
    expect(substituteValue(['a', 'b'], {})).toEqual(['a', 'b']);
    expect(substituteValue(null, {})).toBeNull();
  });

  it('returns the literal `${...}` when the token doesn\'t resolve', () => {
    expect(substituteValue('${missing}', {})).toBe('${missing}');
    expect(substituteValue('${equipment.nope}', { equipment: {} })).toBe('${equipment.nope}');
  });
});

describe('PlanStep + DiagnosticFlow.plan (M6 — structural contract)', () => {
  it('a tool-call step compiles with the canonical shape', () => {
    const step: PlanStep = {
      kind: 'tool-call',
      id: 'find',
      tool: 'findEquipment',
      args: { query: '${param.equipment_query}' },
      bindResultTo: 'equipment',
      runIf: { kind: 'always' },
      label: 'Find equipment',
    };
    expect(step.kind).toBe('tool-call');
  });

  it('an llm-step compiles with the canonical shape', () => {
    const step: PlanStep = {
      kind: 'llm-step',
      id: 'summary',
      prompt: 'Summarise ${equipment.displayName}',
      model: 'claude-haiku-4-5',
    };
    expect(step.kind).toBe('llm-step');
  });

  it('a DiagnosticFlow with a plan compiles (back-compat: M5 flows without `plan` continue to typecheck)', () => {
    const m5Flow: DiagnosticFlow = {
      id: 'm5',
      title: 'M5',
      description: 'no plan',
      prompt: 'do the thing',
    };
    const m6Flow: DiagnosticFlow = {
      id: 'm6',
      title: 'M6',
      description: 'with plan',
      prompt: 'do the thing (M5 fallback)',
      plan: [
        {
          kind: 'tool-call',
          id: 'a',
          tool: 'findEquipment',
          args: {},
          bindResultTo: 'eq',
        },
        {
          kind: 'llm-step',
          id: 'b',
          prompt: 'summarise ${eq}',
          runIf: { kind: 'var-defined', path: 'eq' },
        },
      ],
    };
    expect(m5Flow.plan).toBeUndefined();
    expect(m6Flow.plan).toHaveLength(2);
  });
});
