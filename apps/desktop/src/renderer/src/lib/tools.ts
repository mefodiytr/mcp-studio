import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ToolDescriptor } from '@shared/domain/connection';
import type { ToolCallOutcome } from '@shared/domain/tool-result';

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

export async function callTool(
  connectionId: string,
  toolName: string,
  args?: Record<string, unknown>,
): Promise<ToolCallOutcome> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio.invoke('connections:call', { connectionId, toolName, args });
}
