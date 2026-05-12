import type { PluginContext } from '@mcp-studio/plugin-api';

/**
 * Placeholder station explorer. The real lazy/virtualised slot-hierarchy tree
 * (with breadcrumbs, property sheet, etc.) lands in C40+. For now this proves the
 * plugin-view wiring end to end: the host mounts it with a live `PluginContext`
 * bound to the active Niagara connection.
 */
export function ExplorerView({ ctx }: { ctx: PluginContext }) {
  const serverName = ctx.connection.serverInfo?.name ?? ctx.connection.connectionId;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <p className="text-sm font-medium text-foreground">Niagara station</p>
      <p className="text-xs">
        Connected to <span className="font-mono">{serverName}</span>
      </p>
      <p className="text-xs">The station explorer arrives in a later build.</p>
    </div>
  );
}
