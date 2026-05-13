import type { Plugin } from '@mcp-studio/plugin-api';
import { describe, expect, it } from 'vitest';

import type { ToolDescriptor } from '@shared/domain/connection';

import { applyAnnotationOverrides } from './plugin-tools';

const tool = (over: Partial<ToolDescriptor> = {}): ToolDescriptor => ({
  name: 'createEquipment',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true, destructiveHint: false },
  ...over,
});

const plugin = (overrides: Record<string, Record<string, unknown>> = {}): Plugin =>
  ({ manifest: { name: 'x', version: '0.0.0', matches: /.*/ }, views: [], toolAnnotationOverrides: overrides }) as Plugin;

describe('applyAnnotationOverrides', () => {
  it('overlays the plugin override on the matching tool', () => {
    const t = tool();
    const result = applyAnnotationOverrides(t, plugin({ createEquipment: { readOnlyHint: false, destructiveHint: true } }));
    expect(result.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
    expect(result).not.toBe(t); // a shallow clone
  });

  it('returns the tool unchanged when the plugin has no override for it', () => {
    const t = tool({ name: 'somethingElse' });
    const result = applyAnnotationOverrides(t, plugin({ createEquipment: { readOnlyHint: false } }));
    expect(result).toBe(t);
  });

  it('returns the tool unchanged when there is no plugin', () => {
    const t = tool();
    expect(applyAnnotationOverrides(t, undefined)).toBe(t);
  });

  it('preserves non-overridden annotation keys', () => {
    const t = tool({ annotations: { readOnlyHint: true, idempotentHint: true } });
    const result = applyAnnotationOverrides(t, plugin({ createEquipment: { readOnlyHint: false } }));
    expect(result.annotations).toEqual({ readOnlyHint: false, idempotentHint: true });
  });
});
