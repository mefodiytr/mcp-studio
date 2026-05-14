import { describe, expect, it } from 'vitest';

import {
  SYSTEM_PROMPT_CACHE_DEFAULT_TTL_MS,
  SystemPromptCache,
} from './system-prompt-cache';

describe('SystemPromptCache.keyOf', () => {
  it('composes (pluginName, profileId, connectionId) into a stable key', () => {
    expect(SystemPromptCache.keyOf('niagara', 'p1', 'c1')).toBe('niagara:p1:c1');
  });

  it('distinguishes different connectionIds for the same profile (the failover case)', () => {
    expect(SystemPromptCache.keyOf('niagara', 'p1', 'c1')).not.toBe(
      SystemPromptCache.keyOf('niagara', 'p1', 'c2'),
    );
  });
});

describe('SystemPromptCache — get / set / TTL', () => {
  it('default TTL is 30 minutes per the M6 D4 promt17 nuance', () => {
    expect(SYSTEM_PROMPT_CACHE_DEFAULT_TTL_MS).toBe(30 * 60 * 1000);
  });

  it('get returns null on a miss', () => {
    const cache = new SystemPromptCache();
    expect(cache.get('absent')).toBeNull();
  });

  it('set + get round-trips an entry within TTL', () => {
    const cache = new SystemPromptCache();
    const now = 1_000_000;
    cache.set('k', 'prompt text', { ttlMs: 5_000, now });
    const entry = cache.get('k', now + 1_000);
    expect(entry?.value).toBe('prompt text');
    expect(entry?.insertedAt).toBe(now);
    expect(entry?.expiresAt).toBe(now + 5_000);
  });

  it('get returns null + evicts after TTL elapses', () => {
    const cache = new SystemPromptCache();
    const now = 1_000_000;
    cache.set('k', 'v', { ttlMs: 1_000, now });
    // Past the TTL: returns null
    expect(cache.get('k', now + 2_000)).toBeNull();
    // Subsequent reads also miss (entry was evicted)
    expect(cache.get('k', now + 500)).toBeNull();
  });

  it('set replaces an existing entry + extends the TTL', () => {
    const cache = new SystemPromptCache();
    const t0 = 1_000_000;
    cache.set('k', 'old', { ttlMs: 5_000, now: t0 });
    cache.set('k', 'new', { ttlMs: 10_000, now: t0 + 1_000 });
    expect(cache.get('k', t0 + 6_000)?.value).toBe('new');
    expect(cache.get('k', t0 + 6_000)?.expiresAt).toBe(t0 + 11_000);
  });

  it('uses Date.now() when no explicit `now` is passed', () => {
    const cache = new SystemPromptCache();
    cache.set('k', 'v', { ttlMs: 10_000 });
    // Hit within the default TTL (10s) — implementation uses Date.now() so
    // the entry should be readable immediately.
    expect(cache.get('k')?.value).toBe('v');
  });
});

describe('SystemPromptCache — delete / clear / size', () => {
  it('delete drops an entry; returns true if it existed', () => {
    const cache = new SystemPromptCache();
    cache.set('k', 'v');
    expect(cache.delete('k')).toBe(true);
    expect(cache.delete('k')).toBe(false);
    expect(cache.get('k')).toBeNull();
  });

  it('clear drops every entry', () => {
    const cache = new SystemPromptCache();
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    expect(cache.size()).toBe(3);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('deleteMatching drops entries whose key matches the predicate; returns the count', () => {
    const cache = new SystemPromptCache();
    cache.set('niagara:p1:c1', 'a');
    cache.set('niagara:p2:c2', 'b');
    cache.set('niagara:p1:c3', 'c');
    cache.set('other:p1:c1', 'd');
    // Drop every entry under plugin "niagara" + profile "p1" — leaves the
    // other-plugin same-profile entry (`other:p1:c1`) and the niagara
    // different-profile entry (`niagara:p2:c2`) alone.
    const removed = cache.deleteMatching((k) => k.startsWith('niagara:p1:'));
    expect(removed).toBe(2);
    expect(cache.size()).toBe(2);
    expect(cache.get('niagara:p1:c1')).toBeNull();
    expect(cache.get('niagara:p1:c3')).toBeNull();
    expect(cache.get('niagara:p2:c2')?.value).toBe('b');
    expect(cache.get('other:p1:c1')?.value).toBe('d');
  });
});

describe('SystemPromptCache — multi-key isolation', () => {
  it('different keys stay independent', () => {
    const cache = new SystemPromptCache();
    cache.set('a:p:c', 'A');
    cache.set('b:p:c', 'B');
    expect(cache.get('a:p:c')?.value).toBe('A');
    expect(cache.get('b:p:c')?.value).toBe('B');
  });

  it('size reflects number of entries (not per-profile)', () => {
    const cache = new SystemPromptCache();
    cache.set('niagara:p1:c1', 'a');
    cache.set('niagara:p1:c2', 'b');
    cache.set('niagara:p2:c1', 'c');
    expect(cache.size()).toBe(3);
  });
});
