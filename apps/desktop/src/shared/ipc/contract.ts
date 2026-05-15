import { z } from 'zod';

import { oauthStatusSchema } from '../domain/auth';
import { connectionSummarySchema, toolDescriptorSchema } from '../domain/connection';
import { conversationSchema, messageSchema } from '../domain/conversations';
import { profileInputSchema, profileSchema } from '../domain/profile';
import { getPromptResultSchema, promptDescriptorSchema } from '../domain/prompt';
import { protocolEventSchema } from '../domain/protocol';
import {
  readResourceResultSchema,
  resourceDescriptorSchema,
  resourceTemplateDescriptorSchema,
} from '../domain/resource';
import { toolHistoryEntrySchema } from '../domain/tool-history';
import { rawRequestOutcomeSchema, toolCallerSchema, toolCallOutcomeSchema } from '../domain/tool-result';
import { watchSchema } from '../domain/watches';

/**
 * The single source of truth for the renderer ↔ main IPC surface.
 *
 * - `invokeChannels`: request/response calls (renderer → main), backed by
 *   `ipcRenderer.invoke` / `ipcMain.handle`.
 * - `eventChannels`: push notifications (main → renderer), backed by
 *   `webContents.send` / `ipcRenderer.on`.
 *
 * Both sides import this for compile-time types; the main process additionally
 * runs the zod parsers below at the boundary (requests in / responses out /
 * events out), so a malformed payload fails loudly with a precise error. The
 * renderer trusts main (a compromised main is game over regardless), so the
 * preload bridge is a thin typed pass-through and carries no zod at runtime.
 */
