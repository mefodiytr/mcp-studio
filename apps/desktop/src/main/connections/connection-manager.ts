import { randomUUID } from 'node:crypto';

import { Connection, McpError, type TransportConfig } from '@mcp-studio/mcp-client';

import type { ConnectionSummary, ToolDescriptor } from '../../shared/domain/connection';
import type { Profile } from '../../shared/domain/profile';
import type {
  ReadResourceResult,
  ResourceDescriptor,
  ResourceTemplateDescriptor,
} from '../../shared/domain/resource';
import type { RawRequestOutcome, ToolCallOutcome } from '../../shared/domain/tool-result';
import type { CredentialVault } from '../store/credential-vault';
import type { ProfileRepository } from '../store/profile-repository';
import type { ToolHistoryRepository } from '../store/tool-history-repository';
import { forceKillTree, type StdioPidTracker } from './pid-tracker';
import type { ProtocolTap } from './protocol-tap';

const LATENCY_HISTORY_CAP = 20;
const LATENCY_POLL_MS = 15_000;

interface Managed {
  connectionId: string;
  profileId: string;
  connection: Connection;
  childPid?: number;
  summary: ConnectionSummary;
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
  if (profile.auth.method === 'none') return undefined;
  const secret = vault.getSecret(profile.id);
  if (!secret) return undefined; // no secret stored yet — connect unauthenticated
  return profile.auth.method === 'bearer'
    ? { Authorization: `Bearer ${secret}` }
    : { [profile.auth.headerName]: secret };
}

/**
 * Holds the live MCP sessions (one entry per connect attempt). Multiple
 * simultaneous connections are allowed; a dropped session stays in the map with
 * status "error" until disconnected or reconnected. Latency is sampled at
 * connect time and re-sampled periodically (per-request timing is the protocol
 * tap, C9).
 */
export class ConnectionManager {
  private readonly connections = new Map<string, Managed>();

  constructor(
    private readonly repo: ProfileRepository,
    private readonly vault: CredentialVault,
    private readonly pidTracker: StdioPidTracker,
    private readonly tap: ProtocolTap,
    private readonly history: ToolHistoryRepository,
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
    const connection = await Connection.create(transportConfigFor(profile), {
      clientInfo: { name: 'mcp-studio', version: '0.1.0' },
      headers: headersFor(profile, this.vault),
      onMessage: (direction, message) => this.tap.record(connectionId, direction, message),
    });

    try {
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
          ? {
              name: connection.serverInfo.name,
              version: connection.serverInfo.version,
              title: connection.serverInfo.title,
            }
          : null,
        capabilities: counts,
        latencyMs,
        latencyHistory: latencyMs != null ? [latencyMs] : [],
        sessionId: connection.sessionId ?? null,
        error: null,
      };

      connection.onClose = () => this.markErrored(connectionId, 'Connection closed by the server');
      connection.onError = (cause) => this.markErrored(connectionId, cause.message);
      this.connections.set(connectionId, { connectionId, profileId, connection, childPid, summary });
      this.emitChanged();
      return summary;
    } catch (cause) {
      // Don't leak a half-initialised session (e.g. an stdio child).
      await connection.close().catch(() => undefined);
      throw cause;
    }
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
      await managed.connection.close();
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
    return (await this.requireConnected(connectionId).connection.listTools()).map((tool) => ({
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
  ): Promise<ToolCallOutcome> {
    const managed = this.requireConnected(connectionId);
    const startedAt = performance.now();
    let outcome: ToolCallOutcome;
    try {
      outcome = { result: await managed.connection.callTool(toolName, args), error: null };
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
    });
    this.onHistoryChanged();
    return outcome;
  }

  async listResources(connectionId: string): Promise<ResourceDescriptor[]> {
    return (await this.requireConnected(connectionId).connection.listResources()).map((r) => ({
      uri: r.uri,
      name: r.name,
      title: r.title,
      description: r.description,
      mimeType: r.mimeType,
      size: r.size,
    }));
  }

  async listResourceTemplates(connectionId: string): Promise<ResourceTemplateDescriptor[]> {
    const connection = this.requireConnected(connectionId).connection;
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
    return this.requireConnected(connectionId).connection.readResource(uri);
  }

  async rawRequest(
    connectionId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<RawRequestOutcome> {
    const connection = this.requireConnected(connectionId).connection;
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

  private requireConnected(connectionId: string): Managed {
    const managed = this.connections.get(connectionId);
    if (!managed || managed.summary.status !== 'connected') {
      throw new Error(`Connection ${connectionId} is not available`);
    }
    return managed;
  }

  private async pollLatency(): Promise<void> {
    const alive = [...this.connections.values()].filter((m) => m.summary.status === 'connected');
    if (alive.length === 0) return;
    let changed = false;
    await Promise.all(
      alive.map(async (managed) => {
        try {
          const latencyMs = await managed.connection.ping();
          const latencyHistory = [...managed.summary.latencyHistory, latencyMs].slice(-LATENCY_HISTORY_CAP);
          managed.summary = { ...managed.summary, latencyMs, latencyHistory };
          changed = true;
        } catch (cause) {
          this.markErrored(managed.connectionId, cause instanceof Error ? cause.message : 'Ping failed');
        }
      }),
    );
    if (changed) this.emitChanged();
  }

  private markErrored(connectionId: string, message: string): void {
    const managed = this.connections.get(connectionId);
    if (!managed || managed.summary.status === 'error') return;
    if (managed.childPid !== undefined) this.pidTracker.remove(managed.childPid);
    managed.summary = { ...managed.summary, status: 'error', error: message };
    this.emitChanged();
  }

  private emitChanged(): void {
    this.onChanged(this.list());
  }
}
