import type { WatchRepository } from '../store/watch-repository';
import { handle } from './index';

/** Wire the `watches:*` IPC channels — per-profile watch lists for the M4
 *  live monitor; persistence in `workspace.json` under the connection's
 *  `profileId`. The renderer holds a Zustand mirror and bulk-syncs each
 *  mutation through `watches:set`. */
export function registerWatchHandlers(watches: WatchRepository): void {
  handle('watches:list', ({ profileId }) => ({ watches: watches.list(profileId) }));
  handle('watches:set', ({ profileId, watches: list }) => {
    watches.set(profileId, list);
    return {};
  });
}
