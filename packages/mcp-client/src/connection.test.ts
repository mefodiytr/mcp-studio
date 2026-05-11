import { afterEach, describe, expect, it } from 'vitest';

import { Connection } from './connection';

// Integration test: spawns @modelcontextprotocol/server-everything over stdio
// (the bin is on PATH because it is a devDependency and tests run via pnpm).
// HTTP/SSE transports are exercised in C8 / the e2e suite (C23).
describe('Connection — server-everything over stdio', () => {
  let connection: Connection | undefined;

  afterEach(async () => {
    await connection?.close();
    connection = undefined;
  });

  it('connects, reports server info & capabilities, lists/calls tools, closes cleanly', async () => {
    connection = await Connection.create({
      transport: 'stdio',
      command: 'mcp-server-everything',
      args: ['stdio'],
    });

    expect(connection.serverInfo?.name).toBeTruthy();

    const caps = connection.capabilities;
    expect(caps?.tools).toBeDefined();
    expect(caps?.resources).toBeDefined();
    expect(caps?.prompts).toBeDefined();

    const tools = await connection.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.map((t) => t.name)).toContain('echo');

    const result = await connection.callTool('echo', { message: 'hello, mcp' });
    expect(result.isError ?? false).toBe(false);
    expect(JSON.stringify(result.content)).toContain('hello, mcp');

    expect((await connection.listResources()).length).toBeGreaterThan(0);
    expect((await connection.listPrompts()).length).toBeGreaterThan(0);
  });
});
