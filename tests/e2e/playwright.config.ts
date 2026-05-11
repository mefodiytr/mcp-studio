import { defineConfig } from '@playwright/test';

/**
 * End-to-end suite. There are no browser projects — the only "browser" is the
 * Electron renderer, launched per-test via `_electron.launch` (see app.spec.ts).
 * `pnpm test:e2e` builds the desktop app first (`pretest:e2e`) so `out/` exists.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { trace: 'retain-on-failure' },
});
