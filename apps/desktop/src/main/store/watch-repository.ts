import type { Watch } from '../../shared/domain/watches';

import type { JsonStore } from './json-store';
import type { WorkspaceData } from './workspace-store';

/**
 * Per-profile watch list (M4). Reads/writes the `watches` field of the
 * workspace store; `connectionId` is session-only so the M4 plan keys by
 * `profileId` instead — see `docs/milestone-4.md` §D4. Replace-the-whole-list
 * semantics on `set` (the renderer holds a sorted Zustand mirror and bulk-
 * syncs each mutation; the watch list per profile is small — typically a few
 * to a few dozen entries).
 */
export class WatchRepository {
  constructor(private readonly store: JsonStore<WorkspaceData>) {
    // An older workspace.json may predate the field even after the migration
    // (defensive — the migrator already seeds {} but we re-defend here).
    if (typeof this.store.data.watches !== 'object' || Array.isArray(this.store.data.watches)) {
      this.store.data.watches = {};
    }
  }

  /** Snapshot of one profile's watch list, in insertion order. */
  list(profileId: string): Watch[] {
    const list = this.store.data.watches[profileId];
    return Array.isArray(list) ? [...list] : [];
  }

  /** Replace one profile's watch list. Saves to disk. */
  set(profileId: string, watches: readonly Watch[]): void {
    if (watches.length === 0) {
      delete this.store.data.watches[profileId];
    } else {
      this.store.data.watches[profileId] = [...watches];
    }
    this.store.save();
  }

  /** Drop every watch for a profile (e.g. when the profile is deleted). */
  clear(profileId: string): void {
    if (!(profileId in this.store.data.watches)) return;
    delete this.store.data.watches[profileId];
    this.store.save();
  }
}
