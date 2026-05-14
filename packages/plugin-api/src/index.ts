import type { ComponentType } from 'react';
import { z } from 'zod';

export { useHostBus } from './host-bus';

/**
 * The plugin contract — what an in-box plugin (e.g. Niagara) exposes to the
 * host, and what the host hands back. Build-time, statically imported by the
 * renderer's plugin registry; same-process, trust-by-default (M2). Loosely
 * typed at the IPC seam on purpose — the host has the typed domain; a plugin
 * validates the results it cares about.
 */

/** Structural Tool-annotations shape used in the manifest (defined inline here
 *  to keep the type-only dependency direction one-way — the manifest schema
 *  must not depend on the runtime exports below). Mirror of {@link ToolAnnotations}. */
const toolAnnotationsObjectSchema = z
  .object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .partial();

/** A plugin's identity + which servers it specializes (matched against
 *  `serverInfo.name`). `matches` is a `RegExp` for build-time plugins; a string
 *  is accepted and coerced to a `RegExp` (for a future manifest.json form).
 *  `title` is the human-readable label the host shows (badges, "specialized by"
 *  hints); falls back to `name`.
 *
 *  **M5 C75** — the manifest carries `toolAnnotationOverrides` so the
 *  main-process annotation registry can resolve effective annotations without
 *  a renderer round-trip (the AI-write safety boundary at `ConnectionManager.
 *  callTool` consults it). The renderer's `applyAnnotationOverrides` reads
 *  from the manifest's table — single source of truth, no drift. */
export const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1).optional(),
  matches: z.union([z.instanceof(RegExp), z.string().min(1)]),
  /** tool-name → annotation overlay onto the server's advertised
   *  `tools/list` annotations. Pure data — no functions — so main can import
   *  the manifest directly without dragging in renderer-side React. */
  toolAnnotationOverrides: z.record(toolAnnotationsObjectSchema).optional(),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/** True if this plugin specializes a server whose `serverInfo.name` is `serverName`. */
export function matchesServerName(
  manifest: Pick<PluginManifest, 'matches'>,
  serverName: string | null | undefined,
): boolean {
  if (!serverName) return false;
  const pattern = manifest.matches instanceof RegExp ? manifest.matches : new RegExp(manifest.matches);
  return pattern.test(serverName);
}

/** The connection a plugin instance is bound to — a loose subset of the host's
 *  `ConnectionSummary` (the plugin parses tool results itself; it doesn't need
 *  the full typed summary). */
export interface PluginConnection {
  connectionId: string;
  profileId: string;
  serverInfo: { name: string; version: string; title?: string } | null;
  /** `'signing-in' | 'connected' | 'auth-required' | 'error'` — loose on purpose. */
  status: string;
}

/** What the host hands a plugin view: the bound connection, thin wrappers over
 *  the existing IPC channels (results come back loosely typed), and the
 *  templating-`cwd` publisher. */
