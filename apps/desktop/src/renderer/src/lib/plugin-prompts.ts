import type { DiagnosticFlow, Plugin, PluginContext } from '@mcp-studio/plugin-api';

/**
 * Single resolution point for the M5 AI co-pilot plugin contributions —
 * `systemPrompt` / `starterQuestions` / `diagnosticFlows`. Same shape as the
 * M3 `applyAnnotationOverlay` helper: the chat view, the command palette,
 * and the empty-state starter chips all consume `assemblePluginContributions`
 * so no drift can develop between what the LLM sees in its system prompt and
 * what the operator sees as suggestions.
 */

export interface AssembledContributions {
  /** Final system prompt: host base + plugin sections joined with
   *  `\n\n---\n\n`. */
  systemPrompt: string;
  /** Starter chip strings (capped at 6 total). */
  starterQuestions: string[];
  /** Palette + empty-state diagnostic flows, each tagged with its plugin so
   *  the launcher can show provenance. */
  diagnosticFlows: TaggedDiagnosticFlow[];
}

export interface TaggedDiagnosticFlow extends DiagnosticFlow {
  pluginName: string;
}

const MAX_STARTER_QUESTIONS = 6;

/** Host base system prompt — domain-independent guidance the LLM gets
 *  regardless of which plugin is active. Plugins extend with their domain
 *  specifics (ORD format, BQL syntax, etc.) via {@link Plugin.systemPrompt}.
 *
 *  D8 — the `chart` code-fence syntax for inline chart rendering lives here
 *  (host responsibility; plugins don't need to know about chart rendering).
 *  The chat view's markdown renderer intercepts the fence and routes the JSON
 *  payload to `<TimeSeriesChart>` (C76). */
export const HOST_BASE_SYSTEM_PROMPT = `You are an AI co-pilot inside MCP Studio, a desktop client for the Model Context Protocol. You operate against the connected server's tools, resources, and prompts — every action you take is auditable, and the operator can review, undo, or stop your work at any time.

Tool usage:
- Prefer the smallest sequence of tool calls that answers the question.
- After each tool result, briefly explain what you learned before deciding the next step (ReAct-style).
- Cite specific data in your final answer ("the supply-air temp is 18.4 °C as of 14:02 UTC, per readPoint on station:|slot:/Drivers/AHU1/SAT").
- If you don't have a tool for what the user wants, say so plainly rather than guessing.

Write safety:
- Write tools (those that change server state) DO NOT execute when you call them. They route through the operator's pending-changes queue for approval. Propose writes freely; explain what you'd change and why. The operator approves or rejects each one.
- Never claim a write has happened just because you called the tool — wait for confirmation that the operator applied it.

Inline charts:
- When you have time-series data and a chart would communicate the answer better than a table, emit a chart code fence in your message:
\`\`\`chart
{"type":"timeseries","title":"Optional title","series":[{"name":"label","points":[{"t":"2026-05-14T09:00:00Z","v":21.2},{"t":"2026-05-14T09:01:00Z","v":21.4}]}]}
\`\`\`
  - The renderer parses the JSON and draws the chart inline. Use ISO-8601 timestamps for \`t\`; numeric values for \`v\`.
  - Downsample to no more than ~500 points per series before emitting.
  - If the data is short (a handful of values), a sentence or a small table is fine.
- Do not embed a chart fence inside the explanation of how to use chart fences — escape with backticks or use prose.

Honesty:
- If a tool fails or returns an unexpected shape, surface that. Don't paper over errors.
- If a question is ambiguous, ask one clarifying question before launching a multi-step investigation.`;

const SECTION_JOIN = '\n\n---\n\n';

/** Defensive timeout for an async `Plugin.systemPrompt(ctx)` call. Real
 *  niagaramcp stations with large knowledge models take 2–4 s for
 *  `getKnowledgeSummary` (per the M6 D4 cache-extension recon); 10 s gives
 *  realistic headroom while still capping a misbehaving plugin's blocking
 *  effect on chat startup. Configurable via `assembleOptions.timeoutMs`. */
export const SYSTEM_PROMPT_TIMEOUT_MS = 10_000;

export interface AssembleOptions {
  /** Override the per-plugin systemPrompt timeout (M6 D4 default 10s). */
  timeoutMs?: number;
  /** Reported when a plugin's `systemPrompt(ctx)` timed out. The chat view
   *  surfaces this via a warning chip in the header ("Knowledge inventory
   *  unavailable") so the operator knows the LLM is operating without the
   *  enrichment. */
  onSystemPromptTimeout?: (pluginName: string) => void;
}

/**
 * Assemble the contributions from every active plugin. `plugins` is the list
 * of plugins whose `manifest.matches` regex matched the current connection's
 * `serverInfo.name` (typically zero or one in M5 — the picker is exact). The
 * host's command palette + chat empty state + ConversationRunner system prompt
 * all read from this single resolution point.
 *
 * **M6 C84** — async, to accommodate `Plugin.systemPrompt` returning
 * `Promise<string | null>` (the Niagara plugin's `getKnowledgeSummary`
 * enrichment lands in C85). Each plugin's `systemPrompt(ctx)` is awaited
 * under a defensive timeout (default 10 s); on timeout the plugin's section
 * is dropped + the optional `onSystemPromptTimeout` callback fires so the
 * chat view can surface a warning chip. `starterQuestions` and
 * `diagnosticFlows` stay synchronous (no `Promise` widening; they're
 * static data plugins compute from constants).
 */
