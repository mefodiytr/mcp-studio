import { describe, expect, it } from 'vitest';

import { preselectionForLaunch, selectionLabel } from './host-selection';

describe('selectionLabel', () => {
  it('prefers displayName when present', () => {
    expect(selectionLabel({ ord: 'station:|slot:/Drivers/AHU1', displayName: 'AHU-1' })).toBe('AHU-1');
  });

  it('falls back to the trailing slot segment when displayName is absent', () => {
    expect(selectionLabel({ ord: 'station:|slot:/Drivers/AHU1' })).toBe('AHU1');
  });

  it('falls back to the trailing segment after a colon (Niagara station ords use ":/" + path)', () => {
    expect(selectionLabel({ ord: 'station:Bacnet' })).toBe('Bacnet');
  });

  it('returns the raw ord when neither displayName nor a usable tail is available', () => {
    expect(selectionLabel({ ord: 'unknownshape' })).toBe('unknownshape');
  });

  it('truncates labels longer than 32 chars (button / palette overflow guard)', () => {
    const long = 'A'.repeat(50);
    const out = selectionLabel({ ord: 'x', displayName: long });
    expect(out).toHaveLength(32);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('preselectionForLaunch', () => {
  it('returns the displayName when present (operator-friendly param value)', () => {
    expect(preselectionForLaunch({ ord: 'station:|slot:/Drivers/AHU1', displayName: 'AHU-1' })).toBe('AHU-1');
  });

  it('falls back to the raw ord when displayName is absent', () => {
    expect(preselectionForLaunch({ ord: 'station:|slot:/Drivers/AHU1' })).toBe(
      'station:|slot:/Drivers/AHU1',
    );
  });
});