export interface PluginContext {
  readonly connection: PluginConnection;
  /** Invoke a tool. `opts.write` flags the call as a mutation for the audit
   *  trail — pass it from write-tool wrappers (the host's destructive-confirm
   *  + the History "writes only" filter both lean on it). */
  callTool(
    name: string,
    args?: Record<string, unknown>,
    opts?: { write?: boolean },
  ): Promise<unknown>;
  listTools(): Promise<unknown[]>;
  listResources(): Promise<unknown[]>;
  listResourceTemplates(): Promise<unknown[]>;
  readResource(uri: string): Promise<unknown>;
  listPrompts(): Promise<unknown[]>;
  getPrompt(name: string, args?: Record<string, string>): Promise<unknown>;
  rawRequest(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Publish (or clear with `undefined`) the active view's "cwd" into the
   *  templating context — resolves the `{{cwd}}` token in tool-call argument
   *  templates. */
  setCwd(path: string | undefined): void;
}

/** Tool annotation hints (`tools/list` → `Tool.annotations`). Structural — kept
 *  dependency-free; mirrors the MCP `ToolAnnotations` shape. */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Merge a plugin's annotation override over a server's advertised annotations:
 *  every *defined* key in `override` wins; undefined / absent keys leave `base`
 *  alone. Used by the host when a plugin's {@link Plugin.toolAnnotationOverrides}
 *  corrects a server whose `tools/list` ships wrong hints (e.g. a write tool
 *  advertised `readOnlyHint: true`). Returns a fresh object; never mutates. */
export function mergeToolAnnotations(
  base: ToolAnnotations | undefined,
  override: ToolAnnotations | undefined,
): ToolAnnotations | undefined {
  if (!override) return base;
  const merged: ToolAnnotations = { ...base };
  if (override.title !== undefined) merged.title = override.title;
  if (override.readOnlyHint !== undefined) merged.readOnlyHint = override.readOnlyHint;
  if (override.destructiveHint !== undefined) merged.destructiveHint = override.destructiveHint;
  if (override.idempotentHint !== undefined) merged.idempotentHint = override.idempotentHint;
  if (override.openWorldHint !== undefined) merged.openWorldHint = override.openWorldHint;
  return merged;
}

export interface PluginView {
  /** Stable id — used as the rail-item key / tab type. */
  id: string;
  /** Display title — rail tooltip / tab label. */
  title: string;
  /** Optional icon (any component that takes a `className`). */
  icon?: ComponentType<{ className?: string }>;
  /** The view body; the host renders it with the bound `PluginContext`. */
  component: ComponentType<{ ctx: PluginContext }>;
}

/** A palette command a plugin contributes for its connection. Structural (not
 *  importing the host's `Command`) to keep `plugin-api` dependency-free. */
export interface PluginCommand {
  id: string;
  title: string;
  group?: string;
  keywords?: string;
  run: () => void | Promise<void>;
}

/** A canned multi-step diagnostic flow a plugin contributes to the chat
 *  view. **M5** ships flows as a templated `prompt` (free-text with
 *  `${placeholder}` slots the launcher dialog fills in) that the ReAct loop
 *  walks naturally. **M6** adds an optional `plan: PlanStep[]` — when present,
 *  the chat runner switches to plan-and-execute (deterministic step
 *  sequence with `runIf` conditional skips + `${var.path}` substitution
 *  against bound results); when absent, the M5 `prompt` is used as the
 *  user-message kick-off (back-compat preserved). M8's visual flow builder
 *  edits the `plan` shape directly.
 */
export interface DiagnosticFlow {
  /** Stable key — used for palette command ids + (M6+) saved-flow refs. */
  id: string;
  /** Palette label + dialog heading. */
  title: string;
  /** One-line description; tooltip + dialog body. */
  description: string;
  /** **M5 back-compat / fallback.** Templated user-message prompt. `${name}`
   *  tokens are substituted from the launcher's collected `params`. Used when
   *  `plan` is absent (M5 flows continue to work unchanged). */
  prompt: string;
  /** The placeholders the launcher dialog should prompt for. Empty / absent
   *  means the prompt / plan has no substitutions. */
  params?: DiagnosticFlowParam[];
  /** **M6.** Structured plan steps. When present, the chat runner executes
   *  the plan deterministically (rather than handing `prompt` to ReAct);
   *  steps run in order, each step's `runIf` predicate is evaluated against
   *  the bound variables from upstream steps + the collected `params`, and
   *  `bindResultTo` binds a step's result into the variable map for downstream
   *  use. M5-shaped flows (no `plan` field) continue to run via the M5 ReAct
   *  path. */
  plan?: PlanStep[];
}

export interface DiagnosticFlowParam {
  /** Token name — matches `${name}` in the flow's `prompt` *and* in any
   *  plan step's `args` / `prompt` `${param.<name>}` substitution path. */
  name: string;
  /** Field label in the launcher dialog. */
  label: string;
  /** Optional placeholder / hint. */
  placeholder?: string;
}

// ── M6 structured plan model ──────────────────────────────────────────────

/**
 * One step in a diagnostic-flow plan (M6 D1 — linear-with-`runIf`-skips).
 * Two kinds in v1: `tool-call` (invokes an MCP tool with substituted args)
 * and `llm-step` (calls the LLM with a templated prompt + the conversation
 * history). The terminal step is normally an `llm-step` whose result becomes
 * the final assistant message; intermediate steps `bindResultTo` a variable
 * name so downstream steps can reference the value via `${var.path}`.
 *
 * **What's intentionally out of v1**: `aggregator` / `condition` / `output`
 * step kinds, true fork/join branching, and arbitrary JS expressions in
 * `runIf`. M8's visual builder edits this shape + extends with more kinds
 * against the same envelope — the v1 contract is forward-compatible.
 */
export type PlanStep =
  | {
      kind: 'tool-call';
      /** Stable id within the plan — used by the chat's per-step rendering
       *  + `Message.planStepId` cross-ref. */
      id: string;
      /** MCP tool name — must be in the active connection's `tools/list`. */
      tool: string;
      /** Arguments. Each value is either a literal (JSON-able), or a
       *  `${param.x}` / `${var.path}` template string substituted at run
       *  time against the launcher params + the bound-variable map. */
      args: Record<string, unknown>;
      /** Variable name to bind the tool's result to (downstream steps can
       *  reference it via `${var.<name>...}`). Absent means the result is
       *  not threaded downstream. */
      bindResultTo?: string;
      /** Skip this step when the predicate evaluates to `false`. Absent =
       *  `{kind:'always'}` (always runs). */
      runIf?: ConditionExpr;
      /** Optional inline description shown in the plan editor's step row —
       *  short, ≤80 chars; the editor falls back to `${tool}(…)` if absent. */
      label?: string;
    }
  | {
      kind: 'llm-step';
      id: string;
      /** Templated prompt. `${param.x}` / `${var.path}` substituted at run
       *  time. The LLM's text reply binds to `bindResultTo` if set; the
       *  *terminal* `llm-step` of a plan (no `bindResultTo`) renders as the
       *  final assistant message in the chat. */
      prompt: string;
      bindResultTo?: string;
      runIf?: ConditionExpr;
      /** Optional model override for cost / latency control on intermediate
       *  classify-or-summarise steps (e.g. `'claude-haiku-4-5'` for a cheap
       *  intermediate; the terminal step normally inherits the conversation's
       *  default). */
      model?: string;
      label?: string;
    };

/**
 * The v1 condition DSL (M6 D1 — six tags, no `and`/`or`/`any` combinators).
 * Open-ended JS expressions / nested combinators are an m6-followup if real
 * flows need them.
 *
 *   `always`      — runs unconditionally (effectively absent `runIf`)
 *   `never`       — skips unconditionally (useful for plan-editor "disable
 *                    this step" toggles without removing it from the plan)
 *   `var-truthy`  — `path` resolves to a truthy value in the var map
 *   `var-defined` — `path` resolves to a non-undefined, non-null value
 *   `var-compare` — numeric / string / boolean comparison against `value`
 *   `var-length-gt` — `path` resolves to an array; its length exceeds `value`
 */
export type ConditionExpr =
  | { kind: 'always' }
  | { kind: 'never' }
  | { kind: 'var-truthy'; path: string }
  | { kind: 'var-defined'; path: string }
  | {
      kind: 'var-compare';
      path: string;
      op: '>' | '<' | '>=' | '<=' | '==' | '!=';
      value: number | string | boolean;
    }
  | { kind: 'var-length-gt'; path: string; value: number };

/** Read a dotted path out of a variable map, with array-index support.
 *  `getVarPath({a:{b:[{c:1}]}}, 'a.b.0.c')` → `1`. Returns `undefined` for
 *  any segment that doesn't resolve. Exported for testability + the plan
 *  editor's variable-reference autocomplete. */
export function getVarPath(vars: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let cursor: unknown = vars;
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number.parseInt(segment, 10);
      if (Number.isNaN(idx)) return undefined;
      cursor = cursor[idx];
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/** Evaluate a {@link ConditionExpr} against a variable map. Pure; testable.
 *  Used by the M6 plan runner at each step's `runIf` decision point + by
 *  the plan editor's "this step will skip" preview. */
export function evalCondition(expr: ConditionExpr | undefined, vars: Record<string, unknown>): boolean {
  if (!expr) return true;
  switch (expr.kind) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'var-truthy':
      return Boolean(getVarPath(vars, expr.path));
    case 'var-defined': {
      const v = getVarPath(vars, expr.path);
      return v !== undefined && v !== null;
    }
    case 'var-compare': {
      const v = getVarPath(vars, expr.path);
      const left = v as number | string | boolean | null | undefined;
      const right = expr.value;
      switch (expr.op) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '>':
          return typeof left === 'number' && left > Number(right);
        case '<':
          return typeof left === 'number' && left < Number(right);
        case '>=':
          return typeof left === 'number' && left >= Number(right);
        case '<=':
          return typeof left === 'number' && left <= Number(right);
      }
    }
    // eslint-disable-next-line no-fallthrough
    case 'var-length-gt': {
      const v = getVarPath(vars, expr.path);
      return Array.isArray(v) && v.length > expr.value;
    }
  }
}

