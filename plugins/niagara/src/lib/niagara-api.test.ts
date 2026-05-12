import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { getSlots, inspectComponent, listChildren, payload, textContent } from './niagara-api';

describe('payload', () => {
  it('prefers structuredContent', () => {
    expect(payload({ structuredContent: { a: 1 }, content: [{ type: 'text', text: '{"a":2}' }] })).toEqual({ a: 1 });
  });

  it('falls back to the JSON in content[0].text', () => {
    expect(payload({ content: [{ type: 'text', text: '{"ord":"x"}' }] })).toEqual({ ord: 'x' });
  });

  it('returns {} for non-JSON text, missing content, or junk', () => {
    expect(payload({ content: [{ type: 'text', text: 'Col\tA\nrow' }] })).toEqual({});
    expect(payload({ content: [] })).toEqual({});
    expect(payload('nope')).toEqual({});
    expect(payload(null)).toEqual({});
  });
});

describe('textContent', () => {
  it('returns the first text block, else empty', () => {
    expect(textContent({ content: [{ type: 'image' }, { type: 'text', text: 'hi' }] })).toBe('hi');
    expect(textContent({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a');
    expect(textContent({ structuredContent: { x: 1 } })).toBe('');
    expect(textContent(undefined)).toBe('');
  });
});

function fakeCtx(callTool: PluginContext['callTool']): PluginContext {
  return { connection: { connectionId: 'c1', profileId: 'p1', serverInfo: null, status: 'connected' }, callTool } as PluginContext;
}

describe('listChildren', () => {
  it('maps the children array, filling displayName/name defaults', async () => {
    const ctx = fakeCtx(async (name, args) => {
      expect(name).toBe('listChildren');
      expect(args).toEqual({ ord: 'station:|slot:/' });
      return {
        structuredContent: {
          ord: 'station:|slot:/',
          children: [
            { ord: 'station:|slot:/Drivers', name: 'Drivers', displayName: 'Drivers', type: 'driver:DriverContainer', isPoint: false },
            { ord: 'station:|slot:/Logic/Sensor1', type: 'control:NumericPoint', isPoint: true },
          ],
        },
      };
    });
    const nodes = await listChildren(ctx, 'station:|slot:/');
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ ord: 'station:|slot:/Drivers', displayName: 'Drivers', isPoint: false });
    expect(nodes[1]).toMatchObject({ ord: 'station:|slot:/Logic/Sensor1', name: 'Sensor1', displayName: 'Sensor1', isPoint: true });
  });

  it('passes depth only when > 1, and nests children', async () => {
    const ctx = fakeCtx(async (_name, args) => {
      expect(args).toEqual({ ord: 'station:|slot:/', depth: 2 });
      return { structuredContent: { children: [{ ord: 'station:|slot:/Services', isPoint: false, children: [{ ord: 'station:|slot:/Services/UserService', isPoint: false }] }] } };
    });
    const nodes = await listChildren(ctx, 'station:|slot:/', 2);
    expect(nodes[0]?.children?.[0]?.ord).toBe('station:|slot:/Services/UserService');
  });

  it('returns [] when the result has no children', async () => {
    expect(await listChildren(fakeCtx(async () => ({ structuredContent: { ord: 'x' } })), 'x')).toEqual([]);
    expect(await listChildren(fakeCtx(async () => ({})), 'x')).toEqual([]);
  });
});

describe('inspectComponent', () => {
  it('reads identity + childCount, coercing the bare parentOrd', async () => {
    const ctx = fakeCtx(async () => ({
      structuredContent: { ord: 'station:|slot:/Drivers', parentOrd: 'slot:/', displayName: 'Drivers', name: 'Drivers', childCount: 13, type: 'driver:DriverContainer' },
    }));
    expect(await inspectComponent(ctx, 'station:|slot:/Drivers')).toEqual({
      ord: 'station:|slot:/Drivers',
      name: 'Drivers',
      displayName: 'Drivers',
      type: 'driver:DriverContainer',
      parentOrd: 'station:|slot:/',
      childCount: 13,
    });
  });

  it('falls back: derives name from the ord and parentOrd from the path', async () => {
    const info = await inspectComponent(fakeCtx(async () => ({ structuredContent: {} })), 'station:|slot:/Services/UserService');
    expect(info).toMatchObject({ ord: 'station:|slot:/Services/UserService', name: 'UserService', displayName: 'UserService', parentOrd: 'station:|slot:/Services', childCount: 0, type: '' });
  });
});

describe('getSlots', () => {
  it('maps slot rows (name/type/value, optional facets)', async () => {
    const ctx = fakeCtx(async (name, args) => {
      expect(name).toBe('getSlots');
      expect(args).toEqual({ ord: 'station:|slot:/Services/UserService' });
      return {
        structuredContent: {
          slots: [
            { name: 'lockOutEnabled', type: 'baja:Boolean', value: 'поистине' },
            { name: 'out', type: 'baja:StatusNumeric', value: '21.5 {ok}', facets: { units: '°C', precision: 1 } },
          ],
        },
        content: [{ type: 'text', text: '{}' }],
      };
    });
    const slots = await getSlots(ctx, 'station:|slot:/Services/UserService');
    expect(slots).toEqual([
      { name: 'lockOutEnabled', type: 'baja:Boolean', value: 'поистине', facets: undefined },
      { name: 'out', type: 'baja:StatusNumeric', value: '21.5 {ok}', facets: { units: '°C', precision: 1 } },
    ]);
  });

  it('returns [] when there is no slots array', async () => {
    expect(await getSlots(fakeCtx(async () => ({ structuredContent: { ord: 'x' } })), 'x')).toEqual([]);
  });
});
