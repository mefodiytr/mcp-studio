import { describe as descBlock, expect, it } from 'vitest';

import { describe, isReversible, toToolCall, type WriteOp } from './write-ops';

const ops: Record<WriteOp['type'], WriteOp> = {
  setSlot: { type: 'setSlot', ord: 'station:|slot:/Logic/Reg1', slotName: 'out', oldValue: 1, newValue: 42 },
  clearSlot: { type: 'clearSlot', ord: 'station:|slot:/Logic/Reg1', slotName: 'out', oldValue: 42 },
  createComponent: {
    type: 'createComponent',
    parentOrd: 'station:|slot:/Drivers',
    componentType: 'driver:DriverContainer',
    name: 'New',
    nameStrategy: 'suffix',
  },
  removeComponent: { type: 'removeComponent', ord: 'station:|slot:/Drivers/Old', force: true },
  addExtension: {
    type: 'addExtension',
    parentOrd: 'station:|slot:/Logic/Sensor1',
    extensionType: 'history:NumericIntervalExt',
    name: 'History',
  },
  linkSlots: {
    type: 'linkSlots',
    sourceOrd: 'station:|slot:/Logic/A',
    sourceSlot: 'out',
    sinkOrd: 'station:|slot:/Logic/B',
    sinkSlot: 'in',
    converterType: 'baja:NumericToBoolean',
  },
  unlinkSlots: { type: 'unlinkSlots', sinkOrd: 'station:|slot:/Logic/B', linkName: 'In16' },
};

descBlock('isReversible', () => {
  it('flags the reversible ops (the inverse can be derived from the recorded data)', () => {
    expect(isReversible(ops.setSlot)).toBe(true);
    expect(isReversible(ops.clearSlot)).toBe(true);
    expect(isReversible(ops.createComponent)).toBe(true);
    expect(isReversible(ops.linkSlots)).toBe(true);
  });
  it('flags the irreversible ops (data lost / not recapturable)', () => {
    expect(isReversible(ops.removeComponent)).toBe(false);
    expect(isReversible(ops.unlinkSlots)).toBe(false);
    expect(isReversible(ops.addExtension)).toBe(false);
  });
});

descBlock('describe', () => {
  it('renders a short English label per op kind', () => {
    expect(describe(ops.setSlot)).toBe('Set out on station:|slot:/Logic/Reg1 to 42');
    expect(
      describe({ type: 'setSlot', ord: 'station:|slot:/Logic/Reg1', slotName: 'out', oldValue: 1, newValue: 'hello' }),
    ).toBe('Set out on station:|slot:/Logic/Reg1 to "hello"');
    expect(describe(ops.clearSlot)).toBe('Reset out on station:|slot:/Logic/Reg1 to its default');
    expect(describe(ops.createComponent)).toBe('Create driver:DriverContainer "New" under station:|slot:/Drivers');
    expect(describe(ops.removeComponent)).toBe('Remove station:|slot:/Drivers/Old (force)');
    expect(describe({ type: 'removeComponent', ord: 'station:|slot:/Drivers/Old', force: false })).toBe(
      'Remove station:|slot:/Drivers/Old',
    );
    expect(describe(ops.addExtension)).toBe('Add extension history:NumericIntervalExt "History" to station:|slot:/Logic/Sensor1');
    expect(describe(ops.linkSlots)).toBe(
      'Link station:|slot:/Logic/A.out → station:|slot:/Logic/B.in via baja:NumericToBoolean',
    );
    expect(
      describe({
        type: 'linkSlots',
        sourceOrd: 'station:|slot:/Logic/A',
        sourceSlot: 'out',
        sinkOrd: 'station:|slot:/Logic/B',
        sinkSlot: 'in',
      }),
    ).toBe('Link station:|slot:/Logic/A.out → station:|slot:/Logic/B.in');
    expect(describe(ops.unlinkSlots)).toBe('Unlink In16 on station:|slot:/Logic/B');
  });
});

descBlock('toToolCall', () => {
  it('produces the {name, arguments} pair niagaramcp tools/list advertises', () => {
    expect(toToolCall(ops.setSlot)).toEqual({
      name: 'setSlot',
      arguments: { ord: 'station:|slot:/Logic/Reg1', slotName: 'out', value: 42 },
    });
    expect(toToolCall(ops.clearSlot)).toEqual({
      name: 'clearSlot',
      arguments: { ord: 'station:|slot:/Logic/Reg1', slotName: 'out' },
    });
    expect(toToolCall(ops.createComponent)).toEqual({
      name: 'createComponent',
      arguments: { parentOrd: 'station:|slot:/Drivers', type: 'driver:DriverContainer', name: 'New', nameStrategy: 'suffix' },
    });
    // optional fields omitted when not set
    expect(
      toToolCall({ type: 'createComponent', parentOrd: 'station:|slot:/Drivers', componentType: 'driver:DriverContainer', name: 'New' }),
    ).toEqual({
      name: 'createComponent',
      arguments: { parentOrd: 'station:|slot:/Drivers', type: 'driver:DriverContainer', name: 'New' },
    });
    expect(toToolCall(ops.removeComponent)).toEqual({
      name: 'removeComponent',
      arguments: { ord: 'station:|slot:/Drivers/Old', force: true },
    });
    expect(toToolCall({ type: 'removeComponent', ord: 'station:|slot:/Drivers/Old' })).toEqual({
      name: 'removeComponent',
      arguments: { ord: 'station:|slot:/Drivers/Old' },
    });
    expect(toToolCall(ops.linkSlots).arguments).toMatchObject({
      sourceOrd: 'station:|slot:/Logic/A',
      sourceSlot: 'out',
      sinkOrd: 'station:|slot:/Logic/B',
      sinkSlot: 'in',
      converterType: 'baja:NumericToBoolean',
    });
    expect(toToolCall(ops.unlinkSlots)).toEqual({
      name: 'unlinkSlots',
      arguments: { sinkOrd: 'station:|slot:/Logic/B', linkName: 'In16' },
    });
  });
});
