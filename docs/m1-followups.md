# M1 follow-ups

Things deliberately scoped out of Milestone 1, with a pointer to where they fit.
Nothing here blocks the M1 deliverable; this is the "we know about it" list.

## Renderer / UI

- **Markdown rendering in the resources preview.** `text/markdown` resources are
  shown as monospace text — a real renderer (e.g. `react-markdown`) is a dep +
  bundle cost not worth it for M1. (`ResourcesBrowser.tsx`)
- **`oneOf` / `anyOf` discriminated-union widget.** schema-form renders these as
  the raw-JSON escape hatch rather than a variant/tag picker. M2 polish.
  (`packages/schema-form`)
- **Per-tab connection binding.** A tab carries an optional `connectionId` in the
  data model, but the UI doesn't expose creating a connection-bound tab yet — each
  view-tab keeps its own connection picker. Needed for "two Tools tabs, two
  servers side by side". (`stores/workspace.ts`, `AppShell.tsx`)
- **View state preserved across tab switches.** Only the active tab's view is
  mounted; switching unmounts it (React Query caching softens the re-fetch).
- **`{{cwd}}` templating token.** Reserved for the Niagara plugin's
  station-explorer cwd — lands with M2. (`lib/templating.ts`)
- **`resources/subscribe`.** Not wired in M1. (`ResourcesBrowser.tsx`)
- **Renderer dep hygiene.** Renderer-only deps (`react`, `cmdk`, `@tanstack/*`,
  `zustand`, …) sit in `apps/desktop` `dependencies` so electron-builder packs
  them even though Vite bundles them at build time — move to `devDependencies` to
  slim the packaged `node_modules`.
- **`apps/desktop/build/`.** Custom app icons + NSIS installer assets — M1 ships
  with Electron's defaults.
- **Packaging not yet verified green on all three OSes.** `electron-builder --dir`
  produces `release/win-unpacked/` locally; the full NSIS build needs the
  `winCodeSign` cache tool which fails to extract on a non-admin Windows box
  (symlinks). `.github/workflows/package.yml` builds the real artifacts on clean
  runners on tag push — confirm it's green and tweak the Windows leg if needed.

## Quality / tooling

- **`mcp-client` coverage floor is low (~lines 55).** Add unit tests for the
  HTTP / SSE transports and the error / disconnect paths, then raise the
  thresholds. (`packages/mcp-client/vitest.config.ts`) — owned by the C23 work,
  to be tightened post-M1.
- **Playwright flow screenshots.** The e2e suite could capture a screenshot at
  each step (add profile → connect → tools → invoke → inspect) to replace the
  static `docs/screenshots/*` shots. (`tests/e2e/`)
- **Job-Object-based stdio hardening.** M1 does graceful-only cleanup + PID
  tracking + orphan reaping (Option A). Re-evaluate native Job Objects around M3.

## Architecture (later milestones, not regressions)

- `packages/ui` extraction (shadcn is vendored in the app for now) — M2 when the
  Niagara plugin needs the same components.
- `packages/plugin-api` + a real command-contribution registry (the M1 command
  palette has an in-shell list with a `when` predicate) — M2.
- better-sqlite3 store (the M1 store is a self-rolled atomic JSON store) — M4.
- OAuth — the "M1.5" mini-milestone between M1 and M2.
