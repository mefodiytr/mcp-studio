import { pluginManifestSchema, type PluginManifest } from '@mcp-studio/plugin-api';

/**
 * Detection. niagaramcp reports a `serverInfo.name` beginning with "niagara"
 * (e.g. "niagaramcp"). Broad-but-anchored until the exact name is pinned from a
 * live `tools/list` — narrow it then if there's reason to. A non-matching server
 * keeps the generic Tools/Resources/Prompts/Raw UI.
 */
export const NIAGARA_MANIFEST: PluginManifest = pluginManifestSchema.parse({
  name: 'niagara',
  version: '0.1.0',
  title: 'Niagara station',
  matches: /^niagara/i,
});
