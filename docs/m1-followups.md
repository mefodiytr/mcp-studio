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
- OAuth — **done (M1.5, `v0.1.5-m1.5`).** See `docs/milestone-1.5.md`.

## M1.5 / OAuth follow-ups

Deliberately deferred from M1.5 (`docs/milestone-1.5.md` has the per-commit
rationale). None blocks the milestone; OAuth works end-to-end (the Playwright e2e
covers discovery → DCR → authorize → token exchange → connect → invoke).

- **Proactive refresh at ~80% token lifetime.** M1.5 relies on the SDK's
  transparent refresh-on-401 + the 15 s latency ping — connections stay alive
  seamlessly, but the first request after expiry is a refresh-then-retry rather
  than already-refreshed. A dedicated proactive refresh needs a no-redirect refresh
  path (so it can't pop the browser if the refresh token's been revoked).
  (`ConnectionManager.pollLatency`, `mcp-client`)
- **OAuth round-trips in the protocol inspector.** The `.well-known` discovery,
  DCR `register`, `authorize`, and `token` calls go via `fetch` (not the MCP
  transport), so the C9 tap doesn't see them. The transport accepts a custom
  `fetch` it forwards to the SDK's `auth()`, so it's tappable — needs a new
  protocol-event variant (HTTP, not JSON-RPC) + a tap method + inspector rendering.
- **Hidden-then-surfaced `clientId` field in the wizard.** M1.5 always shows the
  pre-registered-client-ID field for OAuth profiles (with a hint). The plan's UX
  was: hide it until a first connect shows the server has no `registration_endpoint`,
  then surface it inline. Needs a way to thread "this profile needs a client ID"
  from the connect failure to the wizard. (`ProfileWizard`, `ConnectionsView`)
- **Custom URL-scheme redirect (`mcpstudio://`).** M1.5 uses a loopback HTTP
  listener (RFC 8252 §7.3) — fine in dev and packaged, but some corporate
  environments block loopback listeners. A custom-scheme option (`setAsDefaultProtocolClient`
  + `open-url` / `second-instance` argv) is the fallback.
- **RFC 7592 DCR `DELETE` on sign-out.** `oauth:signOut` drops the local token +
  client info but doesn't `DELETE` the dynamically-registered client at the server
  (would need a re-discovery just to clean up; servers expire unused DCR clients).
- **`mcp-client` transport coverage.** The HTTP/SSE transports and the
  disconnect/error paths still want dedicated unit tests; raise the `mcp-client`
  coverage floor (currently 78/60/78/80) when they land.

## niagaramcp-side coordination (other repo — track here, fix there)

Changes needed on **niagaramcp**, not in this repo. Tracked here because they
affect MCP Studio's behaviour against it.

- **Write-tool annotations are wrong.** niagaramcp's write / walkthrough tools
  currently ship `readOnlyHint: true`, `destructiveHint: false` — should be
  `readOnlyHint: false` on all of them and `destructiveHint: true` on the
  create/update tools, especially `bulkCreateEquipment` (and the other bulk ops).
  Studio's `ToolInvocationDialog` gates a confirm step on
  `annotations.destructiveHint`; with the current values the generic Tools-catalog
  path runs those tools with no warning. Relevant to **M3** (write & safety) — the
  Niagara write workflow will lean on these. *(niagaramcp work — not now.)*
- **Slot values come back localized.** `inspectComponent` / `getSlots` return
  display-localized values (e.g. `"поистине"` instead of canonical `true`) — the
  property sheet (C41) and BQL result table (C44) want the canonical form (with
  the localized string available separately for display, if at all). Until fixed,
  the Niagara plugin renders whatever the server sends. *(niagaramcp work.)*
- **`bqlQuery` input format is hostile.** Two warts on the same tool:
  - It requires a fully-qualified ORD prefix on the `query` string —
    `station:|slot:/<path>|bql:select …` — a plain `SELECT …` is rejected.
    niagaramcp should either accept a plain `SELECT` and prepend a default base
    ORD when no prefix is present, or split it into two args (`baseOrd` + `query`).
  - Putting a SQL-style `LIMIT N` *in the query string* silently fails with a
    misleading error: Niagara BQL has no `LIMIT` clause — row-capping is the
    tool's separate `limit` arg (max 1000, default 100) — and the station's BQL
    tokenizer chokes on `limit`, with error-truncation then swallowing everything
    from the type name onward (so the message looks like a type error). niagaramcp
    should either accept `LIMIT N` in the query and translate it to the `limit`
    arg, or validate the query for a stray `limit`/`LIMIT` and return a helpful
    error pointing at the arg.

  The C44 BQL playground papers over both client-side (prepend a default ORD
  prefix; surface `limit` as a dedicated control, never let it into the query
  text), but they're server-side warts. *(niagaramcp work.)*
- **Tool descriptions are partly Russian.** Several niagaramcp tools
  (`bqlQuery`, `listChildren`, `readPoint`, `writePoint`, …) ship Russian-only
  `description` text in their inputSchemas; `getSlots`/`findComponentsByType`/`findPoints`
  have no per-parameter descriptions. Should be English (or properly localized).
  The Niagara plugin's `toolSchemaHints` (C45) overlays English `title` /
  `description` / `examples` for the tools it cares about, but that only covers a
  subset and only in Studio. *(niagaramcp work.)*
- **`rotateMcpToken` coordination** — see `docs/milestone-2.md` D5: the
  BearerResolver / user-Bearer write-auth flow (the `mcp:tokenHash` Tag) is **M3**,
  designed there alongside niagaramcp's token-rotation tool.
