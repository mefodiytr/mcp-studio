#!/usr/bin/env node
// Local REPL CLI for exercising the LLM adapter without the desktop UI around
// it. Useful for: (a) sanity-checking the Anthropic adapter against a real
// API call before wiring it into the chat view; (b) prototyping system
// prompts; (c) eyeballing the LlmEvent stream shape end-to-end.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node packages/llm-provider/bin/repl.mjs
//   ANTHROPIC_API_KEY=sk-ant-... node packages/llm-provider/bin/repl.mjs --tool=mock-weather
//
// Reads stdin line-by-line; each line is one user turn. Streams provider
// events to stdout (compact JSON, one per line). Ctrl-C aborts.
//
// Pattern is reusable — a future niagara plugin write-ops debugger could
// follow the same shape against the niagara-mock or a real station.
import { createInterface } from 'node:readline/promises';
import { createAnthropicProvider } from '../src/anthropic.ts';
import { runReAct } from '../src/runner.ts';

function parseArgs(argv) {
  const args = { tool: null, model: 'claude-opus-4-7' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('--tool=')) args.tool = arg.slice('--tool='.length);
    else if (arg.startsWith('--model=')) args.model = arg.slice('--model='.length);
    else if (arg === '-h' || arg === '--help') {
      console.log('Usage: ANTHROPIC_API_KEY=... node repl.mjs [--tool=mock-weather] [--model=claude-opus-4-7]');
      process.exit(0);
    }
  }
  return args;
}

const TOOLS = {
  'mock-weather': {
    name: 'get_weather',
    description: 'Return the weather for a location.',
    inputSchema: {
      type: 'object',
      properties: { location: { type: 'string' } },
      required: ['location'],
    },
    dispatch: async (args) => ({ tempC: 21, conditions: 'sunny', echo: args }),
  },
};

async function main() {
  const args = parseArgs(process.argv);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is required.');
    process.exit(2);
  }

  const tool = args.tool ? TOOLS[args.tool] : null;
  if (args.tool && !tool) {
    console.error(`Unknown --tool: ${args.tool}. Known: ${Object.keys(TOOLS).join(', ')}`);
    process.exit(2);
  }

  const provider = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: args.model });
  const history = [];

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());

  console.error(`# REPL ready — model=${args.model}, tool=${args.tool ?? '(none)'}.`);
  console.error('# Enter a prompt; Ctrl-D to exit.');

  for await (const line of rl) {
    const userText = line.trim();
    if (!userText) continue;
    history.push({ role: 'user', content: [{ type: 'text', text: userText }] });

    const gen = runReAct({
      provider,
      system: 'You are a helpful assistant in a developer REPL.',
      history,
      tools: tool ? [{ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }] : [],
      dispatchTool: async (name, input) => {
        if (tool && name === tool.name) return tool.dispatch(input);
        return { error: `unknown tool: ${name}` };
      },
      signal: controller.signal,
    });

    let final;
    let result = await gen.next();
    while (!result.done) {
      const ev = result.value;
      // Compact one-line JSON for piping into jq.
      console.log(JSON.stringify(ev));
      result = await gen.next();
    }
    final = result.value;
    // Replace local history with the runner's final history for the next turn.
    history.length = 0;
    history.push(...final);
  }
}

main().catch((err) => {
  console.error('repl: failed:', err);
  process.exit(1);
});
