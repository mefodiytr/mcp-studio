import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The integration test spawns @modelcontextprotocol/server-everything.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'], // re-exports only
      // A regression floor, not an aspiration: the happy path of `Connection`
      // is covered by the integration test here (and end-to-end by the
      // Playwright suite); the HTTP/SSE transports and the error/disconnect
      // paths still want dedicated unit tests — raise these when they land.
      thresholds: { lines: 55, functions: 40, statements: 55, branches: 50 },
    },
  },
});
