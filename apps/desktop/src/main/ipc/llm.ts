import type { CredentialVault } from '../store/credential-vault';
import { handle } from './index';

/**
 * Wire the `llm:*` IPC channels — workspace-global LLM API key management
 * and the provider-mode config (mock vs anthropic, env-driven for e2e).
 *
 * `llm:getKey` returns the decrypted key to the renderer. This is a
 * documented trade-off (see `docs/milestone-5.md` D4 Adjustments): the
 * `@anthropic-ai/sdk` is ESM-first and Electron-33 main is CJS-bundled
 * (per the M1 C7b decision), so M5 v1 runs the provider in the renderer.
 * The key is requested on demand by the chat-runner and held only for the
 * lifetime of one ReAct iteration. M6+ background-agent-loop / scheduled-
 * flow scenarios would move the provider into main with a CJS bundling
 * pass; this IPC remains the canonical setter / hint accessor at that point.
 */
export function registerLlmHandlers(vault: CredentialVault): void {
  handle('llm:config', () => ({
    provider: process.env.MCPSTUDIO_LLM_PROVIDER === 'mock' ? ('mock' as const) : ('anthropic' as const),
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
}
