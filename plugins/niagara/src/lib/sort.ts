import type { NiagaraNode } from './niagara-api';
import { slotPath } from './ord';

export type SortKey = 'name' | 'type' | 'ord';
export type SortDir = 'asc' | 'desc';

/** Sort `nodes` by the chosen column. `name` uses the display name, `ord` the
 *  slot path; folders are *not* hoisted above points — the column rules alone.
 *  Locale-aware, numeric-segment-aware, case-insensitive. */
export function sortNodes(nodes: readonly NiagaraNode[], key: SortKey, dir: SortDir): NiagaraNode[] {
  const pick = (n: NiagaraNode): string =>
    key === 'name' ? n.displayName : key === 'type' ? n.type : slotPath(n.ord);
  const sign = dir === 'asc' ? 1 : -1;
  return [...nodes].sort(
    (a, b) => sign * pick(a).localeCompare(pick(b), undefined, { numeric: true, sensitivity: 'base' }),
  );
}
