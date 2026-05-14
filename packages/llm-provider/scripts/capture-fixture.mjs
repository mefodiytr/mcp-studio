#!/usr/bin/env node
// Capture a real Anthropic Messages-API SSE stream to a JSONL fixture file.
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node packages/llm-provider/scripts/capture-fixture.mjs \
//     --prompt "What's the weather in Paris? Think out loud before calling the tool." \
//     --tool get_weather \
//     --out packages/llm-provider/test/fixtures/anthropic-interleaved-stream-real.jsonl
//
// The script forces tool_use by providing a single trivial tool definition and
// instructing the model to think out loud first (mirroring the M5 watch-item:
// the interleaved text+tool_use shape is what the adapter must handle). Writes
// one JSON event per line (newline-delimited) — replay-able via
// `AnthropicStreamMapper.push(...)` in tests.
//
// Requires `@anthropic-ai/sdk` (a workspace dep of @mcp-studio/llm-provider).
// Run from the repo root (or anywhere — the --out path resolves to cwd).
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const args = {
    prompt: "What's the weather in Paris? Think out loud before calling the tool.",
    tool: 'get_weather',
    out: 'anthropic-interleaved-stream-real.jsonl',
    model: 'claude-opus-4-7',
    maxTokens: 1024,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--prompt':
        args.prompt = next;
        i++;
        break;
      case '--tool':
        args.tool = next;
        i++;
        break;
      case '--out':
        args.out = next;
        i++;
        break;
      case '--model':
        args.model = next;
        i++;
        break;
      case '--max-tokens':
        args.maxTokens = Number(next);
        i++;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        // ignore unknown
        break;
    }
  }
  return args;
}

function printHelp() {
  console.log(`capture-fixture.mjs — capture a real Anthropic SSE stream as JSONL.

Usage:
  ANTHROPIC_API_KEY=sk-ant-... node capture-fixture.mjs [options]

Options:
  --prompt <text>      The user message to send (default: weather-in-Paris prompt).
  --tool <name>        The mock tool name; only one tool is registered to force
                       tool_use. (default: get_weather)
  --out <path>         Output file path (default: anthropic-interleaved-stream-real.jsonl).
  --model <model>      Anthropic model id (default: claude-opus-4-7).
  --max-tokens <n>     Token cap (default: 1024).
  -h, --help           This message.
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is required.');
    process.exit(2);
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const outPath = resolve(process.cwd(), args.out);
  const lines = [];

  const stream = client.messages.stream({
    model: args.model,
    max_tokens: args.maxTokens,
    messages: [{ role: 'user', content: args.prompt }],
    tools: [
      {
        name: args.tool,
        description: `Mock tool: returns the weather for a given location.`,
        input_schema: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city, e.g. "Paris, FR" or "San Francisco, CA".',
            },
          },
          required: ['location'],
        },
      },
    ],
  });

  for await (const event of stream) {
    // Each event is the parsed SSE event payload, same shape as the docs.
    lines.push(JSON.stringify(event));
  }

  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.error(`Captured ${lines.length} events to ${outPath}`);
}

main().catch((err) => {
  console.error('capture-fixture: failed:', err);
  process.exit(1);
});
