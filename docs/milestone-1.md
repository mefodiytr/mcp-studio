# Milestone 1 — Foundation — implementation plan

> Master spec: [`master-spec.md`](./master-spec.md). M1 kickoff decisions: `master-spec.md` §14 → "Resolved in M1 kickoff".
> **Deliverable:** a universal MCP client that works with any compliant server (HTTP + stdio transports; Bearer / custom-header / no auth). OAuth is deferred to an "M1.5" mini-milestone right after M1.

24 atomic commits in 7 phases + a pre-C1 docs commit. Every commit builds and passes CI on its own. Conventional-commits prefixes. `server-everything` = the official `@modelcontextprotocol/server-everything` package, used as a live reference server in tests instead of a hand-rolled mock.

---

## Phase 0 — Skeleton & tooling

### Step 0 — `docs: master spec, M1 plan, archived prototypes` *(pre-C1)*
`git init` (branch `main`), `.gitignore`, `LICENSE` (Proprietary / All Rights Reserved). `docs/master-spec.md` = the product plan verbatim + a "Resolved in M1 kickoff" subsection in §14. `docs/milestone-1.md` = this file. `prototypes/` = copies of the Flask-era PoCs (`mcp_app.py`, `mcp_console.py`) + a README noting they are research-phase, not source of truth. Originals in `C:\MCP` are left untouched.
**AC:** repo exists with a clean first commit; spec + plan + prototypes are in git history.

### C1 — `chore: monorepo bootstrap`
pnpm workspace (`pnpm-workspace.yaml`), root `package.json` (scripts: `dev` / `build` / `lint` / `typecheck` / `test`), `tsconfig.base.json`, ESLint flat config + Prettier + EditorConfig, `.nvmrc` / `engines`, GitHub Actions workflow (install → lint → typecheck).
**AC:** fresh clone → `pnpm i && pnpm lint && pnpm typecheck` green; CI passes on PR; no app code yet.

### C2 — `feat(desktop): Electron + Vite + React + TS shell`
`apps/desktop` via electron-vite: `src/main` (window lifecycle, single-instance lock), `src/preload` (empty contextBridge stub), `src/renderer` (React 18 + TS, "MCP Studio" placeholder). HMR working.
**AC:** `pnpm dev` opens a window showing the shell; editing a renderer file hot-reloads; editing main restarts; `pnpm build` produces an unpacked app dir.

### C3 — `feat(desktop): design system & app chrome`
Tailwind + shadcn/ui init (components vendored into `renderer/components/ui` — see Δ6), CSS token layer, dark/light/system theme switch persisted, base layout: left rail (profile-switcher placeholder), main pane with tab-strip placeholder, bottom status bar, command-palette mount point, Lucide icons. i18next wired, English-only strings.
**AC:** app renders the three-zone layout; theme toggle works and survives restart; lint/typecheck green.

> **Check-in here:** screenshot of the running app + `git log --oneline` (4 commits: Step 0 + C1 + C2 + C3), before moving into MCP logic.

---

## Phase 1 — Process boundary & persistence

### C4 — `feat: typed IPC layer`
`apps/desktop/src/shared/` with channel contracts (request/response + main→renderer events), preload exposes one typed `window.studio` bridge, a renderer `ipc` client, a `ping` round-trip + a demo event stream. Zod-validated payloads at the boundary.
**AC:** renderer calls `studio.ping()` → typed response; subscribing to the demo channel receives ticks; TS errors on channel/payload mismatch; unit test for the contract layer.

### C5 — `feat: workspace & config persistence`
`electron-store` for app config (theme, last workspace, feature flags). Workspace store (pure-JS — lowdb-style JSON) with a `profiles` collection + migration scaffold. Repository module in main, exposed via IPC. No secrets here. `// TODO(M4): migrate to better-sqlite3`.
**AC:** profile CRUD via IPC survives restart; migration runner runs on startup; store file lands in `app.getPath('userData')`; unit tests for the repository.

### C6 — `feat: credential vault`
Credentials (Bearer tokens, header values) stored via `safeStorage` keyed by profile id; only fingerprints returned to renderer; token shown once on creation.
**AC:** saving a profile with a token persists it encrypted; renderer can never read the raw secret (only `••••1234`); deleting the profile purges the secret.

---

## Phase 2 — MCP client core

### C7 — `feat(mcp-client): SDK wrapper package`
`packages/mcp-client` wrapping `@modelcontextprotocol/sdk`: a `Connection` object (connect/initialize handshake, negotiated protocol version, server info, capabilities), typed `listTools` / `callTool` / `listResources` / `readResource` / `listPrompts` / `getPrompt`, lifecycle events (`connected` / `closed` / `error` / `notification`). Transport-agnostic.
**AC:** against `server-everything` over HTTP: connect → capabilities populated; `listTools` returns typed results; clean `close()`; Vitest integration test (server spawned in the test).

