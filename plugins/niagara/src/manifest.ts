import { pluginManifestSchema, type PluginManifest } from '@mcp-studio/plugin-api';

import { NIAGARA_TOOL_ANNOTATION_OVERRIDES } from './tool-annotations';

/**
 * Detection. niagaramcp reports a `serverInfo.name` beginning with "niagara"
 * (e.g. "niagaramcp"). Broad-but-anchored until the exact name is pinned from a
 * live `tools/list` — narrow it then if there's reason to. A non-matching server
 * keeps the generic Tools/Resources/Prompts/Raw UI.
 *
 * **M5 C75** — `toolAnnotationOverrides` lives on the manifest (pure data) so
 * the main-process annotation registry can resolve them without a renderer
 * round-trip. The renderer's `applyAnnotationOverrides` reads from the same
 * field — single source of truth, no drift between badges and the AI-write
 * safety gate. The static table itself stays in `tool-annotations.ts` for
 * readability; the manifest just references it.
 */
export const NIAGARA_MANIFEST: PluginManifest = pluginManifestSchema.parse({
  name: 'niagara',
  version: '0.1.0',
  title: 'Niagara station',
  matches: /^niagara/i,
  toolAnnotationOverrides: NIAGARA_TOOL_ANNOTATION_OVERRIDES,
});
