import { describe, expect, it } from 'vitest';

import type { DiagnosticFlow, Plugin, PluginContext } from './index';
import { matchesServerName, mergeToolAnnotations, pluginManifestSchema } from './index';

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
