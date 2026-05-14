import type { PluginManifest, ToolAnnotations } from '@mcp-studio/plugin-api';
import { matchesServerName, mergeToolAnnotations } from '@mcp-studio/plugin-api';
import { NIAGARA_MANIFEST } from '@mcp-studio/niagara/manifest';

/**
 * Main-process plugin manifest registry. Imports manifests directly — they're
 * pure data (zod-validated; no React, no Zustand, no renderer-side runtime) so
 * the import graph stays main-bundleable. The `electron.vite.config.ts` adds
 * `@mcp-studio/niagara` + `@mcp-studio/plugin-api` to the `exclude` list of
 * `externalizeDepsPlugin` so these get bundled into main's CJS image (same
 * treatment as `@mcp-studio/mcp-client`).
 *
 * **What main uses this for (M5 C75):** `pickManifest(serverName)` resolves
 * the manifest the active plugin would use; `getEffectiveAnnotations(manifest,
 * toolName, base)` returns the post-override annotations the safety predicate
 * consults. The renderer's `applyAnnotationOverrides` reads from the SAME
 * manifest data — single source of truth, no drift, no renderer round-trip.
 */

/** Statically-known plugin manifests, in priority order (first match wins).
 *  M5 ships one entry; second-plugin-in-box additions land here. */
const IN_BOX_MANIFESTS: PluginManifest[] = [NIAGARA_MANIFEST];

/** The manifest whose `matches` regex matches the server's `serverInfo.name`,
 *  or `undefined` for a non-specialized connection. */
export function pickManifest(serverName: string | null | undefined): PluginManifest | undefined {
  return IN_BOX_MANIFESTS.find((m) => matchesServerName(m, serverName));
}

/** Resolve effective annotations for one tool on one connection:
 *  `base` (the server's `tools/list` annotations) merged with the picked
 *  plugin's manifest override for that tool, if any. */
export function getEffectiveAnnotations(
  manifest: PluginManifest | undefined,
  toolName: string,
  base: ToolAnnotations | undefined,
): ToolAnnotations | undefined {
  const override = manifest?.toolAnnotationOverrides?.[toolName];
  return mergeToolAnnotations(base, override);
}

/** Mirrors the renderer-side `isWriteCall` (see `lib/tools.ts`). True when
 *  the effective annotations say "this mutates state" — either explicit
 *  `destructiveHint:true` OR explicit `readOnlyHint:false`. The default
 *  (both undefined) is **not** a write — main refuses to claim ambiguity is
 *  a write, matching the renderer's M3 conservative stance. */
export function isWriteCall(annotations: ToolAnnotations | undefined): boolean {
  if (!annotations) return false;
  return annotations.destructiveHint === true || annotations.readOnlyHint === false;
}
