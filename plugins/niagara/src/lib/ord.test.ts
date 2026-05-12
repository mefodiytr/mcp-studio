import { describe, expect, it } from 'vitest';

import { ancestorOrds, fullOrd, ordLeaf, ordTrail, parentOrd, ROOT_ORD, slotPath } from './ord';

describe('ORD helpers', () => {
  it('extracts the slot path (normalised, no trailing slash except root)', () => {
    expect(slotPath('station:|slot:/')).toBe('/');
    expect(slotPath('station:|slot:/Services/UserService')).toBe('/Services/UserService');
    expect(slotPath('station:|slot:/Drivers/')).toBe('/Drivers');
    expect(slotPath('slot:/Logic/Sensor1')).toBe('/Logic/Sensor1');
    expect(slotPath('/bare/path')).toBe('/bare/path');
  });

  it('coerces bare slot ords to the full station:|slot: form', () => {
    expect(fullOrd('station:|slot:/Drivers')).toBe('station:|slot:/Drivers');
    expect(fullOrd('slot:/')).toBe('station:|slot:/');
    expect(fullOrd('slot:/Services/UserService')).toBe('station:|slot:/Services/UserService');
    expect(fullOrd('/Logic')).toBe('station:|slot:/Logic');
  });

  it('reads the leaf slot name', () => {
    expect(ordLeaf(ROOT_ORD)).toBe('/');
    expect(ordLeaf('station:|slot:/Services/UserService')).toBe('UserService');
    expect(ordLeaf('station:|slot:/Drivers')).toBe('Drivers');
  });

  it('walks up to the parent ord (null at the root)', () => {
    expect(parentOrd(ROOT_ORD)).toBeNull();
    expect(parentOrd('station:|slot:/Drivers')).toBe(ROOT_ORD);
    expect(parentOrd('station:|slot:/Services/UserService')).toBe('station:|slot:/Services');
  });

  it('builds the breadcrumb trail root → … → ord', () => {
    expect(ordTrail(ROOT_ORD)).toEqual([{ name: '/', ord: ROOT_ORD }]);
    expect(ordTrail('station:|slot:/Services/UserService')).toEqual([
      { name: '/', ord: ROOT_ORD },
      { name: 'Services', ord: 'station:|slot:/Services' },
      { name: 'UserService', ord: 'station:|slot:/Services/UserService' },
    ]);
  });

  it('lists ancestor ords (excluding the node itself)', () => {
    expect(ancestorOrds(ROOT_ORD)).toEqual([]);
    expect(ancestorOrds('station:|slot:/Drivers')).toEqual([ROOT_ORD]);
    expect(ancestorOrds('station:|slot:/Services/UserService')).toEqual([ROOT_ORD, 'station:|slot:/Services']);
  });
});
