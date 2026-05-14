import type { ComponentType } from 'react';
import { z } from 'zod';

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

/** A canned multi-step diagnostic flow a plugin contributes to the M5 chat
 *  view. In M5 the `prompt` is a *templated user message* (free-text with
 *  `${placeholder}` slots the host's flow-launcher dialog fills in) that the
 *  ReAct loop walks naturally — D7 recon: plan-and-execute layering on stored
 *  plan templates is M6. The `params` array describes the placeholders the
 *  launcher dialog should prompt for; an empty / absent `params` means the
 *  prompt is sent verbatim. */
export interface DiagnosticFlow {
  /** Stable key — used for palette command ids + (M6+) saved-flow refs. */
  id: string;
  /** Palette label + dialog heading. */
  title: string;
  /** One-line description; tooltip + dialog body. */
  description: string;
  /** Templated user-message prompt. `${name}` tokens are substituted from the
   *  launcher's collected `params`. The host base system prompt + plugin
   *  systemPrompt have already been assembled — `prompt` is just the user
   *  message that kicks off the ReAct loop. */
  prompt: string;
  /** The placeholders the launcher dialog should prompt for. Empty / absent
   *  means the prompt has no substitutions; the flow runs as-is. */
  params?: DiagnosticFlowParam[];
}

export interface DiagnosticFlowParam {
  /** Token name — matches `${name}` in the flow's `prompt`. */
  name: string;
  /** Field label in the launcher dialog. */
  label: string;
  /** Optional placeholder / hint. */
  placeholder?: string;
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
