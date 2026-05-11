import { randomUUID } from 'node:crypto';

import { Connection, type TransportConfig } from '@mcp-studio/mcp-client';

import type { ConnectionSummary, ToolSummary } from '../../shared/domain/connection';
import type { Profile } from '../../shared/domain/profile';
import type { CredentialVault } from '../store/credential-vault';
import type { ProfileRepository } from '../store/profile-repository';
import { forceKillTree, type StdioPidTracker } from './pid-tracker';

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
 * status "error" until disconnected or reconnected. Latency is sampled once at
 * connect time (per-request timing arrives with the protocol tap in C9).
 */
export class ConnectionManager {
  private readonly connections = new Map<string, Managed>();

  constructor(
    private readonly repo: ProfileRepository,
    private readonly vault: CredentialVault,
    private readonly pidTracker: StdioPidTracker,
    private readonly onChanged: (summaries: ConnectionSummary[]) => void,
  ) {}

  list(): ConnectionSummary[] {
    return [...this.connections.values()].map((m) => m.summary);
  }

  async connect(profileId: string, connectionId: string = randomUUID()): Promise<ConnectionSummary> {
    const profile = this.repo.get(profileId); // throws ProfileNotFoundError if absent
    const connection = await Connection.create(transportConfigFor(profile), {
      clientInfo: { name: 'mcp-studio', version: '0.1.0' },
      headers: headersFor(profile, this.vault),
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

  async listTools(connectionId: string): Promise<ToolSummary[]> {
    const managed = this.connections.get(connectionId);
    if (!managed || managed.summary.status !== 'connected') {
      throw new Error(`Connection ${connectionId} is not available`);
    }
    return (await managed.connection.listTools()).map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
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
