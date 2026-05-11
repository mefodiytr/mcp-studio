import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type {
  CallToolResult,
  GetPromptResult,
  Implementation,
  Prompt,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  ServerCapabilities,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

export type TransportConfig =
  | { transport: 'http'; url: string }
  | { transport: 'sse'; url: string }
  | { transport: 'stdio'; command: string; args?: string[]; cwd?: string; env?: Record<string, string> };

export interface ConnectionOptions {
  /** Identifies this client to the server (initialize handshake). */
  clientInfo?: Implementation;
  /** Extra HTTP headers (auth etc.) for the http/sse transports. */
  headers?: Record<string, string>;
}

const DEFAULT_CLIENT_INFO: Implementation = { name: 'mcp-studio', version: '0.1.0' };

function createTransport(config: TransportConfig, options: ConnectionOptions): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        cwd: config.cwd,
        env: config.env ? { ...getDefaultEnvironment(), ...config.env } : undefined,
      });
    case 'http':
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: options.headers ? { headers: options.headers } : undefined,
      });
    case 'sse':
      return new SSEClientTransport(new URL(config.url), {
        requestInit: options.headers ? { headers: options.headers } : undefined,
      });
  }
}

const CLOSE_TIMEOUT_MS = 2_000;

/**
 * A live MCP session: wraps an SDK `Client` plus its transport. Transport-
 * agnostic (HTTP / SSE / stdio). The main process owns these; the renderer
 * never touches the SDK directly.
 */
export class Connection {
  private constructor(
    private readonly client: Client,
    private readonly transport: Transport,
    /** Which transport this connection is using. */
    readonly transportKind: TransportConfig['transport'],
  ) {}

  /** Build the transport, create the client, run the initialize handshake. */
  static async create(config: TransportConfig, options: ConnectionOptions = {}): Promise<Connection> {
    const client = new Client(options.clientInfo ?? DEFAULT_CLIENT_INFO, { capabilities: {} });
    const transport = createTransport(config, options);
    await client.connect(transport);
    return new Connection(client, transport, config.transport);
  }

  /** PID of the spawned server, for stdio connections (else undefined). */
  get childPid(): number | undefined {
    return this.transport instanceof StdioClientTransport ? this.transport.pid ?? undefined : undefined;
  }

  /** Round-trip latency of an MCP `ping`, in milliseconds. */
  async ping(): Promise<number> {
    const startedAt = performance.now();
    await this.client.ping();
    return performance.now() - startedAt;
  }

  /** The server's reported implementation (name/version), once connected. */
  get serverInfo(): Implementation | undefined {
    return this.client.getServerVersion();
  }

  /** The capabilities the server advertised during initialize. */
  get capabilities(): ServerCapabilities | undefined {
    return this.client.getServerCapabilities();
  }

  /** Server-supplied usage instructions, if any. */
  get instructions(): string | undefined {
    return this.client.getInstructions();
  }

  async listTools(): Promise<Tool[]> {
    return (await this.client.listTools()).tools;
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    // The SDK's default return is the compat union (`content` | legacy
    // `toolResult`); we only support the modern `content` shape, so validate
    // down to it.
    return CallToolResultSchema.parse(await this.client.callTool({ name, arguments: args }));
  }

  async listResources(): Promise<Resource[]> {
    return (await this.client.listResources()).resources;
  }

  async listResourceTemplates(): Promise<ResourceTemplate[]> {
    return (await this.client.listResourceTemplates()).resourceTemplates;
  }

  async readResource(uri: string): Promise<ReadResourceResult> {
    return this.client.readResource({ uri });
  }

  async listPrompts(): Promise<Prompt[]> {
    return (await this.client.listPrompts()).prompts;
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    return this.client.getPrompt({ name, arguments: args });
  }

  set onClose(callback: (() => void) | undefined) {
    this.client.onclose = callback;
  }

  set onError(callback: ((error: Error) => void) | undefined) {
    this.client.onerror = callback;
  }

  /** Close the session. Races a timeout; if a stdio child ignores the graceful
   *  shutdown it is force-killed. */
  async close(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), CLOSE_TIMEOUT_MS);
    });
    try {
      const outcome = await Promise.race([this.client.close().then(() => 'closed' as const), timeout]);
      if (outcome === 'timeout' && this.childPid !== undefined) {
        try {
          process.kill(this.childPid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
