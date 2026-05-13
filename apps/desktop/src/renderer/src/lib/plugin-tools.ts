import { mergeToolAnnotations, type Plugin } from '@mcp-studio/plugin-api';

import type { ToolDescriptor } from '@shared/domain/connection';

/**
 * Apply a plugin's per-tool annotation override to a `ToolDescriptor` — returns
 * the tool unchanged when no override applies; otherwise a shallow clone whose
 * `annotations` are the result of {@link mergeToolAnnotations}. Map a tool list
 * through this **once** (in `ToolsCatalog`) so the badges, the annotation
 * filters, and the destructive-confirm gate in `ToolInvocationDialog` all see
 * the same effective annotations — there's only one resolution point.
 */
export function applyAnnotationOverrides(tool: ToolDescriptor, plugin: Plugin | undefined): ToolDescriptor {
  const override = plugin?.toolAnnotationOverrides?.[tool.name];
  if (!override) return tool;
  // The host's `ToolDescriptor.annotations` is a passthrough'd schema (wider
  // type with an index signature); plugin-api's `ToolAnnotations` is the
  // structural subset. Cast the merged result back into the wider host shape.
  const merged = mergeToolAnnotations(tool.annotations, override) as ToolDescriptor['annotations'];
  return { ...tool, annotations: merged };
}
