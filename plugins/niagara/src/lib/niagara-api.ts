/**
 * Thin, defensively-typed wrappers over the niagaramcp read tools, layered on
 * the host's `PluginContext` (whose IPC results are `unknown`). niagaramcp
 * returns each tool's JSON twice — as `result.structuredContent` and as a JSON
 * string in `result.content[0].text` — so {@link payload} prefers the former and
 * falls back to parsing the latter; every field is then read with a fallback.
 */
import type { PluginContext } from '@mcp-studio/plugin-api';

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
