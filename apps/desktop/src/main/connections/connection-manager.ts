import { randomUUID } from 'node:crypto';

import { Connection, type TransportConfig } from '@mcp-studio/mcp-client';

import type { ConnectionSummary, ToolSummary } from '../../shared/domain/connection';
import type { Profile } from '../../shared/domain/profile';
import type { CredentialVault } from '../store/credential-vault';
import type { ProfileRepository } from '../store/profile-repository';

interface Managed {
  connectionId: string;
  profileId: string;
  connection: Connection;
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
 * Holds the live MCP sessions (one per successful connect). Multiple
 * simultaneous connections are allowed. Minimal for now — the richer
 * connection-inspector model (latency, status history, reconnect) lands in
 * C8 / C11; this is the proof-of-life slice.
 */
export class ConnectionManager {
  private readonly connections = new Map<string, Managed>();

  constructor(
    private readonly repo: ProfileRepository,
    private readonly vault: CredentialVault,
    private readonly onChanged: (summaries: ConnectionSummary[]) => void,
  ) {}

  list(): ConnectionSummary[] {
    return [...this.connections.values()].map((m) => m.summary);
  }

  async connect(profileId: string): Promise<ConnectionSummary> {
    const profile = this.repo.get(profileId); // throws ProfileNotFoundError if absent
    const connection = await Connection.create(transportConfigFor(profile), {
      clientInfo: { name: 'mcp-studio', version: '0.1.0' },
      headers: headersFor(profile, this.vault),
    });

    const caps = connection.capabilities;
    const counts = {
      tools: caps?.tools ? (await connection.listTools()).length : 0,
      resources: caps?.resources ? (await connection.listResources()).length : 0,
      prompts: caps?.prompts ? (await connection.listPrompts()).length : 0,
    };

    const connectionId = randomUUID();
    const summary: ConnectionSummary = {
      connectionId,
      profileId,
      transportKind: connection.transportKind,
      serverInfo: connection.serverInfo
        ? {
            name: connection.serverInfo.name,
            version: connection.serverInfo.version,
            title: connection.serverInfo.title,
          }
        : null,
      capabilities: counts,
    };

    connection.onClose = () => this.drop(connectionId);
    connection.onError = () => this.drop(connectionId);
    this.connections.set(connectionId, { connectionId, profileId, connection, summary });
    this.emitChanged();
    return summary;
  }

  async disconnect(connectionId: string): Promise<void> {
    const managed = this.connections.get(connectionId);
    if (!managed) return;
    this.connections.delete(connectionId);
    try {
      await managed.connection.close();
    } finally {
      this.emitChanged();
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled([...this.connections.keys()].map((id) => this.disconnect(id)));
  }

  async listTools(connectionId: string): Promise<ToolSummary[]> {
    const managed = this.connections.get(connectionId);
    if (!managed) throw new Error(`Unknown connection: ${connectionId}`);
    return (await managed.connection.listTools()).map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  private drop(connectionId: string): void {
    if (this.connections.delete(connectionId)) this.emitChanged();
  }

  private emitChanged(): void {
    this.onChanged(this.list());
  }
}
