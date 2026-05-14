import { randomUUID } from 'node:crypto';

import {
  Connection,
  McpError,
  PendingAuthError,
  StudioOAuthClientProvider,
  UnauthorizedError,
  type TransportConfig,
} from '@mcp-studio/mcp-client';

import type { ConnectionSummary, ToolDescriptor } from '../../shared/domain/connection';
import type { Profile } from '../../shared/domain/profile';
import type { GetPromptResult, PromptDescriptor } from '../../shared/domain/prompt';
import type {
  ReadResourceResult,
  ResourceDescriptor,
  ResourceTemplateDescriptor,
} from '../../shared/domain/resource';
import type { ToolAnnotations } from '@mcp-studio/plugin-api';

import type { RawRequestOutcome, ToolCaller, ToolCallOutcome } from '../../shared/domain/tool-result';
import type { CredentialVault } from '../store/credential-vault';
import type { ProfileRepository } from '../store/profile-repository';
import type { ToolHistoryRepository } from '../store/tool-history-repository';
import { startLoopbackRedirect, type LoopbackRedirect } from '../oauth/redirect';
import { tokenExpiresAt } from '../oauth/status';
import { getEffectiveAnnotations, isWriteCall, pickManifest } from '../plugins/manifest-registry';
import { forceKillTree, type StdioPidTracker } from './pid-tracker';
import type { ProtocolTap } from './protocol-tap';

const LATENCY_HISTORY_CAP = 20;
const LATENCY_POLL_MS = 15_000;
const CLIENT_INFO = { name: 'mcp-studio', version: '0.1.0' };

interface Managed {
  connectionId: string;
  profileId: string;
  /** The live session — absent on a `signing-in` placeholder. */
  connection?: Connection;
  childPid?: number;
  /** The in-flight OAuth loopback listener — present only while `signing-in`. */
  redirect?: LoopbackRedirect;
  summary: ConnectionSummary;
  /** **M5 C75** — cached `tools/list` annotations for the safety-boundary
   *  predicate. Populated lazily on the first AI-attributed call; cleared on
   *  reconnect. */
  baseAnnotationsByTool?: Map<string, ToolAnnotations | undefined>;
}

function transportConfigFor(profile: Profile): TransportConfig {
  if (profile.transport === 'http') return { transport: 'http', url: profile.url };
  return {
    transport: 'stdio',
    command: profile.command,
    args: profile.args,
    cwd: profile.cwd,
    env: profile.env,
  };
}

function headersFor(profile: Profile, vault: CredentialVault): Record<string, string> | undefined {
  if (profile.auth.method === 'none' || profile.auth.method === 'oauth') return undefined;
  const secret = vault.getSecret(profile.id);
  if (!secret) return undefined; // no secret stored yet — connect unauthenticated
  return profile.auth.method === 'bearer'
    ? { Authorization: `Bearer ${secret}` }
    : { [profile.auth.headerName]: secret };
}

/**
 * Holds the live MCP sessions (one entry per connect attempt). Multiple
 * simultaneous connections are allowed; a dropped session stays in the map with
 * status "error" / "auth-required" until disconnected or reconnected. An OAuth
 * sign-in shows as a "signing-in" placeholder while the browser flow runs.
 * Latency is sampled at connect time and re-sampled periodically.
 */
export class ConnectionManager {
  private readonly connections = new Map<string, Managed>();

  constructor(
    private readonly repo: ProfileRepository,
    private readonly vault: CredentialVault,
    private readonly pidTracker: StdioPidTracker,
    private readonly tap: ProtocolTap,
    private readonly history: ToolHistoryRepository,
    /** Open a URL in the user's browser (the OAuth authorization redirect). */
    private readonly openExternal: (url: string) => void,
    private readonly onChanged: (summaries: ConnectionSummary[]) => void,
    private readonly onHistoryChanged: () => void,
  ) {
    setInterval(() => void this.pollLatency(), LATENCY_POLL_MS).unref();
  }

  list(): ConnectionSummary[] {
    return [...this.connections.values()].map((m) => m.summary);
  }

  async connect(profileId: string, connectionId: string = randomUUID()): Promise<ConnectionSummary> {
    const profile = this.repo.get(profileId); // throws ProfileNotFoundError if absent
    if (profile.auth.method === 'oauth') return this.connectOAuth(profile, connectionId);
    const connection = await Connection.create(transportConfigFor(profile), {
      clientInfo: CLIENT_INFO,
      headers: headersFor(profile, this.vault),
      onMessage: (direction, message) => this.tap.record(connectionId, direction, message),
    });
    try {
      return await this.finalizeConnection(connectionId, profileId, connection);
    } catch (cause) {
      await connection.close().catch(() => undefined); // don't leak a half-initialised session
      throw cause;
    }
  }

