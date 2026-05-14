/**
 * @mcp-studio/llm-provider — public exports.
 *
 * Renderer-only consumption (see README). Main never imports this package;
 * it sees AI tool calls via the M5 caller arg on `tools:call` IPC.
 */
export type {
  LlmContentBlock,
  LlmEvent,
  LlmMessage,
  LlmProvider,
  LlmStreamRequest,
  LlmTool,
  LlmUsage,
  StopReason,
} from './types';
export { TOOL_LOOP_STOP_REASONS } from './types';

export { createAnthropicProvider } from './anthropic';
export type { AnthropicProviderOptions } from './anthropic';

export { AnthropicStreamMapper, replayFixture } from './anthropic-stream';
export type { AnthropicSseEvent } from './anthropic-stream';

export { runReAct } from './runner';
export type { RunReActOptions, RunnerEvent } from './runner';

export { FakeLlmProvider, textTurn, toolUseTurn } from './fake';
export type { FakeProviderTurn } from './fake';

export { MockLlmProvider, matchUserText } from './mock-programs';
export type { MockProgram } from './mock-programs';
