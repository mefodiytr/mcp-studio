/**
 * Helpers for Niagara ORDs of the `station:|slot:/A/B/C` shape — the form the
 * niagaramcp read tools (`listChildren`, `inspectComponent`, `getSlots`, …)
 * speak. We only reason about the `slot:` path (the segment after the last
 * `|slot:`); query strings, history queries etc. are out of scope here.
 */

const SLOT_MARKER = '|slot:';
const SLOT_PREFIX = `station:${SLOT_MARKER}`;

/** The station root ORD. */
export const ROOT_ORD = `${SLOT_PREFIX}/`;

/** The `/A/B/C` slot path of an ORD (always leading `/`, no trailing `/` except
 *  for the root which is `/`). */
export function slotPath(ord: string): string {
  const i = ord.lastIndexOf(SLOT_MARKER);
  let path: string;
  if (i >= 0) path = ord.slice(i + SLOT_MARKER.length);
  else if (ord.startsWith('slot:')) path = ord.slice('slot:'.length);
  else path = ord;
  if (!path.startsWith('/')) path = `/${path}`;
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Coerce a possibly-bare slot ORD (`slot:/A`, `/A`, `station:|slot:/A`) to the
 *  full `station:|slot:/A` form. (niagaramcp's `inspectComponent.parentOrd`
 *  comes back as a bare `slot:/…`, while `listChildren` ORDs are full.) */
export function fullOrd(ord: string): string {
  if (ord.includes(SLOT_MARKER)) return ord;
  if (ord.startsWith('slot:')) return `station:|${ord}`;
  if (ord.startsWith('/')) return `${SLOT_PREFIX}${ord}`;
  return ord;
}

/** The ORD's last path segment (the component's slot name); `'/'` for the root. */
export function ordLeaf(ord: string): string {
  const path = slotPath(ord);
  return path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1);
}

/** The parent component's ORD; `null` for the root. */
export function parentOrd(ord: string): string | null {
  const path = slotPath(ord);
  if (path === '/') return null;
  const cut = path.lastIndexOf('/');
  return `${SLOT_PREFIX}${cut <= 0 ? '/' : path.slice(0, cut)}`;
}

/** Breadcrumb trail from the root down to `ord` inclusive: `[{ name, ord }, …]`
 *  with `name === '/'` for the root entry. */
export function ordTrail(ord: string): { name: string; ord: string }[] {
  const trail = [{ name: '/', ord: ROOT_ORD }];
  const path = slotPath(ord);
  if (path === '/') return trail;
  let acc = '';
  for (const part of path.split('/').filter(Boolean)) {
    acc += `/${part}`;
    trail.push({ name: part, ord: `${SLOT_PREFIX}${acc}` });
  }
  return trail;
}

/** Every ancestor ORD of `ord` (root … parent), excluding `ord` itself. */
export function ancestorOrds(ord: string): string[] {
  return ordTrail(ord)
    .slice(0, -1)
    .map((t) => t.ord);
}