/** Substitute `${param.x}` / `${var.path}` tokens in a template string against
 *  the launcher params + the bound-variable map. Unknown tokens are left as
 *  the literal `${...}` so the LLM sees them + can complain (matches the M5
 *  `substituteFlowPrompt` behaviour).
 *
 *  The substitutor returns a string — non-string variable values are
 *  JSON-stringified (so `${var.equipment}` rendering an object dumps the
 *  JSON; the LLM consumes it from prose). For `tool-call.args` that need
 *  the *typed* value (e.g. an array passed as the `points` arg), use
 *  {@link substituteValue} instead, which preserves the bound type when
 *  the entire template is a single `${var.path}` token. */
export function substituteVars(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\$\{([\w.]+)\}/g, (match, path: string) => {
    const segments = path.split('.');
    const root = segments[0];
    if (!root) return match;
    const rest = segments.slice(1).join('.');
    const lookup = vars[root];
    if (lookup === undefined) return match;
    const resolved = rest ? getVarPath({ [root]: lookup }, path) : lookup;
    if (resolved === undefined) return match;
    if (typeof resolved === 'string') return resolved;
    try {
      return JSON.stringify(resolved);
    } catch {
      return String(resolved);
    }
  });
}

/** Substitute a value that may itself be a `${var.path}` token *as a whole*
 *  — when the entire input string is a single token, the bound typed value
 *  is returned (preserving arrays / numbers / booleans); otherwise the
 *  string-substituted form is returned (via {@link substituteVars}). Used
 *  by `tool-call.args` so a step like
 *  `{ ord: '${equipment.ord}', limit: '${param.limit}' }` keeps `ord` as a
 *  string AND `limit` as a number after substitution. Non-string values
 *  pass through unchanged. */
