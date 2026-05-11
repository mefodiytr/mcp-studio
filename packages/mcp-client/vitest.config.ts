import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The integration test spawns @modelcontextprotocol/server-everything.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
