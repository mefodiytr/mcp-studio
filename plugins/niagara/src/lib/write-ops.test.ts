import { describe as descBlock, expect, it } from 'vitest';

import { bsimpleKind, describe, isReversible, parseBSimpleValue, toToolCall, type WriteOp } from './write-ops';

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

descBlock('bsimpleKind', () => {
  it('maps the BSimple Property slot types to an editable kind', () => {
    expect(bsimpleKind('baja:String')).toBe('string');
    expect(bsimpleKind('baja:Boolean')).toBe('boolean');
    expect(bsimpleKind('baja:Integer')).toBe('integer');
    expect(bsimpleKind('baja:Long')).toBe('integer');
    expect(bsimpleKind('baja:Double')).toBe('number');
    expect(bsimpleKind('baja:Float')).toBe('number');
  });
  it('returns null for complex / non-BSimple slot types (read-only in M3)', () => {
    expect(bsimpleKind('baja:RelTime')).toBeNull();
    expect(bsimpleKind('baja:StatusNumeric')).toBeNull();
    expect(bsimpleKind('history:NumericIntervalExt')).toBeNull();
    expect(bsimpleKind('')).toBeNull();
  });
});

descBlock('parseBSimpleValue', () => {
  it('strings come through as-is (no trim — strings are values, not commands)', () => {
    expect(parseBSimpleValue('string', '  hello  ')).toBe('  hello  ');
    expect(parseBSimpleValue('string', '')).toBe('');
  });
  it('integers parse from a digit-only string; otherwise undefined', () => {
    expect(parseBSimpleValue('integer', '42')).toBe(42);
    expect(parseBSimpleValue('integer', '-7')).toBe(-7);
    expect(parseBSimpleValue('integer', '3.14')).toBeUndefined();
    expect(parseBSimpleValue('integer', 'abc')).toBeUndefined();
  });
  it('numbers accept ints and floats; reject NaN', () => {
    expect(parseBSimpleValue('number', '3.14')).toBe(3.14);
    expect(parseBSimpleValue('number', '0')).toBe(0);
    expect(parseBSimpleValue('number', 'nan')).toBeUndefined();
  });
  it('booleans parse true/false plus niagaramcp\'s localized поистине/ложь', () => {
    expect(parseBSimpleValue('boolean', 'true')).toBe(true);
    expect(parseBSimpleValue('boolean', 'TRUE')).toBe(true);
    expect(parseBSimpleValue('boolean', 'поистине')).toBe(true);
    expect(parseBSimpleValue('boolean', '1')).toBe(true);
    expect(parseBSimpleValue('boolean', 'false')).toBe(false);
    expect(parseBSimpleValue('boolean', 'ложь')).toBe(false);
    expect(parseBSimpleValue('boolean', '0')).toBe(false);
    expect(parseBSimpleValue('boolean', 'wat')).toBeUndefined();
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
