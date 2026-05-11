import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // The compiler core is gated; the <SchemaForm> renderer (.tsx) is
      // smoke-tested here and gets interactive coverage with the C15 e2e.
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90 },
    },
  },
});
