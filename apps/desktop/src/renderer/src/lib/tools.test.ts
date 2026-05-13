import { describe, expect, it } from 'vitest';

import { isWriteCall } from './tools';

describe('isWriteCall', () => {
  it('is true when destructiveHint is true', () => {
    expect(isWriteCall({ destructiveHint: true })).toBe(true);
    expect(isWriteCall({ destructiveHint: true, readOnlyHint: true })).toBe(true);
  });

  it('is true when readOnlyHint is explicitly false', () => {
    expect(isWriteCall({ readOnlyHint: false })).toBe(true);
  });

  it('is false for read-only / unknown / absent annotations', () => {
    expect(isWriteCall({ readOnlyHint: true })).toBe(false);
    expect(isWriteCall({})).toBe(false); // unknown — don't claim it's a write
    expect(isWriteCall(undefined)).toBe(false);
  });
});