export async function assemblePluginContributions(
  plugins: Plugin[],
  ctx: PluginContext,
  options: AssembleOptions = {},
): Promise<AssembledContributions> {
  const timeoutMs = options.timeoutMs ?? SYSTEM_PROMPT_TIMEOUT_MS;
  const pluginSections: string[] = [];
  const starterQuestions: string[] = [];
  const diagnosticFlows: TaggedDiagnosticFlow[] = [];

  for (const plugin of plugins) {
    if (plugin.systemPrompt) {
      try {
        const section = await withTimeout(
          Promise.resolve(plugin.systemPrompt(ctx)),
          timeoutMs,
          plugin.manifest.name,
        );
        if (section && section.trim().length > 0) pluginSections.push(section.trim());
      } catch (err) {
        // Two failure modes: (1) the plugin threw synchronously or returned
        // a rejected promise; (2) the timeout fired. The latter surfaces the
        // callback so the chat header can render a "Knowledge inventory
        // unavailable" chip; the former is silently dropped — a plugin
        // shouldn't be able to block chat startup with a thrown error.
        if (err instanceof PluginSystemPromptTimeoutError) {
          options.onSystemPromptTimeout?.(err.pluginName);
        }
        // Either way, the plugin's section doesn't make it into the assembled
        // prompt; the operator still gets the host base prompt + other
        // plugins' sections.
      }
    }
    if (plugin.starterQuestions) {
      try {
        const qs = plugin.starterQuestions(ctx);
        for (const q of qs) {
          if (typeof q === 'string' && q.trim().length > 0) starterQuestions.push(q.trim());
        }
      } catch {
        // ignore
      }
    }
    if (plugin.diagnosticFlows) {
      try {
        const flows = plugin.diagnosticFlows(ctx);
        for (const f of flows) {
          diagnosticFlows.push({ ...f, pluginName: plugin.manifest.name });
        }
      } catch {
        // ignore
      }
    }
  }

  const systemPrompt =
    pluginSections.length === 0
      ? HOST_BASE_SYSTEM_PROMPT
      : [HOST_BASE_SYSTEM_PROMPT, ...pluginSections].join(SECTION_JOIN);

  return {
    systemPrompt,
    starterQuestions: starterQuestions.slice(0, MAX_STARTER_QUESTIONS),
    diagnosticFlows,
  };
}

/**
 * Synchronous subset — just the static contributions (starter chips +
 * diagnostic flows). The system prompt isn't here because it can now be
 * async (M6 C84); callers needing only the UI-render subset (chat empty
 * state, command palette flow registry) use this sync helper to avoid the
 * full async path.
 *
 * The chat view's runner-launch path (`handleSend` / `handleRunPlan`)
 * AWAITS the full {@link assemblePluginContributions} right before invoking
 * the runner — that's the natural async entry point.
 */
export function collectStaticContributions(
  plugins: Plugin[],
  ctx: PluginContext,
): { starterQuestions: string[]; diagnosticFlows: TaggedDiagnosticFlow[] } {
  const starterQuestions: string[] = [];
  const diagnosticFlows: TaggedDiagnosticFlow[] = [];
  for (const plugin of plugins) {
    if (plugin.starterQuestions) {
      try {
        for (const q of plugin.starterQuestions(ctx)) {
          if (typeof q === 'string' && q.trim().length > 0) starterQuestions.push(q.trim());
        }
      } catch {
        // ignore
      }
    }
    if (plugin.diagnosticFlows) {
      try {
        for (const f of plugin.diagnosticFlows(ctx)) {
          diagnosticFlows.push({ ...f, pluginName: plugin.manifest.name });
        }
      } catch {
        // ignore
      }
    }
  }
  return {
    starterQuestions: starterQuestions.slice(0, MAX_STARTER_QUESTIONS),
    diagnosticFlows,
  };
}

/** Distinguish "the plugin's systemPrompt timed out" from other rejection
 *  causes so the host can surface a different UI (the warning chip). */
export class PluginSystemPromptTimeoutError extends Error {
  constructor(public readonly pluginName: string, ms: number) {
    super(`Plugin "${pluginName}" systemPrompt(ctx) timed out after ${ms}ms`);
    this.name = 'PluginSystemPromptTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, pluginName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PluginSystemPromptTimeoutError(pluginName, ms));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** Substitute `${name}` tokens in a flow's prompt with the launcher's
 *  collected params. Unknown tokens are left as-is so the LLM sees them and
 *  can ask the user. */
export function substituteFlowPrompt(template: string, params: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return typeof value === 'string' && value.length > 0 ? value : match;
  });
}
