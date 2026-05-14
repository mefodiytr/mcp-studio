import { describe, expect, it } from 'vitest';

import { getEffectiveAnnotations, isWriteCall, pickManifest } from './manifest-registry';

describe('pickManifest', () => {
  it('matches the Niagara manifest by serverInfo.name (case-insensitive)', () => {
    expect(pickManifest('niagaramcp')?.name).toBe('niagara');
    expect(pickManifest('NiagaraMCP')?.name).toBe('niagara');
    expect(pickManifest('niagara-station')?.name).toBe('niagara');
  });

  it('returns undefined for non-specialized servers', () => {
    expect(pickManifest('echo-server')).toBeUndefined();
    expect(pickManifest('mcp-server-everything')).toBeUndefined();
    expect(pickManifest(null)).toBeUndefined();
    expect(pickManifest(undefined)).toBeUndefined();
    expect(pickManifest('')).toBeUndefined();
  });
});

describe('getEffectiveAnnotations (M5 C75 — main-side resolution)', () => {
  it('overlays the Niagara walkthrough-write override onto the base annotations', () => {
    // niagaramcp ships createSpace with readOnlyHint:true (wrong); the override flips it.
    const manifest = pickManifest('niagaramcp');
    const result = getEffectiveAnnotations(manifest, 'createSpace', {
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(result?.readOnlyHint).toBe(false);
  });

  it('overlays destructiveHint when the override declares it (bulkCreateEquipment)', () => {
    const manifest = pickManifest('niagaramcp');
    const result = getEffectiveAnnotations(manifest, 'bulkCreateEquipment', {
      readOnlyHint: true,
    });
    expect(result?.destructiveHint).toBe(true);
    expect(result?.readOnlyHint).toBe(false);
  });

  it('returns the base unchanged for tools without an override', () => {
    const manifest = pickManifest('niagaramcp');
    const base = { readOnlyHint: true };
    expect(getEffectiveAnnotations(manifest, 'readPoint', base)).toEqual({ readOnlyHint: true });
  });

  it('returns the base unchanged when no manifest is picked (non-specialized server)', () => {
    const base = { readOnlyHint: true, destructiveHint: false };
    expect(getEffectiveAnnotations(undefined, 'whatever', base)).toEqual(base);
  });

  it('handles undefined base annotations (server omits them entirely)', () => {
    const manifest = pickManifest('niagaramcp');
    const result = getEffectiveAnnotations(manifest, 'createSpace', undefined);
    expect(result?.readOnlyHint).toBe(false);
  });
});

describe('isWriteCall (M5 C75 — main-side safety predicate)', () => {
  it('true when destructiveHint is true (independent of readOnlyHint)', () => {
    expect(isWriteCall({ destructiveHint: true })).toBe(true);
    expect(isWriteCall({ destructiveHint: true, readOnlyHint: true })).toBe(true);
  });

  it('true when readOnlyHint is explicitly false (the niagara override case)', () => {
    expect(isWriteCall({ readOnlyHint: false })).toBe(true);
  });

  it('false on ambiguity — refuses to claim "write" without evidence (parity with renderer-side)', () => {
    expect(isWriteCall({ readOnlyHint: true })).toBe(false);
    expect(isWriteCall({})).toBe(false);
    expect(isWriteCall(undefined)).toBe(false);
  });

  it('end-to-end: an AI calling createSpace against niagaramcp resolves to isWriteCall=true', () => {
    const manifest = pickManifest('niagaramcp');
    const baseFromServer = { readOnlyHint: true, destructiveHint: false }; // niagaramcp's wrong shipping shape
    const effective = getEffectiveAnnotations(manifest, 'createSpace', baseFromServer);
    expect(isWriteCall(effective)).toBe(true);
  });

  it('end-to-end: an AI calling readPoint against niagaramcp resolves to isWriteCall=false (read tool unaffected)', () => {
    const manifest = pickManifest('niagaramcp');
    const baseFromServer = { readOnlyHint: true };
    const effective = getEffectiveAnnotations(manifest, 'readPoint', baseFromServer);
    expect(isWriteCall(effective)).toBe(false);
  });
});
