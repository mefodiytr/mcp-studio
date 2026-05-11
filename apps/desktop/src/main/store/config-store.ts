import { join } from 'node:path';

import { JsonStore } from './json-store';

export interface WindowBounds {
  width: number;
  height: number;
}

export interface AppConfig {
  schemaVersion: number;
  /** Last main-window size, restored on launch. */
  windowBounds?: WindowBounds;
  /** Reserved for when multiple workspaces exist. */
  lastWorkspaceId?: string;
  /** Local feature toggles. */
  featureFlags: Record<string, boolean>;
}

const CONFIG_VERSION = 1;

/** App-level config (key/value-ish). Distinct from the workspace store. */
export function createConfigStore(userDataDir: string): JsonStore<AppConfig> {
  return new JsonStore<AppConfig>({
    filePath: join(userDataDir, 'config.json'),
    version: CONFIG_VERSION,
    defaults: { schemaVersion: CONFIG_VERSION, featureFlags: {} },
  });
}
