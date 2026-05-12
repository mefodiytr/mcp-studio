import { describe, expect, it } from 'vitest';

import type { NiagaraNode } from './niagara-api';
import { sortNodes } from './sort';

const node = (over: Partial<NiagaraNode>): NiagaraNode => ({
  ord: 'station:|slot:/x',
  name: 'x',
  displayName: 'x',
  type: 'baja:Component',
  isPoint: false,
  ...over,
});

const names = (ns: NiagaraNode[]): string[] => ns.map((n) => n.displayName);

describe('sortNodes', () => {
  const nodes = [
    node({ displayName: 'Beta', type: 'control:NumericPoint', ord: 'station:|slot:/Logic/Beta', isPoint: true }),
    node({ displayName: 'alpha', type: 'baja:Folder', ord: 'station:|slot:/Drivers' }),
    node({ displayName: 'Gamma2', type: 'baja:Folder', ord: 'station:|slot:/Zzz' }),
    node({ displayName: 'Gamma10', type: 'control:BooleanPoint', ord: 'station:|slot:/Gamma10', isPoint: true }),
  ];

  it('sorts by display name, case-insensitively and numeric-aware, ascending', () => {
    expect(names(sortNodes(nodes, 'name', 'asc'))).toEqual(['alpha', 'Beta', 'Gamma2', 'Gamma10']);
  });

  it('reverses on descending', () => {
    expect(names(sortNodes(nodes, 'name', 'desc'))).toEqual(['Gamma10', 'Gamma2', 'Beta', 'alpha']);
  });

  it('sorts by type (stable on ties) and by ORD path — points are not separated from folders', () => {
    expect(names(sortNodes(nodes, 'type', 'asc'))).toEqual(['alpha', 'Gamma2', 'Gamma10', 'Beta']);
    expect(names(sortNodes(nodes, 'ord', 'asc'))).toEqual(['alpha', 'Gamma10', 'Beta', 'Gamma2']);
  });

  it('does not mutate its input', () => {
    const input = [...nodes];
    sortNodes(input, 'name', 'desc');
    expect(input).toEqual(nodes);
  });
});
