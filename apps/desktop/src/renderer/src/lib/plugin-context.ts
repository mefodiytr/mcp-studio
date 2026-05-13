import type { PluginContext } from '@mcp-studio/plugin-api';

import type { ConnectionSummary } from '@shared/domain/connection';
import type { ToolCallError } from '@shared/domain/tool-result';

import { fetchPrompts, getPrompt } from './prompts';
import { sendRawRequest } from './raw';
import { fetchResources, fetchResourceTemplates, readResource } from './resources';
import { callTool, fetchTools } from './tools';

/** Unwrap the host's `ToolCallOutcome` ({ result, error }) into the bare
 *  `CallToolResult` a plugin expects — throwing on a transport/protocol error
 *  (so a plugin's `useQuery` surfaces it) and on a tool-reported `isError`
 *  result (its text content becomes the message). */
function unwrapToolCall(outcome: { result: unknown; error: ToolCallError | string | null }): unknown {
  if (outcome.error != null) {
    throw new Error(typeof outcome.error === 'string' ? outcome.error : outcome.error.message);
  }
  const result = outcome.result;
  if (result && typeof result === 'object' && (result as { isError?: unknown }).isError === true) {
    const content = (result as { content?: unknown }).content;
    const text = Array.isArray(content)
      ? content.find((b): b is { text: string } => !!b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string')?.text
      : undefined;
    throw new Error(text ?? 'the tool reported an error');
  }
  return result;
}

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
    callTool: async (name, args, opts) => unwrapToolCall(await callTool(id, name, args, opts)),
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
