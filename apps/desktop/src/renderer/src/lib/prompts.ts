import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { GetPromptResult, PromptDescriptor } from '@shared/domain/prompt';

async function fetchPrompts(connectionId: string): Promise<PromptDescriptor[]> {
  if (!window.studio) return [];
  return (await window.studio.invoke('connections:prompts', { connectionId })).prompts;
}

/** Prompts advertised by a connection, keyed `['prompts', connectionId]`. */
export function usePrompts(connectionId: string | undefined): UseQueryResult<PromptDescriptor[]> {
  return useQuery({
    queryKey: ['prompts', connectionId],
    queryFn: () => (connectionId ? fetchPrompts(connectionId) : Promise.resolve<PromptDescriptor[]>([])),
    enabled: Boolean(connectionId),
  });
}

export async function getPrompt(
  connectionId: string,
  name: string,
  args?: Record<string, string>,
): Promise<GetPromptResult> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio.invoke('connections:getPrompt', { connectionId, name, args });
}
