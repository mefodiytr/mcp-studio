import { describe, expect, it } from 'vitest';

import { matchesServerName, pluginManifestSchema } from './index';

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
