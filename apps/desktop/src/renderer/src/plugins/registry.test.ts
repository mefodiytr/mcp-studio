import { describe, expect, it } from 'vitest';

import type { Plugin } from '@mcp-studio/plugin-api';

import { pickPlugin } from './registry';

const fakePlugin = (name: string, matches: RegExp): Plugin => ({
  manifest: { name, version: '0.0.0', matches },
  views: [],
});

describe('pickPlugin', () => {
  const niagara = fakePlugin('niagara', /^niagara/i);
  const fs = fakePlugin('filesystem', /^filesystem/);

  it('picks the plugin matching serverInfo.name', () => {
    expect(pickPlugin({ name: 'niagaramcp' }, [niagara, fs])).toBe(niagara);
    expect(pickPlugin({ name: 'NiagaraStation' }, [niagara, fs])).toBe(niagara);
    expect(pickPlugin({ name: 'filesystem-mcp' }, [niagara, fs])).toBe(fs);
  });

  it('returns undefined when nothing matches or the server name is absent', () => {
    expect(pickPlugin({ name: 'echo-server' }, [niagara, fs])).toBeUndefined();
    expect(pickPlugin(null, [niagara, fs])).toBeUndefined();
    expect(pickPlugin(undefined, [niagara, fs])).toBeUndefined();
  });

  it('defaults to the (currently empty) in-box registry', () => {
    expect(pickPlugin({ name: 'anything' })).toBeUndefined();
  });
});
