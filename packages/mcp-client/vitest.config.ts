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
      // A regression floor that ratchets up as tests accrue (master-spec §13).
      // `Connection`'s happy path is the integration test here; `oauth.ts` is
      // unit-tested; the OAuth-error paths in connection.ts are exercised by the
      // Playwright e2e (not by mcp-client unit coverage), so `functions` stays
      // at 60. The HTTP/SSE transports + the disconnect paths still want
      // dedicated unit tests — raise the rest again then.
      thresholds: { lines: 78, functions: 60, statements: 78, branches: 80 },
    },
  },
});
