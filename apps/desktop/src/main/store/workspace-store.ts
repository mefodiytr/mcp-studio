import { join } from 'node:path';

import type { Profile } from '../../shared/domain/profile';

import { JsonStore } from './json-store';

export interface WorkspaceData {
  schemaVersion: number;
  profiles: Profile[];
}

const WORKSPACE_VERSION = 1;

/**
 * The workspace document: connection profiles today; tool-call history, macros,
 * the audit log, and tab/layout state move in as later commits land (and the
 * whole thing migrates to better-sqlite3 in M4 — see json-store.ts).
 */
export function createWorkspaceStore(userDataDir: string): JsonStore<WorkspaceData> {
  return new JsonStore<WorkspaceData>({
    filePath: join(userDataDir, 'workspace.json'),
    version: WORKSPACE_VERSION,
    defaults: { schemaVersion: WORKSPACE_VERSION, profiles: [] },
    // migrate: (data, from) => { … }  — add when WORKSPACE_VERSION is bumped.
  });
}
