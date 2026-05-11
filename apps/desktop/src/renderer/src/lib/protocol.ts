import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProtocolEvent } from '@shared/domain/protocol';

const CAP = 1000;

export interface ProtocolStream {
  events: ProtocolEvent[];
  paused: boolean;
  setPaused: (paused: boolean) => void;
  clear: () => void;
}

/** The live JSON-RPC traffic across all connections, hydrated from the
 *  main-side ring buffer and topped up by `protocol:event`. While paused, new
 *  events are ignored; unpausing re-syncs from the backlog. */
export function useProtocolStream(): ProtocolStream {
  const [events, setEvents] = useState<ProtocolEvent[]>([]);
  const [paused, setPausedState] = useState(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void window.studio?.invoke('protocol:backlog', {}).then(({ events: backlog }) => {
      if (!cancelled) setEvents(backlog.slice(-CAP));
    });
    const off = window.studio?.on('protocol:event', (event) => {
      if (pausedRef.current) return;
      setEvents((prev) => {
        const base = prev.length >= CAP ? prev.slice(prev.length - CAP + 1) : prev.slice();
        base.push(event);
        return base;
      });
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  const setPaused = useCallback((next: boolean) => {
    pausedRef.current = next;
    setPausedState(next);
    if (!next) {
      void window.studio?.invoke('protocol:backlog', {}).then(({ events: backlog }) => setEvents(backlog.slice(-CAP)));
    }
  }, []);

  const clear = useCallback(() => {
    void window.studio?.invoke('protocol:clear', {});
    setEvents([]);
  }, []);

  return { events, paused, setPaused, clear };
}
