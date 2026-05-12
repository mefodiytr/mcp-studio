import { useEffect, useState } from 'react';

import type { ConnectionSummary } from '@shared/domain/connection';

/** The live connections: seeded from `connections:list` on mount, then kept in
 *  sync via the `connections:changed` event. Seeding matters for components
 *  mounted *after* a connection was made (a lazily-loaded view, a plugin view
 *  opened later) — they'd otherwise stay empty until the next change event. */
export function useConnections(): ConnectionSummary[] {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  useEffect(() => {
    let gotEvent = false;
    void window.studio
      ?.invoke('connections:list', {})
      .then((list) => {
        if (!gotEvent) setConnections(list);
      })
      .catch(() => {
        /* bridge unavailable — events (if any) will populate it */
      });
    return window.studio?.on('connections:changed', (event) => {
      gotEvent = true;
      setConnections(event.connections);
    });
  }, []);
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
