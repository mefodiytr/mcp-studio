import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHostBus } from './host-bus';

beforeEach(() => {
  // Reset both channels between tests — Zustand state is module-global.
  useHostBus.setState({ pendingOrdNav: null, selectedOrd: null });
});

describe('useHostBus — ord navigation channel (M5 C79)', () => {
  it('publishOrdNav → peekOrdNav returns the same value without clearing', () => {
    useHostBus.getState().publishOrdNav('station:|slot:/Drivers/AHU1');
    expect(useHostBus.getState().peekOrdNav()).toEqual({ ord: 'station:|slot:/Drivers/AHU1' });
    // Peek is non-destructive — second peek still returns the value.
    expect(useHostBus.getState().peekOrdNav()).toEqual({ ord: 'station:|slot:/Drivers/AHU1' });
  });

  it('consumeOrdNav returns the value AND clears it (single-fire)', () => {
    useHostBus.getState().publishOrdNav('station:|slot:/X');
    const first = useHostBus.getState().consumeOrdNav();
    expect(first).toEqual({ ord: 'station:|slot:/X' });
    expect(useHostBus.getState().consumeOrdNav()).toBeNull();
    expect(useHostBus.getState().peekOrdNav()).toBeNull();
  });
});

describe('useHostBus — selection channel (M6 C87)', () => {
  it('publishSelectedOrd sets the selection; peekSelectedOrd reads it without clearing', () => {
    useHostBus.getState().publishSelectedOrd({ ord: 'station:|slot:/Drivers/AHU1', displayName: 'AHU-1' });
    expect(useHostBus.getState().peekSelectedOrd()).toEqual({
      ord: 'station:|slot:/Drivers/AHU1',
      displayName: 'AHU-1',
    });
    // Peek is pure — repeated reads return the same value.
    expect(useHostBus.getState().peekSelectedOrd()).toEqual({
      ord: 'station:|slot:/Drivers/AHU1',
      displayName: 'AHU-1',
    });
  });

  it('publishSelectedOrd(null) clears the selection', () => {
    useHostBus.getState().publishSelectedOrd({ ord: 'station:|slot:/X' });
    useHostBus.getState().publishSelectedOrd(null);
    expect(useHostBus.getState().peekSelectedOrd()).toBeNull();
  });

  it('publishSelectedOrd is short-circuited when the value is unchanged (no re-render for repeated publishes)', () => {
    // The selection publisher fires on every render of the Niagara
    // Explorer's selected/known useEffect; if the value hasn't changed
    // structurally, the bus must NOT update state — otherwise every chat
    // empty-state render would cycle on the upstream subscription.
    const listener = vi.fn();
    const unsubscribe = useHostBus.subscribe(listener);
    useHostBus.getState().publishSelectedOrd({ ord: 'a', displayName: 'A' });
    useHostBus.getState().publishSelectedOrd({ ord: 'a', displayName: 'A' });
    useHostBus.getState().publishSelectedOrd({ ord: 'a', displayName: 'A' });
    expect(listener).toHaveBeenCalledTimes(1);

    // Changing the displayName (same ord) does fire — it's a real change.
    useHostBus.getState().publishSelectedOrd({ ord: 'a', displayName: 'A2' });
    expect(listener).toHaveBeenCalledTimes(2);

    // Changing the ord fires.
    useHostBus.getState().publishSelectedOrd({ ord: 'b', displayName: 'A2' });
    expect(listener).toHaveBeenCalledTimes(3);

    // Going to null fires once; staying null does not.
    useHostBus.getState().publishSelectedOrd(null);
    expect(listener).toHaveBeenCalledTimes(4);
    useHostBus.getState().publishSelectedOrd(null);
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
  });

  it('selection channel and ord-nav channel are independent (one does not clear the other)', () => {
    useHostBus.getState().publishOrdNav('station:|slot:/X');
    useHostBus.getState().publishSelectedOrd({ ord: 'station:|slot:/Y', displayName: 'Y' });
    // Both alive.
    expect(useHostBus.getState().peekOrdNav()).toEqual({ ord: 'station:|slot:/X' });
    expect(useHostBus.getState().peekSelectedOrd()).toEqual({
      ord: 'station:|slot:/Y',
      displayName: 'Y',
    });
    // Consuming ord-nav doesn't touch selection.
    useHostBus.getState().consumeOrdNav();
    expect(useHostBus.getState().peekSelectedOrd()).toEqual({
      ord: 'station:|slot:/Y',
      displayName: 'Y',
    });
  });
});
