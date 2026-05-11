import { describe, expect, it } from 'vitest';

import type { ProtocolEvent } from '../../shared/domain/protocol';
import { ProtocolTap } from './protocol-tap';

function collector(): { events: ProtocolEvent[]; emit: (event: ProtocolEvent) => void } {
  const events: ProtocolEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}

describe('ProtocolTap', () => {
  it('classifies requests / responses / notifications and correlates duration', () => {
    const { events, emit } = collector();
    const tap = new ProtocolTap(emit);

    tap.record('c1', 'outgoing', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } as never);
    tap.record('c1', 'incoming', { jsonrpc: '2.0', id: 1, result: { tools: [] } } as never);
    tap.record('c1', 'incoming', { jsonrpc: '2.0', method: 'notifications/message', params: {} } as never);
    tap.record('c1', 'incoming', { jsonrpc: '2.0', id: 2, error: { code: -1, message: 'nope' } } as never);

    expect(events.map((e) => e.kind)).toEqual(['request', 'response', 'notification', 'response']);
    expect(events[0]).toMatchObject({ direction: 'outgoing', method: 'tools/list', id: 1 });
    expect(events[1]).toMatchObject({ direction: 'incoming', kind: 'response', id: 1 });
    expect(typeof events[1]?.durationMs).toBe('number');
    expect(events[2]).toMatchObject({ kind: 'notification', method: 'notifications/message' });
    expect(events[3]).toMatchObject({ kind: 'response', id: 2, isError: true });
  });

  it('respects the ring-buffer cap and exposes the backlog', () => {
    const tap = new ProtocolTap(() => undefined, 3);
    for (let i = 0; i < 10; i += 1) {
      tap.record('c', 'outgoing', { jsonrpc: '2.0', id: i, method: 'ping' } as never);
    }
    expect(tap.backlog()).toHaveLength(3);
    expect(tap.backlog().map((e) => e.id)).toEqual([7, 8, 9]);
    tap.clear();
    expect(tap.backlog()).toHaveLength(0);
  });
});