export function substituteValue(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value !== 'string') return value;
  // Whole-token form: ${...} with nothing else.
  const whole = /^\$\{([\w.]+)\}$/.exec(value);
  if (whole) {
    const path = whole[1] ?? '';
    const segments = path.split('.');
    const root = segments[0];
    if (!root) return value;
    const lookup = vars[root];
    if (lookup === undefined) return value;
    const rest = segments.slice(1).join('.');
    const resolved = rest ? getVarPath({ [root]: lookup }, path) : lookup;
    return resolved === undefined ? value : resolved;
  }
  // Mixed form: interpolate as a string.
  return substituteVars(value, vars);
}

/** A plugin = a manifest + the views it contributes, plus optional per-context
 *  commands, tool-name → schema hints for the generic Tools-catalog form,
 *  tool-name → annotation overrides, and (M5) AI co-pilot contributions
 *  (system prompt fragment / starter questions / diagnostic flows). */
export interface Plugin {
  manifest: PluginManifest;
  views: PluginView[];
  commands?: (ctx: PluginContext) => PluginCommand[];
  /** tool-name → JSON-Schema-ish hint, merged into the generic Tools form. */
  toolSchemaHints?: Record<string, unknown>;
  /**
   * **DEPRECATED in M5 C75** — declare overrides on
   * {@link PluginManifest.toolAnnotationOverrides} instead. Main can read the
   * manifest directly (it's pure data), so the AI-write safety boundary at
   * `ConnectionManager.callTool` consults the manifest's table without a
   * renderer round-trip. The renderer's `applyAnnotationOverrides` also reads
   * from the manifest. This runtime field stays as a back-compat fallback for
   * any plugin that hasn't migrated yet; new plugins should ship overrides on
   * the manifest. The Niagara plugin migrated in C75.
   *
   * @deprecated since M5 C75 — use `manifest.toolAnnotationOverrides`.
   */
  toolAnnotationOverrides?: Record<string, ToolAnnotations>;

  /** **M5.** A text fragment appended to the assembled host base system
   *  prompt when this plugin's connection is active. Returns null to opt
   *  out for this connection. Sections from multiple active plugins are
   *  joined with `\n\n---\n\n`.
   *
   *  Use for: domain idioms the LLM needs to operate without false starts —
   *  the niagaramcp plugin contributes ORD format, knowledge layer
   *  semantics, BQL syntax wart, boolean-localization heads-up, etc. */
  systemPrompt?: (ctx: PluginContext) => string | null;

  /** **M5.** Suggested first messages — chips in the empty-conversation
   *  state. Plugins should contribute domain-relevant questions; static
   *  strings in v1, richer prompts with ord autocomplete are an m5-followup.
   *  Host caps at 6 total across all active plugins. */
  starterQuestions?: (ctx: PluginContext) => string[];

  /** **M5.** Canned diagnostic flows. Surface as command-palette entries
   *  ("Run diagnostic: <title>") and as a button row in the chat empty
   *  state. M5 ships flows as templated user prompts (D7); plan-and-execute
   *  lifts them to stored plan templates in M6. */
  diagnosticFlows?: (ctx: PluginContext) => DiagnosticFlow[];

  /** **M5 (C75 forward-compat).** Per-plugin claim hook for the AI-write
   *  safety boundary: when the host intercepts an AI-attributed write tool
   *  call (D5), it asks each active plugin "can you render this op in your
   *  pending-changes queue?". The Niagara plugin returns `true` for ops its
   *  pending-store knows how to enqueue; other plugins return `false`. M5
   *  exercises only the Niagara plugin; the hook exists to keep the
   *  contract complete for a second-write-capable-plugin future. */
  canHandleWrite?: (op: { name: string; args: Record<string, unknown> }) => boolean;
}
