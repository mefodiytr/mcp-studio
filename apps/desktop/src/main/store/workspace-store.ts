import { join } from 'node:path';

import type { ConversationsByProfile } from '../../shared/domain/conversations';
import type { Profile } from '../../shared/domain/profile';
import type { ToolHistoryEntry } from '../../shared/domain/tool-history';
import type { WatchesByProfile } from '../../shared/domain/watches';

import { JsonStore } from './json-store';

export interface WorkspaceLlmSettings {
  /** Active provider — `'anthropic'` in v1; `'openai'` / `'ollama'` slots in
   *  for M7+ once adapters land. */
  provider: 'anthropic';
  /** **M6 C86** — which model to use for the head-trim summarisation call.
   *  `'haiku'` (default — claude-haiku-4-5, ~20× cheaper than opus; right
   *  trade-off for the summary turn). `'sonnet'` if real-world summaries
   *  lose key context (3× cheaper than opus, substantially better fluency
   *  than haiku — the m6-followup escalation). `'opus'` for parity-debug.
   *  `'same-as-main'` — uses whatever model the active conversation runs
   *  (useful when iterating on prompt quality without splitting cost
   *  models). Field is optional + reads defensively in the migrator so M5
   *  workspaces continue to load (treated as `'haiku'`). */
  summariserModel?: 'haiku' | 'sonnet' | 'opus' | 'same-as-main';
}

export interface WorkspaceData {
  schemaVersion: number;
  profiles: Profile[];
  toolHistory: ToolHistoryEntry[];
  /** Per-profile M4 watch lists — see `shared/domain/watches.ts`. */
  watches: WatchesByProfile;
  /** Per-profile M5 conversations — see `shared/domain/conversations.ts`. */
  conversations: ConversationsByProfile;
  /** Workspace-level LLM preferences (M5 D4 — one provider account, all
   *  connections; the API key lives in the credential vault, not here). */
  llm: WorkspaceLlmSettings;
}

const WORKSPACE_VERSION = 4;

/**
 * The workspace document: connection profiles, tool-call history, per-profile
 * watch lists (M4), per-profile conversations + workspace LLM settings (M5).
 * Macros and the better-sqlite3 migration land as later milestone work;
 * see json-store.ts.
 */
export function createWorkspaceStore(userDataDir: string): JsonStore<WorkspaceData> {
  return new JsonStore<WorkspaceData>({
    filePath: join(userDataDir, 'workspace.json'),
    version: WORKSPACE_VERSION,
    defaults: {
      schemaVersion: WORKSPACE_VERSION,
      profiles: [],
      toolHistory: [],
      watches: {},
      conversations: {},
      llm: { provider: 'anthropic' },
    },
    migrate: (data) => {
      // Idempotent: every field reads defensively from `obj` and falls back to
      // an empty default. v1 → v2 added `toolHistory`; v2 → v3 added `watches`;
      // v3 → v4 adds `conversations` + `llm` (M5). Re-running this migrator
      // on an already-v4 file produces the same shape.
      const obj = typeof data === 'object' && data !== null ? (data as Partial<WorkspaceData>) : {};
      return {
        schemaVersion: WORKSPACE_VERSION,
        profiles: Array.isArray(obj.profiles) ? obj.profiles : [],
        toolHistory: Array.isArray(obj.toolHistory) ? obj.toolHistory : [],
        watches:
          obj.watches && typeof obj.watches === 'object' && !Array.isArray(obj.watches) ? obj.watches : {},
        conversations:
          obj.conversations && typeof obj.conversations === 'object' && !Array.isArray(obj.conversations)
            ? obj.conversations
            : {},
        llm: parseLlmSettings(obj.llm),
      };
    },
  });
}

/** Permissively parse the `llm` field. M5 workspaces ship without
 *  `summariserModel` (additive in M6 C86 — no version bump); the migrator
 *  drops it from the stored shape if absent so re-runs are no-ops. */
function parseLlmSettings(raw: unknown): WorkspaceLlmSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { provider: 'anthropic' };
  const obj = raw as Partial<WorkspaceLlmSettings>;
  const summariser = obj.summariserModel;
  return {
    provider: obj.provider === 'anthropic' ? 'anthropic' : 'anthropic',
    ...(summariser === 'haiku' || summariser === 'sonnet' || summariser === 'opus' || summariser === 'same-as-main'
      ? { summariserModel: summariser }
      : {}),
  };
}