  private async connectOAuth(profile: Profile, connectionId: string): Promise<ConnectionSummary> {
    const { auth } = profile;
    if (auth.method !== 'oauth') throw new Error('connectOAuth called for a non-OAuth profile');
    const redirect = await startLoopbackRedirect();
    const provider = new StudioOAuthClientProvider(
      {
        clientName: 'MCP Studio',
        redirectUrl: redirect.redirectUri,
        ...(auth.scope ? { scope: auth.scope } : {}),
        ...(auth.clientId ? { staticClientId: auth.clientId } : {}),
      },
      {
        load: () => this.vault.getOAuthArtifacts(profile.id),
        save: (artifacts) => this.vault.setOAuthArtifacts(profile.id, artifacts),
        redirectToAuthorization: (url) => {
          // The browser is about to open — show a "signing in" row so the user
          // can see (and cancel) the pending flow.
          this.connections.set(connectionId, {
            connectionId,
            profileId: profile.id,
            redirect,
            summary: {
              connectionId,
              profileId: profile.id,
              transportKind: profile.transport,
              status: 'signing-in',
              serverInfo: null,
              capabilities: { tools: 0, resources: 0, prompts: 0 },
              latencyMs: null,
              latencyHistory: [],
              sessionId: null,
              oauthExpiresAt: null,
              error: null,
            },
          });
          this.emitChanged();
          if (process.env['MCPSTUDIO_OAUTH_AUTOAPPROVE']) {
            // Test hook: auto-approve by following the authorization URL — the
            // test auth server 302s straight to our loopback /callback?code=…,
            // so no browser is opened. (No effect in normal use.)
            void fetch(url.toString(), { redirect: 'follow' }).catch(() => undefined);
          } else {
            this.openExternal(url.toString());
          }
        },
      },
    );
    const config = transportConfigFor(profile);
    let connection: Connection;
    try {
      connection = await Connection.create(config, {
        clientInfo: CLIENT_INFO,
        authProvider: provider,
        onMessage: (direction, message) => this.tap.record(connectionId, direction, message),
      });
    } catch (cause) {
      if (!(cause instanceof PendingAuthError)) {
        redirect.close(); // never used (failed before the redirect) — just tear it down
        throw cause;
      }
      // The authorization redirect has fired (the placeholder is in the map).
      let code: string;
      try {
        ({ code } = await redirect.waitForCallback());
      } catch (callbackError) {
        redirect.close();
        this.markErrored(
          connectionId,
          callbackError instanceof Error ? callbackError.message : 'Sign-in did not complete',
          { authRequired: true },
        );
        throw callbackError;
      }
      try {
        // finishAuth exchanges the code → tokens (persisted via the provider)
        // then connects fresh. If it *also* needs auth, don't loop — bail.
        connection = await cause.finishAuth(code);
      } catch (finishError) {
        redirect.close();
        this.markErrored(connectionId, 'Sign-in failed — please try signing in again', { authRequired: true });
        throw finishError;
      }
    }
    redirect.close(); // idempotent — a successful callback already tore it down
    return this.finalizeConnection(
      connectionId,
      profile.id,
      connection,
      tokenExpiresAt(this.vault.getOAuthArtifacts(profile.id)),
    );
  }

  /** Probe a freshly-connected session, register it, and emit. Replaces any
   *  `signing-in` placeholder for the same connectionId. */
  private async finalizeConnection(
    connectionId: string,
    profileId: string,
    connection: Connection,
    oauthExpiresAt: number | null = null,
  ): Promise<ConnectionSummary> {
    const caps = connection.capabilities;
    const counts = {
      tools: caps?.tools ? (await connection.listTools()).length : 0,
      resources: caps?.resources ? (await connection.listResources()).length : 0,
      prompts: caps?.prompts ? (await connection.listPrompts()).length : 0,
    };
    const latencyMs = await connection.ping().catch(() => null);
    const childPid = connection.childPid;
    if (childPid !== undefined) this.pidTracker.add(childPid, profileId);

    const summary: ConnectionSummary = {
      connectionId,
      profileId,
      transportKind: connection.transportKind,
      status: 'connected',
      serverInfo: connection.serverInfo
        ? { name: connection.serverInfo.name, version: connection.serverInfo.version, title: connection.serverInfo.title }
        : null,
      capabilities: counts,
      latencyMs,
      latencyHistory: latencyMs != null ? [latencyMs] : [],
      sessionId: connection.sessionId ?? null,
      oauthExpiresAt,
      error: null,
    };

    connection.onClose = () => this.markErrored(connectionId, 'Connection closed by the server');
    connection.onError = (cause) =>
      this.markErrored(connectionId, cause.message, { authRequired: cause instanceof UnauthorizedError });
    this.connections.set(connectionId, { connectionId, profileId, connection, childPid, summary });
    this.emitChanged();
    return summary;
  }