### C8 — `feat: HTTP transport + connection manager`
Streamable HTTP transport adapter (+ SSE-legacy fallback if cheap) wired into `mcp-client`. Main-process `ConnectionManager` holding live connections keyed by profile id, exposed via IPC (connect/disconnect/status). Multiple simultaneous connections.
**stdio lifecycle hardening** (part of "full" C8, not a separate commit): (1) graceful-exit cleanup — synchronous force-kill of tracked stdio children on quit (`taskkill /F /T` on Windows; SIGKILL elsewhere) on `before-quit` + SIGINT/SIGTERM → `app.quit()`; (2) `Connection.close()` races a ~2 s timeout → force-kills a stdio child that ignores graceful shutdown; (3) `StdioPidTracker` — records child PIDs in `userData/active-pids.json` so a hard crash that bypassed (1) is *detected* (orphans reported in a console warning) on the next launch. Job-object-based hard-crash *survival* is intentionally out of M1 scope (needs a native addon — the better-sqlite3-style cost we deliberately avoid in the foundation); **re-evaluate at ~M3**, when write-tool batches mean long sessions and the orphan rate becomes visible. (The HTTP transport is wired; a streamableHttp integration test against server-everything lands with the reference-server fixture in C23.)
**AC:** connect two profiles at once; status events stream to renderer; disconnect cleans up; reconnect works; latency sampled at connect time (per-request timing arrives with the protocol tap in C9).

### C9 — `feat: protocol event tap`
Every JSON-RPC request/response/notification (+ HTTP-level errors) emitted on an IPC event channel with `{connectionId, direction, method, id, ts, durationMs, payload}`; ring-buffered in main (configurable cap).
**AC:** any operation produces matched request/response events in the buffer; buffer respects the cap; renderer fetches the backlog on subscribe.

---

## Phase 3 — Connection management UI

### C10 — `feat: connection wizard & profile CRUD UI`
Add-server wizard: transport (HTTP, stdio), URL / command, auth (none / Bearer / custom header — OAuth is M1.5), TLS-insecure opt-in with a reason field. Profiles list with tags (env / project), edit, duplicate, delete. React Query for the profile list.
**AC:** create a profile via the wizard → appears in the rail; edit/delete work; validation blocks bad URLs; secrets go through the vault (C6).

### C11 — `feat: connect flow & connection inspector`
Connect/disconnect from the rail; connection inspector panel: live status, latency sparkline, session id, negotiated protocol version, capabilities counts (tools/resources/prompts). Error surface: known MCP error codes → message + suggestion + "view raw" toggle; toasts for transient.
**AC:** connect to `server-everything` → inspector shows real counts; kill the server → status flips to error with a useful message; reconnect restores; the raw-response toggle shows the JSON envelope.

---

## Phase 4 — schema-form package + tool invocation

### C12 — `feat(schema-form): JSON Schema → form generator (core)`
`packages/schema-form`: compiles a JSON Schema (draft 2020-12 subset MCP servers emit) to a react-hook-form config + a zod validator; objects, arrays, enums, oneOf/anyOf (discriminated where possible), required, defaults, `format` hints.
**AC:** snapshot tests over a corpus of real MCP tool input schemas (filesystem, everything, niagaramcp) produce valid forms; invalid input rejected by the generated zod; >90% line coverage on the package.

### C13 — `feat(schema-form): widget set & rendering`
Renderer-side `<SchemaForm>` using shadcn inputs: string/number (min/max → slider when bounded), boolean toggle, enum select, array add/remove, nested object groups, textarea for long strings, JSON escape-hatch widget for `additionalProperties`/unknown shapes. Inline validation errors.
**AC:** rendering the C12 corpus in a dev harness produces usable forms; submitting yields a value that round-trips through the zod validator; unknown schema → graceful raw-JSON editor, no crash.

### C14 — `feat: tools catalog`
Tools list per connection: search, filter by annotations (readOnly/destructive/idempotent) and category, schema viewer (collapsible JSON + human view), last-call timestamp (from history once C16 lands — "—" until then). React Query keyed by `(connectionId, 'tools')`.
**AC:** catalog lists every tool from `server-everything` with descriptions; search narrows; clicking a tool opens its detail; annotation badges render.

### C15 — `feat: tool invocation & result viewer`
Tool detail = `<SchemaForm>` over the input + "Call" → `callTool` via IPC; result viewer: structured content as table/tree, text content with syntax highlight, images, embedded resources; tool errors shown with `code` / `message` / `data` expansion; destructive-annotated tools get an automatic confirm dialog.
**AC:** invoke an echo/add tool on `server-everything` → typed result; invoke a failing tool → structured error display; a `destructiveHint` tool prompts before running; the raw JSON-RPC for the call is one click away.

