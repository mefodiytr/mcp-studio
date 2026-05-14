# @mcp-studio/llm-provider

Provider-agnostic LLM streaming + a bounded ReAct loop. Pure TS, ESM, node-env
tested. The package the M5 chat view talks to.

```
streamResponse(req): AsyncIterable<LlmEvent>     ← what an adapter implements
runReAct({provider, ...}): AsyncGenerator<...>   ← the bounded loop
```

## Where it lives in the architecture

**Renderer-only consumption.** The chat view (lands in C71) holds the
`LlmProvider` instance + the user's API key in memory after `llm:getKey`;
every LLM stream + every ReAct loop runs in the renderer. Main never imports
this package — main only sees AI-attributed tool calls via the M5 `caller`
arg on the `tools:call` IPC (the C75 safety boundary).

This split is deliberate:

- `@anthropic-ai/sdk` ships ESM-first. Renderer is ESM (Vite). Main is the
  Rollup-bundled-into-CJS world (per the M1 C7b decision); bringing the
  Anthropic SDK into main would require fighting the bundle config to keep
  the `MessageStream` async-iterator semantics intact. Not worth it for M5
  when the renderer can call `client.messages.stream(...)` directly.
- The safety boundary is **at the connection manager in main** (C75), not at
  the LLM provider — main mediates *every* `tools:call`, AI or human, via
  the `caller` attribution arg. The provider doesn't need to know about
  pending-changes queues; it just streams.
- If a future scenario needs main to invoke the provider (M6+ background
  agent loops, scheduled diagnostic flows), this package gains a CJS-compatible
  build pass + the main side imports it then. M5 v1 stays renderer-only.

## Public exports

```ts
import {
  // Provider contract
  type LlmProvider, type LlmEvent, type LlmMessage, type LlmTool,
  type LlmStreamRequest, type StopReason, TOOL_LOOP_STOP_REASONS,

  // The Anthropic adapter (renderer-only — pulls in @anthropic-ai/sdk)
  createAnthropicProvider, type AnthropicProviderOptions,

  // The pure SSE mapper (exposed for fixture replay + test helpers)
  AnthropicStreamMapper, replayFixture, type AnthropicSseEvent,

  // The bounded ReAct loop
  runReAct, type RunReActOptions, type RunnerEvent,

  // Test helpers
  FakeLlmProvider, textTurn, toolUseTurn, type FakeProviderTurn,

  // Programmatic mock for e2e (D9 — selected by MCPSTUDIO_LLM_PROVIDER=mock)
  MockLlmProvider, matchUserText, type MockProgram,
} from '@mcp-studio/llm-provider';
```

## Stream-shape fixtures

`test/fixtures/anthropic-*-stream.jsonl` — captured / docs-verbatim SSE event
streams. Replay via `AnthropicStreamMapper.push(...)` in unit tests; **no
ANTHROPIC_API_KEY required at test time**. CI runs these as-is.

To re-capture against a real API call (handy when the SDK or wire shape
evolves), run:

```bash
ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @mcp-studio/llm-provider capture-fixture \
  --prompt "What's the weather in Paris? Think out loud before calling the tool." \
  --tool get_weather \
  --out packages/llm-provider/test/fixtures/anthropic-interleaved-stream-real.jsonl
```

Then rename the captured file to replace the docs-verbatim one. Tests assert
per-line event shape, not exact token content — a real capture should pass
against the same assertions.

## REPL CLI

```bash
ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @mcp-studio/llm-provider repl --tool=mock-weather
```

Stdin → one user turn per line. Stdout → compact JSON `LlmEvent`s, one per
line (pipe into `jq` for shape inspection). Useful for sanity-checking the
adapter end-to-end without the desktop UI around it.

## What this package does NOT do

- **No persistence.** Conversation state lives in `apps/desktop`'s
  `conversation-repository` (C71).
- **No tool catalog.** The `tools` arg is whatever the caller passes; in M5
  it's the active MCP connection's `tools/list` mapped to `LlmTool` shape.
- **No write-tool routing.** Writes route to the pending-changes queue at
  the M5 C75 safety boundary in main — `runReAct`'s `dispatchTool` callback
  is provider-agnostic and routes through `window.studio.callTool` in the
  renderer, which threads the `caller: { type: 'ai', conversationId }` arg
  to main, which intercepts AI writes.
- **No conversation summarisation / context-window management.** The runner
  treats `messages` as the source of truth; the caller is responsible for
  trimming / summarising before passing it in.

## Workspace conventions

- Strict TS (`tsconfig.base.json`): `verbatimModuleSyntax`,
  `noUncheckedIndexedAccess`, etc.
- Vitest with `node` env.
- Wire deps: `@anthropic-ai/sdk` (runtime), `zod` (runtime — kept lightweight
  for future LLM-event validators; not used in v1).
