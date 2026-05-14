# Anthropic SSE stream fixtures

Newline-delimited JSON (`.jsonl`) captures of the Anthropic Messages-API SSE
stream — replay-able in unit tests via `AnthropicStreamMapper.push(...)`
without an `ANTHROPIC_API_KEY` at test time.

Each line is one SSE event's `data:` payload (the `event:` line is implied by
the payload's `type` field; the SDK exposes the events in this same shape).

## Files

| File | Provenance | What it is |
|---|---|---|
| `anthropic-interleaved-stream.jsonl` | **Anthropic public docs** — [Messages-streaming → "Streaming request with tool use"](https://docs.anthropic.com/en/api/messages-streaming) — verbatim. | The canonical interleaved-text-then-tool-use example: text deltas ("Okay, let's check the weather for San Francisco, CA:") → `content_block_stop` → `tool_use` block (`get_weather`) → `input_json_delta` chunks accumulating the location arg → `stop_reason: tool_use`. The wire-accurate fixture for adapter behaviour. |
| `anthropic-text-only-stream.jsonl` | **Anthropic public docs** — [Messages-streaming → "Basic streaming request"](https://docs.anthropic.com/en/api/messages-streaming) — verbatim. | A "Hello!" text-only reply ending in `end_turn`. The simplest case — pure text deltas, no tool use. |
| `anthropic-tool-only-stream.jsonl` | **Synthesised edge case** — same wire shape as the interleaved fixture, with the leading text block stripped. | tool_use block at index 0 with **no preceding text**. Some real Anthropic responses do this when the model goes straight to a tool call without a rationale text block. |
| `anthropic-multi-tool-stream.jsonl` | **Synthesised edge case** — two `get_weather` calls in one assistant message. | A single assistant message containing **two** parallel tool_use blocks. The runner dispatches each in sequence and accumulates both `tool_result` messages before the next turn. |

## Replacing a synthesised fixture with a real capture

`scripts/capture-fixture.mjs` makes a real Anthropic API call and writes the
JSONL. Set `ANTHROPIC_API_KEY` in env and run:

```bash
ANTHROPIC_API_KEY=sk-ant-... node packages/llm-provider/scripts/capture-fixture.mjs \
  --prompt "What's the weather in Paris? Think out loud before calling the tool." \
  --tool get_weather \
  --out packages/llm-provider/test/fixtures/anthropic-interleaved-stream-real.jsonl
```

Then rename the captured file to replace one of the docs-verbatim fixtures.
Unit tests assert per-line event shape, not exact token content — a real
capture should pass against the same assertions (the wire shape is
documented + stable).

CI runs without `ANTHROPIC_API_KEY` against these fixtures as-is.