export const invokeChannels = {
  /** Liveness / round-trip health check. Permanent. */
  'app:ping': {
    request: z.object({ at: z.number() }),
    response: z.object({ pong: z.literal(true), at: z.number(), echoedAt: z.number() }),
  },

  // ── Connection profiles (workspace store; secrets live in the vault) ───────
  'profiles:list': {
    request: z.object({}),
    response: z.array(profileSchema),
  },
  'profiles:get': {
    request: z.object({ id: z.string() }),
    response: profileSchema,
  },
  'profiles:create': {
    request: z.object({ input: profileInputSchema }),
    response: profileSchema,
  },
  'profiles:update': {
    request: z.object({ id: z.string(), input: profileInputSchema }),
    response: profileSchema,
  },
  'profiles:delete': {
    request: z.object({ id: z.string() }),
    response: z.object({ id: z.string() }),
  },

  // ── Credentials (OS-encrypted vault; the renderer only ever sees the hint) ──
  'credentials:set': {
    request: z.object({ profileId: z.string(), secret: z.string().min(1) }),
    response: z.object({ hint: z.string() }),
  },
  'credentials:hint': {
    request: z.object({ profileId: z.string() }),
    response: z.object({ hint: z.string().nullable() }),
  },
  'credentials:clear': {
    request: z.object({ profileId: z.string() }),
    response: z.object({ profileId: z.string() }),
  },

  // ── OAuth (status is redacted; tokens never cross to the renderer) ─────────
  'oauth:status': {
    request: z.object({ profileId: z.string() }),
    response: oauthStatusSchema,
  },
  'oauth:signOut': {
    request: z.object({ profileId: z.string() }),
    response: z.object({ profileId: z.string() }),
  },

  // ── Live connections (the main process owns the MCP sessions) ─────────────
  'connections:list': {
    request: z.object({}),
    response: z.array(connectionSummarySchema),
  },
  'connections:connect': {
    request: z.object({ profileId: z.string() }),
    response: connectionSummarySchema,
  },
  'connections:reconnect': {
    request: z.object({ connectionId: z.string() }),
    response: connectionSummarySchema,
  },
  'connections:disconnect': {
    request: z.object({ connectionId: z.string() }),
    response: z.object({ connectionId: z.string() }),
  },
  'connections:tools': {
    request: z.object({ connectionId: z.string() }),
    response: z.object({ tools: z.array(toolDescriptorSchema) }),
  },
  'connections:call': {
    request: z.object({
      connectionId: z.string(),
      toolName: z.string(),
      args: z.record(z.unknown()).optional(),
      /** Audit attribution — true if the caller knows this is a write call
       *  (computed from the effective tool annotations). Stored on the
       *  history entry; absent when the caller doesn't know. */
      write: z.boolean().optional(),
      /** **M5 C75** — caller attribution. Absent = 'human' (every M1–M4
       *  caller omits this and gets the back-compat path). `{type:'ai', …}`
       *  triggers the safety boundary: main looks up effective annotations,
       *  and if `isWriteCall` is true, returns `pendingEnqueued` instead of
       *  dispatching — the renderer routes the op to the plugin's
       *  pending-changes queue for operator approval. */
      caller: toolCallerSchema.optional(),
    }),
    response: toolCallOutcomeSchema,
  },
  'connections:raw': {
    request: z.object({
      connectionId: z.string(),
      method: z.string(),
      params: z.record(z.unknown()).optional(),
    }),
    response: rawRequestOutcomeSchema,
  },
  'connections:resources': {
    request: z.object({ connectionId: z.string() }),
    response: z.object({ resources: z.array(resourceDescriptorSchema) }),
  },
  'connections:resourceTemplates': {
    request: z.object({ connectionId: z.string() }),
    response: z.object({ templates: z.array(resourceTemplateDescriptorSchema) }),
  },
  'connections:readResource': {
    request: z.object({ connectionId: z.string(), uri: z.string() }),
    response: readResourceResultSchema,
  },
  'connections:prompts': {
    request: z.object({ connectionId: z.string() }),
    response: z.object({ prompts: z.array(promptDescriptorSchema) }),
  },
  'connections:getPrompt': {
    request: z.object({
      connectionId: z.string(),
      name: z.string(),
      args: z.record(z.string()).optional(),
    }),
    response: getPromptResultSchema,
  },

  // ── Protocol inspector (raw JSON-RPC traffic) ────────────────────────────
  'protocol:backlog': {
    request: z.object({}),
    response: z.object({ events: z.array(protocolEventSchema) }),
  },
  'protocol:clear': {
    request: z.object({}),
    response: z.object({}),
  },

  // ── Tool-call history ────────────────────────────────────────────────────
  'history:list': {
    request: z.object({}),
    response: z.object({ entries: z.array(toolHistoryEntrySchema) }),
  },
  'history:get': {
    request: z.object({ id: z.string() }),
    response: z.object({ entry: toolHistoryEntrySchema.nullable() }),
  },
  'history:clear': {
    request: z.object({}),
    response: z.object({}),
  },

  // ── Per-profile watch lists (M4 live monitor) ────────────────────────────
  'watches:list': {
    request: z.object({ profileId: z.string() }),
    response: z.object({ watches: z.array(watchSchema) }),
  },
  'watches:set': {
    request: z.object({ profileId: z.string(), watches: z.array(watchSchema) }),
    response: z.object({}),
  },

  // ── Per-profile conversations (M5 chat foundation) ───────────────────────
  'conversations:list': {
    request: z.object({ profileId: z.string() }),
    response: z.object({ conversations: z.array(conversationSchema) }),
  },
  'conversations:get': {
    request: z.object({ profileId: z.string(), id: z.string() }),
    response: z.object({ conversation: conversationSchema.nullable() }),
  },
  'conversations:save': {
    request: z.object({ profileId: z.string(), conversation: conversationSchema }),
    response: z.object({}),
  },
  'conversations:delete': {
    request: z.object({ profileId: z.string(), id: z.string() }),
    response: z.object({}),
  },
  'conversations:append': {
    request: z.object({
      profileId: z.string(),
      conversationId: z.string(),
      message: messageSchema,
    }),
    response: z.object({ conversation: conversationSchema.nullable() }),
  },

  // ── LLM provider config + API key (M5 D1 + D4) ───────────────────────────
  'llm:config': {
    request: z.object({}),
    /** Renderer reads this once at chat-session start to pick mock vs real
     *  provider (env-driven; the e2e specs set MCPSTUDIO_LLM_PROVIDER=mock).
     *  **M6 C86** — also surfaces the workspace-stored `summariserModel`
     *  preference (default `'haiku'` per promt17 D5). */
    response: z.object({
      provider: z.enum(['anthropic', 'mock']),
      summariserModel: z.enum(['haiku', 'sonnet', 'opus', 'same-as-main']),
    }),
  },
  'llm:hasKey': {
    request: z.object({ provider: z.string() }),
    response: z.object({ hasKey: z.boolean(), hint: z.string().nullable() }),
  },
  'llm:setKey': {
    request: z.object({ provider: z.string(), key: z.string().min(1) }),
    response: z.object({ hint: z.string() }),
  },
  /** Returns the decrypted key. Renderer-only consumption per M5 D1 — the
   *  ESM `@anthropic-ai/sdk` ships ESM-first and main is CJS-bundled. Trade-off
   *  documented in `docs/milestone-5.md` D4 Adjustments. The key lives in
   *  renderer memory only for the lifetime of one ReAct runner. */
  'llm:getKey': {
    request: z.object({ provider: z.string() }),
    response: z.object({ key: z.string().nullable() }),
  },
  'llm:clearKey': {
    request: z.object({ provider: z.string() }),
    response: z.object({}),
  },

  // ── Plugin systemPrompt cache (M6 C85b — per-(plugin, profile,
  //    connection) TTL cache for resolved systemPrompt strings). The
  //    renderer's chat-runner-launch path checks the cache before invoking
  //    the plugin's async systemPrompt(ctx); on hit, uses the cached value
  //    + schedules a background refresh; on miss, fires the live call +
  //    populates the cache. ────────────────────────────────────────────
  'llm:systemPromptCache:get': {
    request: z.object({
      pluginName: z.string(),
      profileId: z.string(),
      connectionId: z.string(),
    }),
    response: z.object({
      value: z.string().nullable(),
      /** Absolute ms-epoch timestamp; null on a miss. */
      expiresAt: z.number().nullable(),
    }),
  },
  'llm:systemPromptCache:set': {
    request: z.object({
      pluginName: z.string(),
      profileId: z.string(),
      connectionId: z.string(),
      value: z.string(),
      /** TTL override in ms. Absent → SYSTEM_PROMPT_CACHE_DEFAULT_TTL_MS. */
      ttlMs: z.number().int().positive().optional(),
    }),
    response: z.object({ expiresAt: z.number() }),
  },
  'llm:systemPromptCache:clear': {
    /** Clear matching entries. Absent fields = wildcard; an empty request
     *  clears EVERY entry (the "reset all caches" dev affordance). */
    request: z.object({
      pluginName: z.string().optional(),
      profileId: z.string().optional(),
      connectionId: z.string().optional(),
    }),
    response: z.object({ removed: z.number() }),
  },
} as const;

