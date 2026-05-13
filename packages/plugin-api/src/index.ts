import type { ComponentType } from 'react';
import { z } from 'zod';

/**
 * The plugin contract — what an in-box plugin (e.g. Niagara) exposes to the
 * host, and what the host hands back. Build-time, statically imported by the
 * renderer's plugin registry; same-process, trust-by-default (M2). Loosely
 * typed at the IPC seam on purpose — the host has the typed domain; a plugin
 * validates the results it cares about.
 */

/** A plugin's identity + which servers it specializes (matched against
 *  `serverInfo.name`). `matches` is a `RegExp` for build-time plugins; a string
 *  is accepted and coerced to a `RegExp` (for a future manifest.json form).
 *  `title` is the human-readable label the host shows (badges, "specialized by"
 *  hints); falls back to `name`. */
export const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1).optional(),
  matches: z.union([z.instanceof(RegExp), z.string().min(1)]),
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

/** A plugin = a manifest + the views it contributes, plus optional per-context
 *  commands, tool-name → schema hints for the generic Tools-catalog form, and
 *  tool-name → annotation overrides. */
export interface Plugin {
  manifest: PluginManifest;
  views: PluginView[];
  commands?: (ctx: PluginContext) => PluginCommand[];
  /** tool-name → JSON-Schema-ish hint, merged into the generic Tools form. */
  toolSchemaHints?: Record<string, unknown>;
  /** tool-name → an overlay onto the server's advertised tool annotations
   *  (see {@link mergeToolAnnotations}). For correcting servers whose
   *  `tools/list` ships wrong hints — e.g. a write tool marked `readOnlyHint:
   *  true` — so the host's destructive-confirm gate and badges are accurate. */
  toolAnnotationOverrides?: Record<string, ToolAnnotations>;
}
