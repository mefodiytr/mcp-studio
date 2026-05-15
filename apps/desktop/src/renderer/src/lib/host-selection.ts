import type { HostBusSelection } from '@mcp-studio/plugin-api';

/**
 * **M6 C87** — host-bus-selection → UI string helpers shared between the
 * chat empty state's diagnostic-flow buttons and the command palette's
 * "Run diagnostic flow on …" entries.
 *
 * Two tiny functions in one module so the two consumers (chat empty state
 * + palette) share the exact same display rules — selection truncation,
 * fallback behaviour, parameter pre-fill format. Adding a third consumer
 * (e.g. M8's visual flow builder) just imports from here.
 */

/** Short UI label for a host selection. Prefers `displayName`, falls back to
 *  the trailing ord segment ("station:|slot:/Drivers/AHU1" → "AHU1"), then
 *  the raw ord as last resort. Long ords are truncated to keep the button /
 *  palette entry from blowing past its container. */
export function selectionLabel(selection: HostBusSelection): string {
  const raw = selection.displayName || ordTail(selection.ord) || selection.ord;
  return raw.length > 32 ? `${raw.slice(0, 31)}…` : raw;
}

/** Param-prefill value when launching a flow with a host selection in
 *  scope. Returns the display label (the operator-friendly string the
 *  flow's `equipment_query` / similar text param expects). Plain ord
 *  preselection is the m6-followup for plans that want a raw ord. */
export function preselectionForLaunch(selection: HostBusSelection): string {
  return selection.displayName || selection.ord;
}

/** Pull the trailing slot segment from an ORD without depending on
 *  niagara-specific ord parsing (the host lib doesn't import plugin
 *  internals). */
function ordTail(ord: string): string | null {
  // Niagara ORDs typically end with "|slot:/.../<leaf>" or similar. Take
  // anything after the last '/' or ':' as the leaf. Returns null on
  // strings without those separators (caller falls back).
  const lastSep = Math.max(ord.lastIndexOf('/'), ord.lastIndexOf(':'));
  if (lastSep < 0 || lastSep === ord.length - 1) return null;
  return ord.slice(lastSep + 1);
}
