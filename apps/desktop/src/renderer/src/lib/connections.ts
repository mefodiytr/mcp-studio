import { useEffect, useState } from 'react';

import type { ConnectionSummary, ToolSummary } from '@shared/domain/connection';

/** The live connections, kept in sync via the `connections:changed` event.
 *  Connections do not survive a process restart, so this starts empty. */
export function useConnections(): ConnectionSummary[] {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  useEffect(() => window.studio?.on('connections:changed', (event) => setConnections(event.connections)), []);
  return connections;
}

export async function connectProfile(profileId: string): Promise<ConnectionSummary> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio.invoke('connections:connect', { profileId });
}

export async function reconnectConnection(connectionId: string): Promise<ConnectionSummary> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio.invoke('connections:reconnect', { connectionId });
}

export async function disconnectConnection(connectionId: string): Promise<void> {
  await window.studio?.invoke('connections:disconnect', { connectionId });
}

export async function fetchTools(connectionId: string): Promise<ToolSummary[]> {
  if (!window.studio) return [];
  return (await window.studio.invoke('connections:tools', { connectionId })).tools;
}
