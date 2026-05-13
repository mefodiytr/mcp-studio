import { join } from 'node:path';

import type { Profile } from '../../shared/domain/profile';
import type { ToolHistoryEntry } from '../../shared/domain/tool-history';
import type { WatchesByProfile } from '../../shared/domain/watches';

import { JsonStore } from './json-store';

export interface WorkspaceData {
  schemaVersion: number;
  profiles: Profile[];
  toolHistory: ToolHistoryEntry[];
  /** Per-profile M4 watch lists — see `shared/domain/watches.ts`. */
  watches: WatchesByProfile;
}

const WORKSPACE_VERSION = 3;

/**
 * The workspace document: connection profiles, tool-call history, and (M4)
 * per-profile watch lists for the live monitor. Macros and the better-sqlite3
 * migration land as later milestone work; see json-store.ts.
 */
export function createWorkspaceStore(userDataDir: string): JsonStore<WorkspaceData> {
  return new JsonStore<WorkspaceData>({
    filePath: join(userDataDir, 'workspace.json'),
    version: WORKSPACE_VERSION,
    defaults: { schemaVersion: WORKSPACE_VERSION, profiles: [], toolHistory: [], watches: {} },
    migrate: (data) => {
      // Idempotent: every field reads defensively from `obj` and falls back to
      // an empty default. v1 → v2 added `toolHistory`; v2 → v3 adds `watches`.
      // Re-running this migrator on an already-v3 file produces the same shape.
      const obj = typeof data === 'object' && data !== null ? (data as Partial<WorkspaceData>) : {};
      return {
        schemaVersion: WORKSPACE_VERSION,
        profiles: Array.isArray(obj.profiles) ? obj.profiles : [],
        toolHistory: Array.isArray(obj.toolHistory) ? obj.toolHistory : [],
        watches:
          obj.watches && typeof obj.watches === 'object' && !Array.isArray(obj.watches) ? obj.watches : {},
      };
    },
  });
}
