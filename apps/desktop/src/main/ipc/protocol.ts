import type { ProtocolTap } from '../connections/protocol-tap';
import { handle } from './index';

/** Wire the `protocol:*` IPC channels to the tap. (Live events arrive on the
 *  `protocol:event` channel; this is the backlog + clear control.) */
export function registerProtocolHandlers(tap: ProtocolTap): void {
  handle('protocol:backlog', () => ({ events: tap.backlog() }));
  handle('protocol:clear', () => {
    tap.clear();
    return {};
  });
}
