import { useEffect, useState } from 'react';

import type { EventChannel, EventPayload } from '@shared/ipc/contract';

/** Subscribe to a main→renderer event channel; returns the latest payload. */
export function useIpcEvent<C extends EventChannel>(channel: C): EventPayload<C> | undefined {
  const [payload, setPayload] = useState<EventPayload<C>>();
  useEffect(() => {
    return window.studio?.on(channel, setPayload);
  }, [channel]);
  return payload;
}

export interface IpcHealth {
  /** True once the round-trip ping has succeeded. */
  ok: boolean;
  /** Round-trip latency of the initial ping, in milliseconds. */
  pingMs?: number;
  /** Sequence number of the most recently received demo tick. */
  lastTickSeq?: number;
}

/** Probes the IPC boundary: pings main once on mount and tracks the demo tick. */
export function useIpcHealth(): IpcHealth {
  const [ok, setOk] = useState(false);
  const [pingMs, setPingMs] = useState<number>();
  const tick = useIpcEvent('app:tick');

  useEffect(() => {
    const bridge = window.studio;
    if (!bridge) return;
    const startedAt = performance.now();
    bridge
      .ping()
      .then(() => {
        setPingMs(Math.round(performance.now() - startedAt));
        setOk(true);
      })
      .catch(() => setOk(false));
  }, []);

  return { ok, pingMs, lastTickSeq: tick?.seq };
}
