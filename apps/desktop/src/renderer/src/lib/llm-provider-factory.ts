import { createAnthropicProvider, MockLlmProvider, type LlmProvider, type MockProgram } from '@mcp-studio/llm-provider';

/**
 * Pick the LLM provider for a chat-runner instance.
 *
 * Renderer-only consumption per M5 D1. The Anthropic adapter is instantiated
 * here with the freshly-fetched API key — the key lives in the provider's
 * closure for the lifetime of one ReAct iteration. The mock provider
 * (`MCPSTUDIO_LLM_PROVIDER=mock`) routes user messages to canned programs and
 * is the default for e2e specs.
 *
 * Program registration: the e2e specs (or a dev override) register `MockProgram`
 * entries via `registerMockProgram(...)` at startup so each spec carries its
 * own program library. Production builds without the env var ignore mock
 * registrations.
 */
const mockPrograms: MockProgram[] = [];

function bridge(): NonNullable<typeof window.studio> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio;
}

export function registerMockProgram(program: MockProgram): void {
  mockPrograms.push(program);
}

/** Read once at chat-session start. Caller is the chat view. */
export async function pickActiveProviderMode(): Promise<'mock' | 'anthropic'> {
  const { provider } = await bridge().invoke('llm:config', {});
  return provider;
}

export async function createProvider(mode: 'mock' | 'anthropic'): Promise<LlmProvider> {
  if (mode === 'mock') {
    return new MockLlmProvider(mockPrograms);
  }
  const { key } = await bridge().invoke('llm:getKey', { provider: 'anthropic' });
  if (!key) {
    throw new Error('No Anthropic API key set — open Settings → AI to add one.');
  }
  return createAnthropicProvider({ apiKey: key });
}
