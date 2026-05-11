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
      // `Connection`'s happy path is the integration test here (+ the Playwright
      // e2e); `oauth.ts` is unit-tested; the HTTP/SSE transports and the
      // error/disconnect paths still want dedicated tests — raise again then.
      thresholds: { lines: 75, functions: 60, statements: 75, branches: 75 },
    },
  },
});