export const eventChannels = {
  /** Demo heartbeat — proves the event mechanism; superseded by real sources
   *  (connection status in C11, the protocol tap in C9). */
  'app:tick': z.object({ seq: z.number().int().nonnegative(), at: z.number() }),
  /** Emitted whenever the set of live connections changes (connect / disconnect
   *  / drop). Carries the full current list so the renderer can replace state. */
  'connections:changed': z.object({ connections: z.array(connectionSummarySchema) }),
  /** One JSON-RPC message observed on a connection's transport. */
  'protocol:event': protocolEventSchema,
  /** Emitted after a tool invocation is recorded in the history. */
  'history:changed': z.object({}),
} as const;

export type InvokeChannel = keyof typeof invokeChannels;
export type EventChannel = keyof typeof eventChannels;

export type InvokeRequest<C extends InvokeChannel> = z.infer<(typeof invokeChannels)[C]['request']>;
export type InvokeResponse<C extends InvokeChannel> = z.infer<(typeof invokeChannels)[C]['response']>;
export type EventPayload<C extends EventChannel> = z.infer<(typeof eventChannels)[C]>;

// ── Pure boundary validators (no Electron imports — unit-testable on their own) ──

export function parseInvokeRequest<C extends InvokeChannel>(channel: C, raw: unknown): InvokeRequest<C> {
  return invokeChannels[channel].request.parse(raw) as InvokeRequest<C>;
}

export function parseInvokeResponse<C extends InvokeChannel>(channel: C, raw: unknown): InvokeResponse<C> {
  return invokeChannels[channel].response.parse(raw) as InvokeResponse<C>;
}

export function parseEvent<C extends EventChannel>(channel: C, raw: unknown): EventPayload<C> {
  return eventChannels[channel].parse(raw) as EventPayload<C>;
}