  async reconnect(connectionId: string): Promise<ConnectionSummary> {
    const managed = this.connections.get(connectionId);
    if (!managed) throw new Error(`Unknown connection: ${connectionId}`);
    const { profileId } = managed;
    await this.disconnect(connectionId);
    return this.connect(profileId, connectionId);
  }

  async disconnect(connectionId: string): Promise<void> {
    const managed = this.connections.get(connectionId);
    if (!managed) return;
    this.connections.delete(connectionId);
    try {
      managed.redirect?.close(); // cancel a pending OAuth sign-in immediately — no orphan listener
      if (managed.connection) await managed.connection.close();
    } finally {
      if (managed.childPid !== undefined) this.pidTracker.remove(managed.childPid);
      this.tap.forget(connectionId);
      this.emitChanged();
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled([...this.connections.keys()].map((id) => this.disconnect(id)));
  }

  /** Synchronous, last-resort cleanup for app quit: force-kill every tracked stdio child. */
  killAllStdioChildren(): void {
    for (const pid of this.pidTracker.pids()) forceKillTree(pid);
  }

  async listTools(connectionId: string): Promise<ToolDescriptor[]> {
    return (await this.requireConnected(connectionId).listTools()).map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }));
  }

  async callTool(
    connectionId: string,
    toolName: string,
    args?: Record<string, unknown>,
    opts?: {
      /** If `true`, this call mutates server state — attributed in the audit
       *  trail. The renderer computes this from the *effective* tool
       *  annotations (post plugin override); main just stores what it's told.
       *  Independent of {@link opts.caller} (a `caller:'human'` write still
       *  gets the audit flag). */
      write?: boolean;
      /** **M5 C75** — caller attribution. Absent = `'human'` (every M1–M4
       *  caller path; back-compat preserved). `{type:'ai', …}` triggers the
       *  safety boundary below: an effective-write tool call returns
       *  `pendingEnqueued` instead of dispatching to the MCP SDK; the
       *  renderer routes the op to the plugin's pending-changes queue. */
      caller?: ToolCaller;
    },
  ): Promise<ToolCallOutcome> {
    const managed = this.requireManaged(connectionId);
    const connection = this.requireConnected(connectionId);
    const caller: ToolCaller = opts?.caller ?? 'human';
    const startedAt = performance.now();

    // ── M5 C75: AI-write safety boundary ──────────────────────────────────
    // If an AI-attributed caller is invoking what main resolves to an
    // effective-write tool, route to the renderer's plugin pending-store
    // instead of dispatching. The MCP SDK is NOT called; the audit trail
    // records status:'queued' so the operator can see what the agent
    // proposed.
    if (typeof caller === 'object' && caller.type === 'ai') {
      const effective = await this.resolveEffectiveAnnotations(managed, toolName);
      if (isWriteCall(effective)) {
        const durationMs = Math.round(performance.now() - startedAt);
        this.history.add({
          connectionId,
          profileId: managed.profileId,
          serverName: managed.summary.serverInfo?.name ?? null,
          toolName,
          args: args ?? {},
          status: 'queued',
          result: null,
          error: null,
          ts: new Date().toISOString(),
          durationMs,
          write: true,
          actor: caller,
        });
        this.onHistoryChanged();
        return {
          result: null,
          error: null,
          pendingEnqueued: { toolName, args: args ?? {}, attribution: caller },
        };
      }
    }
    // ── End safety boundary ───────────────────────────────────────────────

    let outcome: ToolCallOutcome;
    try {
      outcome = { result: await connection.callTool(toolName, args), error: null };
    } catch (cause) {
      const error =
        cause instanceof McpError
          ? { code: cause.code, message: cause.message, data: cause.data }
          : { message: cause instanceof Error ? cause.message : String(cause) };
      outcome = { result: null, error };
    }
    const durationMs = Math.round(performance.now() - startedAt);
    const status: 'ok' | 'tool-error' | 'error' = outcome.error
      ? 'error'
      : outcome.result?.isError
        ? 'tool-error'
        : 'ok';
    this.history.add({
      connectionId,
      profileId: managed.profileId,
      serverName: managed.summary.serverInfo?.name ?? null,
      toolName,
      args: args ?? {},
      status,
      result: outcome.result,
      error: outcome.error,
      ts: new Date().toISOString(),
      durationMs,
      ...(opts?.write !== undefined ? { write: opts.write } : {}),
      ...(typeof caller === 'object' ? { actor: caller } : {}),
    });
    this.onHistoryChanged();
    return outcome;
  }

  /** Look up the effective (post plugin-override) annotations for one tool on
   *  one connection. Lazily fetches `tools/list` from the server (cached on
   *  `managed`) and merges via the manifest registry. Used by the M5 C75
   *  safety boundary; not exposed externally. */
  private async resolveEffectiveAnnotations(managed: Managed, toolName: string) {
    if (!managed.baseAnnotationsByTool) {
      // First touch — populate the cache from `tools/list`.
      const tools = await this.requireConnected(managed.connectionId).listTools();
      managed.baseAnnotationsByTool = new Map(
        tools.map((t) => [t.name, t.annotations as ToolAnnotations | undefined]),
      );
    }
    const base = managed.baseAnnotationsByTool.get(toolName);
    const manifest = pickManifest(managed.summary.serverInfo?.name);
    return getEffectiveAnnotations(manifest, toolName, base);
  }

  async listResources(connectionId: string): Promise<ResourceDescriptor[]> {
    return (await this.requireConnected(connectionId).listResources()).map((r) => ({
      uri: r.uri,
      name: r.name,
      title: r.title,
      description: r.description,
      mimeType: r.mimeType,
      size: r.size,
    }));
  }

  async listResourceTemplates(connectionId: string): Promise<ResourceTemplateDescriptor[]> {
    const connection = this.requireConnected(connectionId);
    // Many servers advertise `resources` but don't implement
    // `resources/templates/list` — treat that (and any RPC-level error here)
    // as "no templates" rather than failing the whole panel.
    const templates = await connection.listResourceTemplates().catch((cause: unknown) => {
      if (cause instanceof McpError) return [];
      throw cause;
    });
    return templates.map((t) => ({
      uriTemplate: t.uriTemplate,
      name: t.name,
      title: t.title,
      description: t.description,
      mimeType: t.mimeType,
    }));
  }

  async readResource(connectionId: string, uri: string): Promise<ReadResourceResult> {
    return this.requireConnected(connectionId).readResource(uri);
  }

  async listPrompts(connectionId: string): Promise<PromptDescriptor[]> {
    return (await this.requireConnected(connectionId).listPrompts()).map((p) => ({
      name: p.name,
      title: p.title,
      description: p.description,
      arguments: p.arguments?.map((a) => ({ name: a.name, description: a.description, required: a.required })),
    }));
  }

  async getPrompt(connectionId: string, name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    return this.requireConnected(connectionId).getPrompt(name, args);
  }

  async rawRequest(
    connectionId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<RawRequestOutcome> {
    const connection = this.requireConnected(connectionId);
    try {
      return { ok: true, result: await connection.rawRequest(method, params), error: null };
    } catch (cause) {
      const error =
        cause instanceof McpError
          ? { code: cause.code, message: cause.message, data: cause.data }
          : { message: cause instanceof Error ? cause.message : String(cause) };
      return { ok: false, result: null, error };
    }
  }

  private requireManaged(connectionId: string): Managed {
    const managed = this.connections.get(connectionId);
    if (!managed) throw new Error(`Connection ${connectionId} is not available`);
    return managed;
  }

  private requireConnected(connectionId: string): Connection {
    const managed = this.requireManaged(connectionId);
    if (!managed.connection || managed.summary.status !== 'connected') {
      throw new Error(`Connection ${connectionId} is not available`);
    }
    return managed.connection;
  }

  private async pollLatency(): Promise<void> {
    const alive = [...this.connections.values()].filter((m) => m.connection && m.summary.status === 'connected');
    if (alive.length === 0) return;
    let changed = false;
    await Promise.all(
      alive.map(async (managed) => {
        if (!managed.connection) return;
        try {
          const latencyMs = await managed.connection.ping();
          const latencyHistory = [...managed.summary.latencyHistory, latencyMs].slice(-LATENCY_HISTORY_CAP);
          // The SDK refreshes the access token transparently on a 401 (the ping
          // above triggers it once the token expires) and updates the vault —
          // re-read it so the displayed expiry tracks reality.
          const oauthExpiresAt = tokenExpiresAt(this.vault.getOAuthArtifacts(managed.profileId));
          managed.summary = { ...managed.summary, latencyMs, latencyHistory, oauthExpiresAt };
          changed = true;
        } catch (cause) {
          this.markErrored(managed.connectionId, cause instanceof Error ? cause.message : 'Ping failed');
        }
      }),
    );
    if (changed) this.emitChanged();
  }

  private markErrored(connectionId: string, message: string, opts: { authRequired?: boolean } = {}): void {
    const managed = this.connections.get(connectionId);
    if (!managed || managed.summary.status === 'error' || managed.summary.status === 'auth-required') return;
    if (managed.childPid !== undefined) this.pidTracker.remove(managed.childPid);
    managed.summary = { ...managed.summary, status: opts.authRequired ? 'auth-required' : 'error', error: message };
    this.emitChanged();
  }

  private emitChanged(): void {
    this.onChanged(this.list());
  }
}
