import type { PluginContext } from '@mcp-studio/plugin-api';

import type { ConnectionSummary } from '@shared/domain/connection';

import { fetchPrompts, getPrompt } from './prompts';
import { sendRawRequest } from './raw';
import { fetchResources, fetchResourceTemplates, readResource } from './resources';
import { callTool, fetchTools } from './tools';

/**
 * Build the {@link PluginContext} the host hands a plugin view — thin wrappers
 * over the existing IPC channels, bound to one connection. `setCwd` publishes
 * the active view's "cwd" into the templating context (the `{{cwd}}` token) —
 * a no-op until wired in C37.
 */
export function buildPluginContext(
  connection: ConnectionSummary,
  setCwd: (path: string | undefined) => void = () => undefined,
): PluginContext {
  const id = connection.connectionId;
  return {
    connection: {
      connectionId: connection.connectionId,
      profileId: connection.profileId,
      serverInfo: connection.serverInfo,
      status: connection.status,
    },
    callTool: (name, args) => callTool(id, name, args),
    listTools: () => fetchTools(id),
    listResources: () => fetchResources(id),
    listResourceTemplates: () => fetchResourceTemplates(id),
    readResource: (uri) => readResource(id, uri),
    listPrompts: () => fetchPrompts(id),
    getPrompt: (name, args) => getPrompt(id, name, args),
    rawRequest: (method, params) => sendRawRequest(id, method, params),
    setCwd,
  };
}