### C16 — `feat: tool call history`
Persist every invocation `{connectionId, tool, args, result|error, ts, durationMs}` (store from C5); history panel with filter/search; actions: re-run, edit-and-rerun (prefills the form), copy as JSON-RPC. Feeds the "last-call timestamp" into C14.
**AC:** invocations appear in history immediately and after restart; re-run reproduces; edit-and-rerun opens the form prefilled; filtering by tool/status works.

### C17 — `feat: argument templating & raw JSON-RPC console`
Template substitution in tool args: `{{cwd}}`, `{{lastResult.<path>}}`, `{{prompt:Label}}` (modal at call time); per-tool "recall last args". Plus a raw JSON-RPC pass-through console (pick method, edit params JSON, send, see envelope).
**AC:** a tool arg `{{lastResult.id}}` resolves from the previous call; `{{prompt:...}}` pops a modal; recall restores the last arg set; the raw console can send an arbitrary `tools/list` and show the response.

---

## Phase 5 — Resources & Prompts

### C18 — `feat: resources browser`
Static resources + resource templates per connection; list with URI/MIME/description; preview pane: JSON (collapsible), Markdown (rendered), images, text (highlighted), binary (download/hex); template-param form (reuse `<SchemaForm>` over the template's `{vars}`). `resources/subscribe` left as a no-op stub.
**AC:** browse `server-everything` resources; preview renders by MIME; a templated resource prompts for its variables then resolves; "view raw" shows the `resources/read` envelope.

### C19 — `feat: prompts library`
Declared prompts list; parameter form (`<SchemaForm>` over prompt arguments); "preview" runs `prompts/get` and renders the resulting message stream (role-tagged bubbles, text + embedded resources).
**AC:** list prompts from `server-everything`; fill a prompt's args → preview shows the assembled messages; missing required args block preview with inline errors.

---

## Phase 6 — Observability, command palette, tabs

### C20 — `feat: protocol inspector panel`
Dockable bottom panel fed by the C9 event tap: live JSON-RPC stream, columns (ts, conn, dir, method, status, dur), filter by method/status/duration/connection, click a row → request + response side-by-side, pause/resume, clear, export selection as JSON. Toggle with `Ctrl+\``.
**AC:** opening the panel shows live traffic while you click around; filters work; a row expands to the full envelope; export produces a valid JSON file.

### C21 — `feat: command palette`
`cmdk`-based palette (`Ctrl+K`): a registry where views contribute commands; built-ins (connect/disconnect profile, open tools/resources/prompts/inspector, switch theme, new raw-RPC console, run last tool). Fuzzy search, recents, keyboard-only.
**AC:** `Ctrl+K` opens; typing "tools" finds "Open Tools catalog"; selecting it switches view; a view-contributed command appears only when that view's context is active; ESC closes.

### C22 — `feat: multi-tab workspace shell`
Tab strip: each tab is a view instance (catalog, tool detail, resources, prompts, raw console) optionally bound to a connection; open/close/reorder/pin; layout persisted per workspace. Zustand owns tab/layout state; server data stays in React Query.
**AC:** open three tabs across two connections, reorder, close one, restart → tabs restored; closing the last tab shows the workspace empty state.

---

## Phase 7 — Hardening & deliverable

### C23 — `test: e2e + unit coverage + reference-server harness`
Playwright e2e against `@modelcontextprotocol/server-everything` (+ a stdio server, since stdio is in M1 scope): launch app → add profile → connect → list tools → invoke → assert result → open inspector → see envelope. Vitest coverage gate for `mcp-client` and `schema-form`. CI runs lint + typecheck + unit + e2e on PR.
**AC:** `pnpm test` green locally and in CI; e2e covers the connect → invoke → inspect happy path; coverage thresholds enforced; flake-free over 3 CI runs.

### C24 — `chore: packaging smoke + docs`
`electron-builder.yml` producing an unsigned artifact per OS (CI matrix, no signing/notarization), `README` (what it is, `pnpm dev`, `pnpm build`), `CONTRIBUTING`. Tag `v0.1.0-m1`.
Also: **resolve the hoisted-vs-isolated node_modules question for electron-builder** — `.npmrc` carries `node-linker=hoisted` (set in C1) but pnpm 11 has been building the isolated layout in practice; electron-builder typically wants a hoisted/flat `node_modules` for the unpacked app, so settle this here (force `nodeLinker: hoisted` in `pnpm-workspace.yaml`, or use `public-hoist-pattern` / electron-builder's pnpm handling) and say so explicitly in the commit message.
**AC:** CI uploads an unsigned installer/AppImage/dmg; a teammate can `pnpm i && pnpm dev` from the README alone; the M1 deliverable claim is demonstrable via the e2e run; the hoisted/isolated tension is resolved and noted.

> Split candidates if they grow during implementation: C12/C13 (schema-form), C15 (result viewer: structured vs text vs media). The C8 SSE-legacy fallback can be its own commit.

---

## Repository layout (M1)

Follows spec §11 with the deviations below (Δ1–Δ8). New standalone git repo — **not** `C:\MCP` (Python PoCs are research-phase, kept out of product git history; archived under `prototypes/`).

```
mcp-studio/
├── package.json                     # workspaces root, scripts
├── pnpm-workspace.yaml  pnpm-lock.yaml  tsconfig.base.json
├── eslint.config.js  .prettierrc  .editorconfig  .gitignore  .nvmrc
├── .github/workflows/ci.yml
├── README.md  CONTRIBUTING.md  LICENSE
├── docs/                            # ← plain markdown, NOT docusaurus  [Δ1]
│   ├── master-spec.md  milestone-1.md
├── apps/
│   └── desktop/                     # the only app in M1  [Δ1: no apps/docs]
│       ├── package.json
│       ├── electron.vite.config.ts  # electron-vite  [Δ4]
│       ├── electron-builder.yml
│       ├── build/                   # icons, entitlements, NSIS  [Δ7]
│       └── src/
│           ├── main/                # window, ConnectionManager, stores, vault, IPC handlers
│           ├── preload/             # contextBridge bridge
│           ├── shared/              # ← IPC contracts + cross-process types  [Δ3]
│           └── renderer/
│               ├── app/             # shell, routing, theme, layout
│               ├── features/        # ← was §11 "core/": connections / tools / resources / prompts / inspector / raw-rpc  [Δ5]
│               ├── components/       # shared UI incl. components/ui (vendored shadcn)  [Δ6]
│               ├── stores/           # Zustand: tabs, layout, selection
│               ├── lib/             # React Query client, ipc client, formatters
│               └── plugins/         # plugin-loader stub — populated in M2 (kept per §11, empty for now)
├── packages/
│   ├── mcp-client/                  # @modelcontextprotocol/sdk wrapper + transports
│   ├── schema-form/                 # JSON Schema → react-hook-form/zod
│   └── plugin-api/                  # plugin contract types — created now so M2 has a stable target
│                                    #  [Δ6: packages/ui NOT created yet — shadcn vendored in app until M2]
├── plugins/                         # .gitkeep only; niagara lands in M2  [Δ2]
└── tests/
    ├── e2e/                         # Playwright
    └── fixtures/
        └── reference-server/        # thin launcher around @modelcontextprotocol/server-everything  [Δ8]
```

### Deviations from §11

| # | Deviation | Rationale |
|---|---|---|
| Δ1 | No `apps/docs/` (docusaurus) — root `docs/*.md` instead | Zero value for the foundation; extra build/dep surface. M8 explicitly owns the help system. |
| Δ2 | No `plugins/filesystem/`, `plugins/github/` stubs | Empty workspace packages break/confuse the pnpm resolver; they're "future" per §11. `plugins/` kept with a `.gitkeep`; `niagara/` arrives in M2. |
| Δ3 | Added `apps/desktop/src/shared/` (IPC contracts + cross-process types) | §11 implicitly scatters this between `src/main` and `src/renderer/lib`; a single shared dir prevents duplication and a renderer→main import. Promote to `packages/ipc` only if a second app appears. |
| Δ4 | `electron-vite` as the build tool (§11/§4 say only "Vite") | Gives exactly the `src/main \| src/preload \| src/renderer` triple §11 wants, with one config and a working dev loop, instead of three hand-rolled Vite configs. |
| Δ5 | `renderer/core/` → `renderer/features/`, feature-slice organization | "core" is ambiguous next to `packages/`; feature-slice scales better when M2+ adds plugin-contributed views. |
| Δ6 | `packages/ui` not created yet; shadcn vendored in `apps/desktop/src/renderer/components/ui` | shadcn is copy-in source, not a dep; with one consumer a shared package is pure overhead + an extra abstraction layer at every customization. Extract in M2 when the Niagara plugin needs the same components. |
| Δ7 | Added `apps/desktop/build/` (electron-builder assets) | Omitted from §11; required for `pnpm build`. |
| Δ8 | `tests/fixtures/reference-server/` wraps `@modelcontextprotocol/server-everything` instead of a hand-rolled mock | A maintained, spec-complete server exercising tools + resources + prompts; hand-rolling a mock is maintenance debt. A tiny custom mock can be added later for edge cases. |

Everything else in §11 is kept as-is: `packages/{mcp-client, schema-form, plugin-api}`, `apps/desktop/src/{main, preload, renderer/{stores, components, lib, plugins}}`, `tests/{e2e, fixtures}`, pnpm workspaces, `pnpm dev` as the single entry point.
