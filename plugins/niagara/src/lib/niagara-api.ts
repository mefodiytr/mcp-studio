/**
 * Thin, defensively-typed wrappers over the niagaramcp read tools, layered on
 * the host's `PluginContext` (whose IPC results are `unknown`). niagaramcp
 * returns each tool's JSON twice — as `result.structuredContent` and as a JSON
 * string in `result.content[0].text` — so {@link payload} prefers the former and
 * falls back to parsing the latter; every field is then read with a fallback.
 */
import type { PluginContext } from '@mcp-studio/plugin-api';

import { parseTsv, type BqlResult } from './bql';
import { fullOrd, ordLeaf, parentOrd } from './ord';

/** A node in the station's slot hierarchy, as returned by `listChildren`. */
export interface NiagaraNode {
  ord: string;
  /** Slot name. */
  name: string;
  /** Display name (falls back to `name`). */
  displayName: string;
  /** Niagara type spec, `module:TypeName` (e.g. `control:NumericPoint`). */
  type: string;
  /** A control point (a leaf — no children worth expanding). */
  isPoint: boolean;
  /** Present only when fetched with `depth > 1`. */
  children?: NiagaraNode[];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Extract a tool result's JSON object: `structuredContent` if present, else the
 *  parsed `content[0].text`, else `{}`. */
export function payload(result: unknown): Record<string, unknown> {
  const r = asObject(result);
  const structured = r['structuredContent'];
  if (structured && typeof structured === 'object') return structured as Record<string, unknown>;
  const text = textContent(result);
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      /* not JSON (e.g. a BQL TSV body) — the caller handles raw text itself */
    }
  }
  return {};
}

/** The first text content block's `text`, or `''`. */
export function textContent(result: unknown): string {
  const content = asObject(result)['content'];
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    const b = asObject(block);
    if (b['type'] === 'text' && typeof b['text'] === 'string') return b['text'];
  }
  return '';
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function bool(value: unknown): boolean {
  return value === true;
}
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function toNode(raw: unknown): NiagaraNode {
  const r = asObject(raw);
  const ord = str(r['ord']);
  const name = str(r['name']) || ordLeaf(ord);
  const children = Array.isArray(r['children']) ? r['children'].map(toNode) : undefined;
  return { ord, name, displayName: str(r['displayName']) || name, type: str(r['type']), isPoint: bool(r['isPoint']), children };
}

/** List the children of `ord` (`depth` 1–5; `depth > 1` nests them). */
export async function listChildren(ctx: PluginContext, ord: string, depth = 1): Promise<NiagaraNode[]> {
  const result = await ctx.callTool('listChildren', depth > 1 ? { ord, depth } : { ord });
  const children = payload(result)['children'];
  return Array.isArray(children) ? children.map(toNode) : [];
}

/** Identity + child count of a single component (`inspectComponent` is *not* a
 *  slot dump — use {@link getSlots} for that). */
export interface ComponentInfo {
  ord: string;
  name: string;
  displayName: string;
  type: string;
  /** Parent component ORD; `null` at the station root. */
  parentOrd: string | null;
  childCount: number;
}

export async function inspectComponent(ctx: PluginContext, ord: string): Promise<ComponentInfo> {
  const p = payload(await ctx.callTool('inspectComponent', { ord }));
  const resolvedOrd = str(p['ord']) || ord;
  const name = str(p['name']) || ordLeaf(resolvedOrd);
  const rawParent = str(p['parentOrd']);
  return {
    ord: resolvedOrd,
    name,
    displayName: str(p['displayName']) || name,
    type: str(p['type']),
    parentOrd: rawParent ? fullOrd(rawParent) : parentOrd(resolvedOrd),
    childCount: num(p['childCount']),
  };
}

/** One property slot of a component (`getSlots`). */
export interface SlotRow {
  name: string;
  /** Niagara slot type, e.g. `baja:Boolean`, `baja:RelTime`. */
  type: string;
  /** Current value as the station stringifies it (may be display-localized,
   *  e.g. `"поистине"` for `true`). */
  value: string;
  /** Selected facets (units, precision, …) when the server includes them. */
  facets?: Record<string, unknown>;
}

/** Run a BQL query (`query` must already be the `<ord>|bql:<SELECT…>` form —
 *  see {@link import('./bql').buildBqlQuery}); `limit` caps the row count
 *  (1–1000). Returns the parsed TSV plus the raw body. */
export async function bqlQuery(
  ctx: PluginContext,
  query: string,
  limit: number,
): Promise<BqlResult & { raw: string }> {
  const raw = textContent(await ctx.callTool('bqlQuery', { query, limit }));
  return { ...parseTsv(raw), raw };
}

/** A `removeComponent` dry-run preview — what would happen if the operator
 *  hit Apply. Used by the tree's "Remove…" dialog (C56) so the operator sees
 *  inbound-link refusals etc. *before* the op enters the pending queue. */
export interface RemovalPreview {
  ord: string;
  /** True when niagaramcp would refuse this removal (typically: inbound links
   *  exist and `force` wasn't set). When refused, `message` carries the reason. */
  refused: boolean;
  /** Free-text reason / summary for display. */
  message: string;
  /** Inbound link ords that block the removal, if niagaramcp lists them. */
  inboundLinks: string[];
  /** The raw structuredContent of the dry-run response, for "show raw" in the UI. */
  raw: unknown;
}

/** Fetch a `removeComponent(dryRun:true)` preview without queueing the op.
 *  Throws on transport / `isError` per the M2 unwrap convention; the resulting
 *  preview is *not* persisted to the audit trail (this is a read-style call —
 *  no `{write:true}` opt). The C56 remove dialog renders this then either
 *  enqueues a `RemoveComponent` op or asks for `force` and re-previews. */
export async function dryRunRemove(
  ctx: PluginContext,
  ord: string,
  force = false,
): Promise<RemovalPreview> {
  const result = await ctx.callTool('removeComponent', { ord, dryRun: true, ...(force ? { force: true } : {}) });
  const p = payload(result);
  const refused = bool(p['refused']) || (p['wouldRemove'] === false);
  const inbound = Array.isArray(p['inboundLinks']) ? p['inboundLinks'].filter((x): x is string => typeof x === 'string') : [];
  const message = str(p['message']) || textContent(result) || (refused ? 'Removal refused by the station.' : 'Would remove.');
  return { ord: str(p['ord']) || ord, refused, message, inboundLinks: inbound, raw: p };
}

export async function getSlots(ctx: PluginContext, ord: string): Promise<SlotRow[]> {
  const slots = payload(await ctx.callTool('getSlots', { ord }))['slots'];
  if (!Array.isArray(slots)) return [];
  return slots.map((raw) => {
    const r = asObject(raw);
    const facets = r['facets'];
    return {
      name: str(r['name']),
      type: str(r['type']),
      value: str(r['value']),
      facets: facets && typeof facets === 'object' && !Array.isArray(facets) ? (facets as Record<string, unknown>) : undefined,
    };
  });
}
