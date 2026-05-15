import { SystemPromptCache } from '../cache/system-prompt-cache';
import type { CredentialVault } from '../store/credential-vault';
import type { JsonStore } from '../store/json-store';
import type { WorkspaceData } from '../store/workspace-store';
import { handle } from './index';

/**
 * Wire the `llm:*` IPC channels — workspace-global LLM API key management
 * + the provider-mode config (mock vs anthropic, env-driven for e2e) +
 * the M6 C85b per-(plugin, profile, connection) systemPrompt cache.
 *
 * `llm:getKey` returns the decrypted key to the renderer. This is a
 * documented trade-off (see `docs/milestone-5.md` D4 Adjustments): the
 * `@anthropic-ai/sdk` is ESM-first and Electron-33 main is CJS-bundled
 * (per the M1 C7b decision), so M5 v1 runs the provider in the renderer.
 * The key is requested on demand by the chat-runner and held only for the
 * lifetime of one ReAct iteration. M6+ background-agent-loop / scheduled-
 * flow scenarios would move the provider into main with a CJS bundling
 * pass; this IPC remains the canonical setter / hint accessor at that point.
 *
 * **M6 C85b** — the `llm:systemPromptCache:*` channels surface a main-
 * resident in-memory cache for resolved `Plugin.systemPrompt(ctx)` strings
 * (the niagara plugin's `getKnowledgeSummary` enrichment is the v1
 * consumer). 30-minute default TTL; the chat-runner uses cache hits
 * immediately + fires a fire-and-forget background refresh; on cache miss
 * the chat-runner blocks first turn for up to 10s (M6 D4 promt17 nuance).
 */
export function registerLlmHandlers(vault: CredentialVault, workspace: JsonStore<WorkspaceData>): void {
  const cache = new SystemPromptCache();

  handle('llm:config', () => ({
    provider: process.env.MCPSTUDIO_LLM_PROVIDER === 'mock' ? ('mock' as const) : ('anthropic' as const),
    summariserModel: workspace.data.llm.summariserModel ?? 'haiku',
  }));
  handle('llm:hasKey', ({ provider }) => ({
    hasKey: vault.hasLlmKey(provider),
    hint: vault.getLlmKeyHint(provider) ?? null,
  }));
  handle('llm:setKey', ({ provider, key }) => ({
    hint: vault.setLlmKey(provider, key),
  }));
  handle('llm:getKey', ({ provider }) => ({
    key: vault.getLlmKey(provider) ?? null,
  }));
  handle('llm:clearKey', ({ provider }) => {
    vault.deleteLlmKey(provider);
    return {};
  });

  handle('llm:systemPromptCache:get', ({ pluginName, profileId, connectionId }) => {
    const entry = cache.get(SystemPromptCache.keyOf(pluginName, profileId, connectionId));
    return entry ? { value: entry.value, expiresAt: entry.expiresAt } : { value: null, expiresAt: null };
  });
  handle('llm:systemPromptCache:set', ({ pluginName, profileId, connectionId, value, ttlMs }) => {
    const entry = cache.set(
      SystemPromptCache.keyOf(pluginName, profileId, connectionId),
      value,
      ttlMs !== undefined ? { ttlMs } : {},
    );
    return { expiresAt: entry.expiresAt };
  });
  handle('llm:systemPromptCache:clear', ({ pluginName, profileId, connectionId }) => {
    if (!pluginName && !profileId && !connectionId) {
      const removed = cache.size();
      cache.clear();
      return { removed };
    }
    const removed = cache.deleteMatching((key) => {
      const [keyPlugin, keyProfile, keyConn] = key.split(':');
      if (pluginName && keyPlugin !== pluginName) return false;
      if (profileId && keyProfile !== profileId) return false;
      if (connectionId && keyConn !== connectionId) return false;
      return true;
    });
    return { removed };
  });
}
