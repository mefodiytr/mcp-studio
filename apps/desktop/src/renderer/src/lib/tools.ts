import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ToolDescriptor } from '@shared/domain/connection';
import type { ToolCaller, ToolCallOutcome } from '@shared/domain/tool-result';

export async function fetchTools(connectionId: string): Promise<ToolDescriptor[]> {
  if (!window.studio) return [];
  return (await window.studio.invoke('connections:tools', { connectionId })).tools;
}

/** The tools advertised by a connection, keyed `['tools', connectionId]`. */
export function useTools(connectionId: string | undefined): UseQueryResult<ToolDescriptor[]> {
  return useQuery({
    queryKey: ['tools', connectionId],
    queryFn: () => (connectionId ? fetchTools(connectionId) : Promise.resolve<ToolDescriptor[]>([])),
    enabled: Boolean(connectionId),
  });
}

/** Effective annotations-derived "this call writes" flag — true when the tool
 *  is destructive, or when `readOnlyHint` is explicitly false. Used by the
 *  invocation dialog (and any other caller that has the effective annotations)
 *  to attribute the call in the audit trail. */
export function isWriteCall(annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined): boolean {
  if (!annotations) return false;
  return annotations.destructiveHint === true || annotations.readOnlyHint === false;
}

export async function callTool(
  connectionId: string,
  toolName: string,
  args?: Record<string, unknown>,
  opts?: { write?: boolean; caller?: ToolCaller },
): Promise<ToolCallOutcome> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio.invoke('connections:call', {
    connectionId,
    toolName,
    args,
    ...(opts?.write !== undefined ? { write: opts.write } : {}),
    ...(opts?.caller !== undefined ? { caller: opts.caller } : {}),
  });
}
