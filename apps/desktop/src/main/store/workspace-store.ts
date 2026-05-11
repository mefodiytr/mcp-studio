import { join } from 'node:path';

import type { Profile } from '../../shared/domain/profile';
import type { ToolHistoryEntry } from '../../shared/domain/tool-history';

import { JsonStore } from './json-store';

export interface WorkspaceData {
  schemaVersion: number;
  profiles: Profile[];
  toolHistory: ToolHistoryEntry[];
}

const WORKSPACE_VERSION = 2;

/**
 * The workspace document: connection profiles and tool-call history today;
 * macros, the audit log, and tab/layout state move in as later commits land
 * (and the whole thing migrates to better-sqlite3 in M4 — see json-store.ts).
 */
export function createWorkspaceStore(userDataDir: string): JsonStore<WorkspaceData> {
  return new JsonStore<WorkspaceData>({
    filePath: join(userDataDir, 'workspace.json'),
    version: WORKSPACE_VERSION,
    defaults: { schemaVersion: WORKSPACE_VERSION, profiles: [], toolHistory: [] },
    migrate: (data) => {
      const obj = typeof data === 'object' && data !== null ? (data as Partial<WorkspaceData>) : {};
      return {
        schemaVersion: WORKSPACE_VERSION,
        profiles: Array.isArray(obj.profiles) ? obj.profiles : [],
        toolHistory: Array.isArray(obj.toolHistory) ? obj.toolHistory : [],
      };
    },
  });
}
