/**
 * Per-`(pluginName, profileId, connectionId)` cache for resolved plugin
 * `systemPrompt(ctx)` strings — the M6 D4 promt17 nuance.
 *
 * Lives in main because it must survive renderer reloads + share across
 * multi-window chat sessions on the same profile. In-memory only; on app
 * restart the cache is empty (a knowledge inventory fetch on first chat
 * after restart pays the 10s blocking call again — acceptable per the
 * recon).
 *
 * **TTL invalidation only in v1.** A `knowledgeHash` / `knowledgeVersion`
 * field on niagaramcp's `getKnowledgeSummary` response would let main
 * invalidate precisely on knowledge-model edits — tracked in
 * `docs/m1-followups.md` as a server-side coordination item. Until then,
 * the 30-min TTL + the renderer-side fire-and-forget background refresh
 * on warm-cache hits cover the workflow.
 */

/** 30 minutes default. Configurable per-entry via `set(..., ttlMs?)`. */
export const SYSTEM_PROMPT_CACHE_DEFAULT_TTL_MS = 30 * 60 * 1000;

export interface SystemPromptCacheEntry {
  /** The resolved system-prompt section (host base + plugin contributions
   *  joined) — the chat-runner's `system` arg verbatim. */
  value: string;
  /** Absolute timestamp (ms since epoch) past which the entry is treated
   *  as a miss. Background-refresh updates this. */
  expiresAt: number;
  /** When the entry was first inserted — useful for debug + the renderer's
   *  "this prompt was cached at HH:MM" hint (m6-followup). */
  insertedAt: number;
}

export class SystemPromptCache {
  private readonly store = new Map<string, SystemPromptCacheEntry>();

  /** Cache key — `${pluginName}:${profileId}:${connectionId}`. The
   *  connectionId is included so a profile that reconnects to a different
   *  station-runtime (failover) populates a fresh entry rather than reusing
   *  the prior station's knowledge inventory. */
  static keyOf(pluginName: string, profileId: string, connectionId: string): string {
    return `${pluginName}:${profileId}:${connectionId}`;
  }

  /** Returns the cached entry if still valid; clears + returns null when
   *  expired. Time source via the `now` arg for testability; defaults to
   *  `Date.now`. */
  get(key: string, now: number = Date.now()): SystemPromptCacheEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  /** Insert / replace an entry. The renderer's caller decides whether this
   *  is a fresh population or a background-refresh update; the cache
   *  doesn't distinguish. */
  set(
    key: string,
    value: string,
    options: { ttlMs?: number; now?: number } = {},
  ): SystemPromptCacheEntry {
    const now = options.now ?? Date.now();
    const ttl = options.ttlMs ?? SYSTEM_PROMPT_CACHE_DEFAULT_TTL_MS;
    const entry: SystemPromptCacheEntry = {
      value,
      insertedAt: now,
      expiresAt: now + ttl,
    };
    this.store.set(key, entry);
    return entry;
  }

  /** Drop one entry — e.g. on disconnect / profile deletion. No-op for an
   *  unknown key. */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** Drop everything matching a predicate. The renderer can use this to
   *  invalidate a profile's whole inventory on plugin reload. */
  deleteMatching(predicate: (key: string) => boolean): number {
    let removed = 0;
    for (const k of this.store.keys()) {
      if (predicate(k)) {
        this.store.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /** Drop everything. */
  clear(): void {
    this.store.clear();
  }

  /** Diagnostic — entry count without exposing the entries themselves. */
  size(): number {
    return this.store.size;
  }
}
