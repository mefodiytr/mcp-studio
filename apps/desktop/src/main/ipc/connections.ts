import type { ConnectionManager } from '../connections/connection-manager';
import { handle } from './index';

/** Wire the `connections:*` IPC channels to the connection manager. Connect /
 *  reconnect / listTools errors (handshake failures, unknown ids,
 *  ProfileNotFoundError) propagate to the renderer's `invoke` rejection. */
export function registerConnectionHandlers(manager: ConnectionManager): void {
  handle('connections:list', () => manager.list());
  handle('connections:connect', ({ profileId }) => manager.connect(profileId));
  handle('connections:reconnect', ({ connectionId }) => manager.reconnect(connectionId));
  handle('connections:disconnect', async ({ connectionId }) => {
    await manager.disconnect(connectionId);
    return { connectionId };
  });
  handle('connections:tools', async ({ connectionId }) => ({
    tools: await manager.listTools(connectionId),
  }));
  handle('connections:call', ({ connectionId, toolName, args }) => manager.callTool(connectionId, toolName, args));
  handle('connections:raw', ({ connectionId, method, params }) => manager.rawRequest(connectionId, method, params));
}
