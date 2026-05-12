import { Box, CalendarClock, Folder, FolderOpen, Gauge, LineChart, Network, Settings2, ToggleLeft, Variable } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { componentIcon } from './component-icon';

describe('componentIcon', () => {
  it('maps points to value-kind icons', () => {
    expect(componentIcon({ type: 'control:NumericPoint', isPoint: true })).toBe(Gauge);
    expect(componentIcon({ type: 'control:BooleanWritable', isPoint: true })).toBe(ToggleLeft);
    expect(componentIcon({ type: 'control:EnumPoint', isPoint: true })).toBe(Variable);
    expect(componentIcon({ type: 'baja:Whatever', isPoint: true })).toBe(Gauge); // unknown point kind
  });

  it('maps container families', () => {
    expect(componentIcon({ type: 'schedule:BooleanSchedule', isPoint: false })).toBe(CalendarClock);
    expect(componentIcon({ type: 'history:HistoryService', isPoint: false })).toBe(LineChart);
    expect(componentIcon({ type: 'modbusTcp:ModbusTcpNetwork', isPoint: false })).toBe(Network);
    expect(componentIcon({ type: 'baja:UserService', isPoint: false })).toBe(Settings2);
  });

  it('falls back to a folder (open/closed) for containers and unknowns, a box otherwise', () => {
    expect(componentIcon({ type: 'baja:Folder', isPoint: false, expanded: true })).toBe(FolderOpen);
    expect(componentIcon({ type: 'baja:Folder', isPoint: false, expanded: false })).toBe(Folder);
    expect(componentIcon({ type: '', isPoint: false })).toBe(Folder);
    expect(componentIcon({ type: 'weird:OpaqueThing', isPoint: false })).toBe(Box);
  });
});
