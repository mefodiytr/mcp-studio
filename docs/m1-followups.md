# M1 follow-ups

Things deliberately scoped out of Milestone 1, with a pointer to where they fit.
Nothing here blocks the M1 deliverable; this is the "we know about it" list.

## Open before M1 is fully signed off

- **Packaging CI matrix verification pending first push.** Verified locally:
  `electron-builder --dir` produces `apps/desktop/release/win-unpacked/`, and the
  Playwright e2e proves the built app works end-to-end. **Not yet observed:** a
  green `.github/workflows/package.yml` run building unsigned NSIS / dmg / AppImage
  on the three CI runners — the repo has no git remote yet. On the first push of
  `main` + the `v0.1.0-m1` tag the matrix runs; a red leg → 1–2 fix commits on an
  `m1-hotfix` branch, re-tag `v0.1.0-m1.1`. (The local full NSIS build also hits a
  `winCodeSign` cache symlink-permission error on a non-admin Windows box — a
  local issue, not a config one.)

## Renderer / UI

- **Markdown rendering in the resources preview.** `text/markdown` resources are
  shown as monospace text — a real renderer (e.g. `react-markdown`) is a dep +
  bundle cost not worth it for M1. → **M2 polish.** (`ResourcesBrowser.tsx`)
- **`oneOf` / `anyOf` discriminated-union widget.** schema-form renders these as
  the raw-JSON escape hatch rather than a variant/tag picker. → **M2 polish.**
  (`packages/schema-form`)
- **Per-tab connection binding.** A tab carries an optional `connectionId` in the
  data model, but the UI doesn't expose creating a connection-bound tab yet — each
  view-tab keeps its own connection picker. Needed for "two Tools tabs, two
  servers side by side". → **M2 polish.** (`stores/workspace.ts`, `AppShell.tsx`)
- **View state preserved across tab switches.** Only the active tab's view is
  mounted; switching unmounts it (React Query caching softens the re-fetch).
  → **M2 polish.**
- **`{{cwd}}` templating token.** Reserved for the Niagara plugin's
  station-explorer cwd. → **M2 (from the start).** (`lib/templating.ts`)
- **`resources/subscribe`.** Not wired in M1. (`ResourcesBrowser.tsx`)
- **Renderer dep hygiene.** Renderer-only deps (`react`, `cmdk`, `@tanstack/*`,
  `zustand`, …) sit in `apps/desktop` `dependencies` so electron-builder packs
  them even though Vite bundles them at build time — move to `devDependencies` to
  slim the packaged `node_modules`. → **anytime, not tied to a milestone.**
- **`apps/desktop/build/`.** Custom app icons + NSIS installer assets — M1 ships
  with Electron's defaults.

## Quality / tooling

- **`mcp-client` coverage floor is low (~lines 55).** Add unit tests for the
  HTTP / SSE transports and the error / disconnect paths, then raise the
  thresholds. (`packages/mcp-client/vitest.config.ts`) The ratchet pattern —
  fix the regression filter now, raise the bar as tests accrue — is the policy
  for every package (see master-spec §13).
- **Playwright flow screenshots.** The e2e suite could capture a screenshot at
  each step (add profile → connect → tools → invoke → inspect) to replace the
  static `docs/screenshots/*` shots. (`tests/e2e/`)
- **Job-Object-based stdio hardening.** M1 does graceful-only cleanup + PID
  tracking + orphan reaping (Option A). → **re-evaluate native Job Objects ~M3
  (or earlier if it bites).**

## Architecture (later milestones, not regressions)

- `packages/ui` extraction (shadcn is vendored in the app for now). → **M2 (from
  the start), when the Niagara plugin needs the same components.**
- `packages/plugin-api` + a real command-contribution registry (the M1 command
  palette has an in-shell list with a `when` predicate). → **M2 (first commit),
  so the Niagara plugin starts on a finished contract.**
- better-sqlite3 store (the M1 store is a self-rolled atomic JSON store). → **M4.**
- OAuth. → **M1.5 — the mini-milestone between M1 and M2.**
