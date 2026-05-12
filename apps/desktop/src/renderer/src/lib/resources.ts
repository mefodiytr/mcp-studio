import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type {
  ReadResourceResult,
  ResourceDescriptor,
  ResourceTemplateDescriptor,
} from '@shared/domain/resource';

export async function fetchResources(connectionId: string): Promise<ResourceDescriptor[]> {
  if (!window.studio) return [];
  return (await window.studio.invoke('connections:resources', { connectionId })).resources;
}

export async function fetchResourceTemplates(connectionId: string): Promise<ResourceTemplateDescriptor[]> {
  if (!window.studio) return [];
  return (await window.studio.invoke('connections:resourceTemplates', { connectionId })).templates;
}

/** Static resources advertised by a connection, keyed `['resources', connectionId]`. */
export function useResources(connectionId: string | undefined): UseQueryResult<ResourceDescriptor[]> {
  return useQuery({
    queryKey: ['resources', connectionId],
    queryFn: () => (connectionId ? fetchResources(connectionId) : Promise.resolve<ResourceDescriptor[]>([])),
    enabled: Boolean(connectionId),
  });
}

/** Resource templates advertised by a connection, keyed `['resourceTemplates', connectionId]`. */
export function useResourceTemplates(
  connectionId: string | undefined,
): UseQueryResult<ResourceTemplateDescriptor[]> {
  return useQuery({
    queryKey: ['resourceTemplates', connectionId],
    queryFn: () =>
      connectionId ? fetchResourceTemplates(connectionId) : Promise.resolve<ResourceTemplateDescriptor[]>([]),
    enabled: Boolean(connectionId),
  });
}

export async function readResource(connectionId: string, uri: string): Promise<ReadResourceResult> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio.invoke('connections:readResource', { connectionId, uri });
}
