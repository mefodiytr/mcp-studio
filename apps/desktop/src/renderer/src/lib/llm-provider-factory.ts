import { createAnthropicProvider, MockLlmProvider, type LlmProvider, type MockProgram } from '@mcp-studio/llm-provider';

import { MOCK_PROGRAMS } from './llm-mock-programs';

/**
 * Pick the LLM provider for a chat-runner instance.
 *
 * Renderer-only consumption per M5 D1. The Anthropic adapter is instantiated
 * here with the freshly-fetched API key — the key lives in the provider's
 * closure for the lifetime of one ReAct iteration. The mock provider
 * (`MCPSTUDIO_LLM_PROVIDER=mock`) auto-loads the canned program library at
 * `./llm-mock-programs.ts` (greeting / rooftop / write-propose / cancel)
 * + accepts additional `registerMockProgram(...)` entries for dev / tests.
 * Production builds without the env var skip the mock entirely.
 */
const dynamicPrograms: MockProgram[] = [];

function bridge(): NonNullable<typeof window.studio> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio;
}

export function registerMockProgram(program: MockProgram): void {
  dynamicPrograms.push(program);
}

/** Read once at chat-session start. Caller is the chat view. */
export async function pickActiveProviderMode(): Promise<'mock' | 'anthropic'> {
  const { provider } = await bridge().invoke('llm:config', {});
  return provider;
}

export async function createProvider(mode: 'mock' | 'anthropic'): Promise<LlmProvider> {
  if (mode === 'mock') {
    // Dynamic registrations win — a dev override matches before the canned
    // library. (Tests get deterministic mock behaviour without re-registering
    // every spec.)
    return new MockLlmProvider([...dynamicPrograms, ...MOCK_PROGRAMS]);
  }
  const { key } = await bridge().invoke('llm:getKey', { provider: 'anthropic' });
  if (!key) {
    throw new Error('No Anthropic API key set — open Settings → AI to add one.');
  }
  return createAnthropicProvider({ apiKey: key });
}
