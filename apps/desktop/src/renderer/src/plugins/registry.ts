import { niagaraPlugin } from '@mcp-studio/niagara';
import { matchesServerName, type Plugin } from '@mcp-studio/plugin-api';

/**
 * The in-box plugins, statically imported (build-time). A plugin's *view bodies*
 * are lazy chunks — the plugin's entry exports just the manifest + view metadata
 * with `lazy()`-wrapped `component`s — so an unused plugin's heavy deps stay out
 * of the initial bundle.
 */
export const IN_BOX_PLUGINS: Plugin[] = [niagaraPlugin];

/** The plugin (if any) that specializes a server, matched by `serverInfo.name`. */
export function pickPlugin(
  serverInfo: { name: string } | null | undefined,
  plugins: Plugin[] = IN_BOX_PLUGINS,
): Plugin | undefined {
  return plugins.find((p) => matchesServerName(p.manifest, serverInfo?.name));
}
