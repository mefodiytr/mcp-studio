# MCP Studio — Product Plan

> A professional desktop application for working with MCP servers.
> Universal client + deep Niagara/BMS specialization.
> What Workbench is to Niagara, MCP Studio is to MCP servers.

---

## 1. Vision

MCP Studio is a desktop-class client for the Model Context Protocol that goes far beyond Claude Desktop's basic connector flow or the Anthropic Inspector's developer tooling. It treats MCP servers as **first-class systems to be explored, manipulated, monitored, and automated**, not just tool catalogs that LLMs happen to call.

For the Niagara/BMS world, it doubles as a thin, modern Workbench alternative: you can browse station hierarchies, edit components, query history, write values, and commit changes — without ever opening Workbench, and from anywhere on the network.

For other MCP servers, it provides the same universal substrate: tools, resources, prompts, sessions, auth — beautifully rendered, properly observable, scriptable.

### What it replaces and what it adds

| Tool | What MCP Studio does better |
|---|---|
| MCP Inspector | A full-fledged UI, persistent sessions, history, scripting |
| Claude Desktop connectors | Direct control, no mandatory OAuth, debug-grade visibility |
| Workbench Property Sheet | Remotely, without a heavy Java client, scriptable |
| Postman for MCP | Schema-aware forms, server capability awareness, multi-server workspaces |
| `curl` + `jq` loops | One UI, history, recall, sharing |

### Differentiators

- **Workbench parity** for Niagara: explorer, property sheet, BQL playground, history viewer, watch-based monitoring.
- **Universal MCP client**: works with any MCP server, a plugin architecture for server-specific UI.
- **Production-safe**: a diff-and-approve workflow for write operations, audit log, time-travel, restore points.
- **Scriptable**: macro-recording, replay, parameterised templates, JSON-RPC pass-through.
- **AI co-pilot integrated**: a natural-language layer on top of the tool catalog, available as a side panel.

---

## 2. Product principles

1. **Honesty over magic.** Every action shows the raw JSON-RPC request and response one click away. We don't hide protocol details — we render them beautifully.
2. **Read by default, write by intent.** Write tools are gated, confirmed, and audited. Bulk operations require explicit diff approval.
3. **Server-agnostic core, server-specific plugins.** Niagara is a first plugin, not a hardcoded assumption.
4. **Schema-driven UI.** Tool input forms, resource viewers, prompt templates are all generated from the server's declared schemas — no hand-written forms per tool.
5. **Discoverable, not memorised.** Every feature is reachable from a command palette (⌘K). Power users don't memorise menus, they search.
6. **Composable.** Macros, snippets, templates, watch sets — everything user-created is a saveable, shareable artefact.
7. **Performant on large stations.** Lazy tree loading, virtualised lists, debounced searches. A station with 100k components must not bog down the UI.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Studio (Electron app)                │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │            Renderer (React + TS + Tailwind)          │   │
│  │                                                      │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐  │   │
│  │  │ Universal   │ │  Niagara     │ │  AI Co-pilot │  │   │
│  │  │ MCP Views   │ │  Plugin      │ │  (Anthropic) │  │   │
│  │  └─────────────┘ └──────────────┘ └──────────────┘  │   │
│  │           │              │                │         │   │
│  │           └──────┬───────┴────────────────┘         │   │
│  │                  ▼                                  │   │
│  │           Zustand store + React Query              │   │
│  └──────────────────┬───────────────────────────────────┘   │
│                     │ IPC                                   │
│  ┌──────────────────▼───────────────────────────────────┐   │
│  │           Main process (Node + TS)                   │   │
│  │                                                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ MCP Client  │  │ Workspace   │  │ Auto-update │  │   │
│  │  │ (TS SDK)    │  │ persistence │  │             │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  │         │                                            │   │
│  │  ┌──────▼──────────────────────────────────────┐    │   │
│  │  │ Transport adapters                          │    │   │
│  │  │  - Streamable HTTP                          │    │   │
│  │  │  - SSE (legacy)                             │    │   │
│  │  │  - stdio (subprocess)                       │    │   │
│  │  │  - WebSocket (future)                       │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  └──────────────────┬───────────────────────────────────┘   │
└─────────────────────┼───────────────────────────────────────┘
                      │ HTTP/SSE/stdio
            ┌─────────▼──────────┐
            │  MCP server(s)     │
            │  niagaramcp, etc.  │
            └────────────────────┘
```

**Why this split:**
- The renderer is built on React + Zustand + React Query — the standard for production-grade desktop. Claude Code knows it idiomatically.
- The main process keeps the MCP client in a single process, the renderer communicates via typed IPC — this gives us control over credentials (they never leave for the renderer), thread-safe sessions, and a single point for logging/audit.
- Plugin layer on the renderer side: server-specific UI components are loaded by `serverInfo.name`. The Niagara plugin renders the explorer, BQL, property sheet; for an unknown server a generic tools/resources/prompts UI is shown.

---

## 4. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Shell | **Electron 30+** | Universal binaries, mature, Claude Code excellent at it. (Tauri alt — smaller bundle, but Rust in the stack complicates AI-driven dev.) |
| Frontend | **React 18 + TypeScript + Vite** | Industry standard, fast HMR, type safety end-to-end. |
| UI components | **shadcn/ui + Tailwind CSS** | Modern design system, owned (not deps), themeable. |
| State | **Zustand + React Query** | Zustand for local UI state, React Query for server state with caching/refetch. |
| MCP client | **@modelcontextprotocol/sdk** (TypeScript) | Official, typed, supports all transports. |
| Forms | **react-hook-form + zod** | Schema-driven validation, generated from MCP tool input schemas. |
| JSON viewer | **react-json-view-lite** or custom | Collapsible, copyable, searchable. |
| Code editor | **Monaco** (BQL, JSON, prompts) | VSCode's editor, syntax highlight, autocomplete hookable. |
| Charts | **Recharts** or **uPlot** for live monitor | Time series, point values. |
| Persistence | **better-sqlite3** (workspace) + **electron-store** (config) | Local-first, no cloud dep. |
| AI integration | **@anthropic-ai/sdk** | Optional co-pilot. User provides their own API key. |
| Distribution | **electron-builder** | NSIS for Win, dmg for Mac, AppImage/deb for Linux. Auto-updater via electron-updater. |
| Testing | **Vitest** (unit) + **Playwright** (e2e) | Standard. |

One language (TypeScript) across the whole stack, one package.json (a monorepo via workspaces if we split out plugins). Claude Code writes this from the spec almost autonomously.

---

## 5. Feature taxonomy

Organized by user goal, not by technical layer.

### 5.1 Connect to servers

**G:** "I have an MCP server — let me connect to it and explore."

- **Connection wizard** — adding a new server: transport (HTTP/SSE/stdio), URL, auth method (none / Bearer / OAuth / custom header).
- **Server profiles** — saved connections with tags (env: dev/staging/prod, project: foo/bar). Quick-switch dropdown.
- **Workspace** — a group of profiles. You can keep several workspaces (e.g. different clients).
- **Connection inspector** — live status, latency, session id, capabilities (tools/resources/prompts counts).
- **Multi-session per server** — several simultaneous connections to one server under different identities (apiToken / user-Bearer / OAuth).

### 5.2 Discover capabilities

**G:** "What can this server do?"

- **Tools catalog** — search, filter by category/annotations, schema view, last-call timestamps.
- **Resources browser** — static URIs and templates, preview content, MIME-aware rendering (JSON, Markdown, image).
- **Prompts library** — list of declared prompts, parameter forms, preview of generated message stream.
- **Server capabilities** — protocol version, server info, advertised capabilities, transports.

### 5.3 Invoke tools

**G:** "I want to call a tool with specific arguments and see the result."

- **Schema-derived form** — automatically generated from each tool's input JSON schema (zod runtime + react-hook-form). Type-correct widgets (numeric slider with bounds, enum dropdown with values, autocomplete for known reference types).
- **Result viewer** — structured content rendered as table/tree/JSON; text content with syntax highlight; errors with code + data expansion.
- **Annotation awareness** — destructive tools get a confirm-dialog automatically. Read-only tools batch-runnable without prompt.
- **Argument templating** — `{{cwd}}`, `{{lastResult.ord}}`, `{{prompt:enterValue}}` substitution. Recall previous arguments per tool.
- **Tool history** — every invocation logged with timestamp, args, result, duration. Filter, search, re-run, edit-and-rerun.
- **JSON-RPC pass-through** — send raw JSON-RPC for tools/calls outside the schema mould. Power-user escape hatch.

### 5.4 Browse Niagara station (plugin)

**G:** "I want to navigate the station like a file tree."

- **Tree explorer (left panel)** — lazy-loaded, virtualised tree of station slot hierarchy. Click to expand, drag to reorder (where supported), context menu per node.
- **Breadcrumb bar** — current path with clickable segments. Always-visible.
- **Property sheet (right panel)** — slot dump of the selected component: type, parent, slots with values, facets, links, extensions. Each row editable inline if writable.
- **Quick navigation** — `Ctrl+P` opens fuzzy-search across all known ords in current cache. Like VSCode's file finder.
- **Folder view** — for any node, see flat children list with column sorting (Name, Type, ORD, Last modified).
- **Component icons** — visual differentiation: 📁 folder, 📊 numeric, 🔘 boolean, 🔤 string, 📐 enum, ⚙️ service, ⏰ schedule, 🔔 alarm class, 📜 history.

### 5.5 Edit components (Niagara plugin)

**G:** "I want to create, modify, and remove station structure safely."

- **Inline create** — right-click in any folder → `New… → Folder | Numeric Writable | Boolean Writable | …`. Dialog with schema-derived form (type picker, facets builder, initial value).
- **Inline edit slot** — double-click any property in the property sheet → editable. Save on Enter / blur. Errors shown inline.
- **Add extension** — context menu on a point → Add Extension → list of compatible extension types from server (via `getExtensionPoints` tool). Config form generated from extension schema.
- **Wire (link slots)** — visual link mode: drag from source slot to sink slot. Backend validates via `linkSlots`. Type-mismatch offers converter picker.
- **Rename** — F2 on any node. Rename atomic on backend.
- **Move** — drag-and-drop in tree. Backend `moveComponent`.
- **Delete** — Delete key or context menu. Always dry-run first, preview displayed, two-click confirm.

### 5.6 Diff & approve

**G:** "I'm about to push 15 changes. Let me see them all before committing."

- **Pending changes queue** — every write operation while "Hold" mode is enabled gets queued, not executed.
- **Diff view** — visual list of pending operations: `+ created`, `~ modified`, `- removed`. Per-operation toggle.
- **Apply all / apply selected / discard** — explicit gate. No accidental cascades.
- **Auto-commit toggle** — for fast iteration on dev stations, can disable diff queue entirely (with warning).
- **Audit log** — every committed change recorded locally with user, server, timestamp, full JSON-RPC envelope. Searchable.

### 5.7 BQL playground (Niagara plugin)

**G:** "I want to write a BQL query and see results."

- **Monaco editor** with BQL syntax highlighting (custom language def).
- **Autocomplete** for known component types, slot names, operators (probed live from station).
- **Result table** — sortable, filterable, paginated. Click row to navigate to component.
- **Query history** — saved with timestamp, can star favourites, share as `niagaramcp://` link.
- **Saved queries** — named, organized in folders, parametrised (`{station}|slot:/Drivers|bql:select * from {type}`).
- **Export results** — CSV, JSON, clipboard.

### 5.8 Live monitor (Niagara plugin)

**G:** "I want to watch 10 points update in real time."

- **Watch list** — drag points from tree → watch panel. Each row shows current value + facets + status + last-update timestamp.
- **Polling adaptive** — read all watched points every N seconds (configurable, default 5s). Diff to avoid flicker.
- **Subscribe via watch tool** — if server supports MCP watch/subscribe primitives (future), prefer push over poll.
- **Charts mode** — toggle to chart view: each watched point becomes a line on a time-series chart. Configurable window (last 5 min / 1 hour / 24 hour).
- **Threshold alerts** — set per-point bounds; visual + system notification on cross.
- **Export** — CSV time series of recorded history during watch session.

### 5.9 History viewer (Niagara plugin)

**G:** "I want to see historical values, not just live ones."

- **History tool integration** — via `readHistory` MCP tool.
- **Range picker** — from/to with calendar; presets (last hour / day / week / month).
- **Chart + table dual view** — chart on top, table below, scrubber-synced.
- **Multi-history overlay** — pick N histories, overlay on one chart with color legend.
- **Statistics panel** — min/max/avg/count/coverage% for selected range.

### 5.10 Macros & automation

**G:** "I want to record a sequence of operations and replay it."

- **Record mode** — every tool call captured into a named macro. Stop recording when done.
- **Macro library** — saved macros in workspace, parametrised via templating.
- **Replay** — execute macro against same or different server. Per-step pause/skip/abort.
- **Schedule** — run macro periodically (via OS scheduler integration or in-app timer).
- **Export as code** — convert macro to TypeScript/Python script using MCP SDK. Bridge between GUI exploration and CI scripts.
- **Share** — macro as `.mcpstudio` file (JSON), drop into another workspace to import.

### 5.11 AI co-pilot

**G:** "Tell me what to do in plain English, do it for me."

- **Side panel** — chat with Anthropic Claude (user provides API key in settings).
- **Tool-aware** — Claude has access to current server's tools and can call them. The user sees tool-calls happen inline.
- **Confirmation gate** — destructive tools require user confirmation in chat before execution.
- **Context-aware** — current cwd, selected component, last result are auto-included in Claude's context.
- **Macro generation** — "record a macro that creates 10 numeric points named oat_1..oat_10" → Claude proposes macro, user reviews, saves.
- **Documentation lookup** — Claude can read server's resources (manuals, schemas) before answering.
- **Token cost meter** — always-visible counter so user knows what they're spending.

### 5.12 Observability

**G:** "Show me what's actually happening under the hood."

- **Protocol inspector** — dockable panel showing live JSON-RPC stream. Filter by method, by status, by duration.
- **Performance timeline** — per-call latency distribution. Histogram + slowest-N. Helps diagnose server bottlenecks.
- **Session replay** — pick any past session from audit log, replay the protocol exchange against fresh server. Useful for reproducing bugs.
- **Tool usage stats** — which tools used most, by which server, with what error rates.
- **Window capture hook** — a dev/CI hook (env var `MCPSTUDIO_CAPTURE_PATH`): the main process renders the application window to a PNG once the renderer has loaded, then exits. Added in M1/C3. Powers screenshots for check-ins/docs (committed under `docs/screenshots/`, one per check-in or milestone boundary) and visual smoke checks in CI (M8).

### 5.13 Compare & sync (advanced)

**G:** "I want to compare two stations' configurations or sync between dev and prod."

- **Side-by-side explorer** — two trees, two property sheets. Diff highlighting.
- **Path comparison** — pick subtree on each side, see structural diff (components added/removed/modified).
- **Selective sync** — pick differences, generate macro that brings one side in line with the other. Preview before execute.
- **Snapshot management** — take named snapshots of station subtrees (serialized component structures), restore later.

### 5.14 Permission visualizer (Niagara plugin)

**G:** "Show me what mcpSmokeUser can actually do."

- **User picker + matrix view** — rows = categories/folders, columns = permissions (r/w/i/R/W/I), cells filled per user's effective rights.
- **Why is this allowed/denied?** — click any cell, see resolved permission chain (user → roles → categories → permissions).

---

## 6. UX paradigms

### Command palette (⌘K / Ctrl+K)
Every action discoverable by name. "create folder", "commit station", "open monitor for /Drivers/RTU1". Powered by Cmdk library.

### Multi-tab workspace
Like VSCode/browser tabs. Each tab = one "view" (explorer, BQL, monitor, history). Multiple servers can have tabs side-by-side.

### Keyboard-first
- `Ctrl+K` command palette
- `Ctrl+P` quick navigation (find any ord)
- `Ctrl+Shift+P` quick tool invocation
- `Ctrl+`\`` toggle protocol inspector
- `F2` rename selected
- `Delete` remove selected (with confirm)
- `Ctrl+S` save workspace (auto-saved already, this is explicit checkpoint)
- `Ctrl+Z` / `Ctrl+Shift+Z` — only for local UI undo (e.g., selection). Server-side undo not supported (Baja non-transactional).

### Theming
- Dark default, light optional, follow-system option.
- Color tokens via Tailwind config. shadcn/ui supports out of box.
- High-contrast mode for accessibility.

### Notifications
- Toast for transient ok/error.
- Inbox panel for accumulated notifications (history of operations) — clearable.
- Native OS notifications for long-running operations and threshold alerts.

### Empty states
Every panel has a thoughtful empty state explaining what it does and how to populate it. No blank screens.

### Error UI
- Error messages always include: code, message, suggestion (where possible), "View raw response" toggle.
- For known error codes (-32010, -32011, etc.), automatic next-action suggestion ("Click Bootstrap user-Bearer").

---

## 7. Cross-cutting concerns

### Security
- Credentials stored in OS keychain (electron-store + keytar). Never in plain-text config files.
- Bearer tokens shown once at creation; afterward only fingerprint visible in UI.
- Per-server confirmation gate for destructive operations can be toggled globally.
- TLS verification by default; self-signed exceptions explicit per-server with reason field.

### Performance
- Tree virtualization (react-window) — render only visible rows. 100k components feasible.
- Lazy children loading — fetch only on expand. Cache aggressively with React Query.
- Debounced inputs (300ms) for search/filter.
- Web Worker for heavy diff computation in Compare view.

### Internationalization
- i18next for runtime locale switch.
- Initial: English + Russian.
- Server-side strings (tool descriptions, error messages) shown as-is.

### Accessibility
- Keyboard-navigable everywhere.
- ARIA labels on icon-only buttons.
- High-contrast theme.
- Screen-reader friendly.

### Telemetry
- Off by default. Opt-in basic anonymous error reporting via Sentry (self-hosted if you want).
- Local-only usage analytics (which features get used, time-on-task) — visible to user, exportable, never sent off-device.

### Offline
- Workspace fully functional offline (browse cached data, edit macros, review history).
- Operations against unreachable servers queue locally and execute on reconnect (opt-in per profile).

---

## 8. Roadmap

Each milestone is 3–5 weeks of Claude Code work within a single project.

### Milestone 1 — Foundation (4 weeks)
- Electron + Vite + React + TS skeleton, design system in place.
- Connection management: profile CRUD, transport adapters (HTTP), MCP client integration.
- Tools catalog + schema-derived invocation form + result viewer.
- Resources browser + Prompts library (read-only).
- Protocol inspector (debug panel).
- Command palette.
- **Deliverable:** universal MCP client that works with any compliant server.

### Milestone 2 — Niagara explorer (4 weeks)
- Niagara plugin scaffold (plugin loader, detection by `serverInfo.name`).
- Tree explorer with lazy loading + breadcrumbs.
- Property sheet.
- BQL playground with Monaco.
- Quick navigation (Ctrl+P fuzzy ord search).
- **Deliverable:** read-only station browser usable as Workbench alternative for inspection.

### Milestone 3 — Write & safety (3 weeks)
- Bootstrap user-Bearer flow (current mcp_app.py logic, productised).
- Inline create/edit/delete for components.
- Add Extension dialog.
- Diff queue + approve workflow.
- Audit log.
- **Deliverable:** safe write-capable station editor.

### Milestone 4 — Observability (3 weeks)
- Live monitor (watch list + charts).
- History viewer.
- Tool call history with filtering and replay.
- Performance timeline.
- **Deliverable:** ops-grade visibility.

### Milestone 5 — Automation (3 weeks)
- Macro recording + replay.
- Macro library + parametrisation.
- Export macro as TypeScript/Python script.
- Scheduled execution.
- **Deliverable:** scriptable testing & deployment workflows.

### Milestone 6 — AI co-pilot (3 weeks)
- Anthropic SDK integration.
- Tool-aware chat panel.
- Confirmation gate for destructive operations.
- Macro generation from natural language.
- Token cost meter.
- **Deliverable:** AI-augmented operator experience.

### Milestone 7 — Compare & sync (2 weeks)
- Side-by-side explorer.
- Path comparison.
- Selective sync as macro.
- Snapshot/restore.

### Milestone 8 — Polish & distribution (2 weeks)
- Light theme + high-contrast.
- Onboarding flow (first-run tutorial).
- Help system with searchable docs.
- Auto-update via electron-updater.
- Windows + Mac + Linux builds via CI.
- Code signing.
- **Deliverable:** version 1.0.

### Stretch goals (post-1.0)
- Wire-sheet visual editor (graph view of links).
- Permission visualizer.
- Cloud workspace sync (E2EE optional).
- Plugin marketplace for non-Niagara MCP servers (e.g., GitHub MCP, Filesystem MCP).
- Mobile companion (read-only monitor on phone).
- VS Code extension that opens MCP Studio panels inline.

---

## 9. Extensibility

### Server plugins

A plugin is a folder under `plugins/` containing:
- `manifest.json` — name, version, matches `serverInfo.name` regex.
- `views/` — React components for server-specific tabs (Explorer, BQL, etc.).
- `commands.ts` — command palette extensions.
- `schemas/` — additional JSON schemas / type hints for known tool names.

Niagara plugin is the reference implementation, shipped in-box. Future plugins (Filesystem MCP, GitHub MCP, etc.) follow same shape.

### Theme plugins
- CSS variable overrides bundled as JSON theme files.
- Drop-in theming without recompile.

### Tool integrations
- Postman-style "export request" copies a MCP tool call as `curl` or as `npx @modelcontextprotocol/inspector ...`.
- Open in VS Code with the tool's schema as JSON file.

---

## 10. Distribution

- **Windows:** NSIS installer (.exe), code-signed (EV cert preferred), auto-update.
- **macOS:** signed + notarised dmg, auto-update.
- **Linux:** AppImage + .deb + flatpak.
- **Update channel:** stable / beta. User can opt into beta in settings.
- **Update server:** GitHub Releases (or self-hosted later).
- **Telemetry:** off by default; opt-in error reporting via Sentry self-hosted.

---

## 11. Repository layout

```
mcp-studio/
├── package.json                  # workspaces root
├── apps/
│   ├── desktop/                  # Electron app
│   │   ├── src/main/             # main process
│   │   ├── src/preload/          # preload bridge
│   │   ├── src/renderer/         # React app
│   │   │   ├── core/             # universal MCP views
│   │   │   ├── plugins/          # plugin loader + registry
│   │   │   ├── stores/           # Zustand stores
│   │   │   ├── components/       # shared UI
│   │   │   └── lib/              # utilities, IPC client
│   │   └── electron-builder.yml
│   └── docs/                     # docusaurus site
├── packages/
│   ├── mcp-client/               # wrapper around @modelcontextprotocol/sdk
│   ├── schema-form/              # JSON-schema → React form generator
│   ├── ui/                       # shadcn-based component library
│   └── plugin-api/               # plugin contract types
├── plugins/
│   ├── niagara/                  # Niagara/BMS plugin
│   ├── filesystem/               # future
│   └── github/                   # future
└── tests/
    ├── e2e/                      # Playwright
    └── fixtures/                 # mock MCP server
```

Monorepo via pnpm workspaces. Single `pnpm dev` to launch Electron with hot reload + plugins picked up automatically.

---

## 12. What this is NOT

To keep the scope from drifting — explicit boundaries:

- **Not a Niagara replacement.** Workbench does many things MCP Studio doesn't try to cover: PX graphics editor, complex wire sheets, station provisioning, security manager, license management. MCP Studio is about data & tools, not about being an IDE.
- **Not a generic SCADA HMI.** Live monitor / dashboards give visibility, but this isn't PX-level visualization. For production operators, Workbench / a front-end remains.
- **Not an MCP server framework.** We're a client, not an authoring tool for servers. Although exporting macros to code is an easy step in that direction, we don't go deep there.
- **Not multi-tenant SaaS.** Local-first by design. All data on the user's device.
- **Not a chat client.** The AI co-pilot is a feature, not the center of the product. Claude Desktop remains the best choice for the main chat flow.

---

## 13. Success metrics

After 1.0:

- The full MCP developer cycle (create server → test tools → debug → ship) goes through Studio in substantially less time than via Inspector + cURL + Claude Desktop combined.
- A Niagara operator can perform basic tasks (create a point, add a history, run BQL, read a trend) without opening Workbench.
- A macro "run my typical commissioning scenario on a new station" works end-to-end without intervention.
- The AI co-pilot is able, from a phrase in Russian, to reproduce the intended operation via tools without follow-up questions in 80%+ of cases.
- A 100k-component station is responsive (interaction < 100ms on actions, tree expand < 500ms).

### Cross-cutting policy — coverage as a ratchet

Every package with `vitest` coverage has **floor thresholds in `vitest.config.ts` that only go up**. When coverage of something is genuinely low (e.g. `mcp-client` in M1 — the happy path is covered by an integration test + e2e, but the HTTP/SSE transports and error/disconnect paths aren't yet), the threshold is set just below the actual number — it's a regression filter, not an aspiration. As tests are added, the floor is raised in the same commit. Never "we'll write tests later" without a recorded lower bound; never lower the floor (only a hotfix with an explicit rationale in the commit message). `schema-form` — ≥90 (lines/funcs/stmts) since M1; `mcp-client` — floor 55/40/55/50 (lines/funcs/stmts/branches) since M1, raise it when transport- and error-path tests are added.

---

## 14. Open questions for the next iteration

1. **Auth for non-Niagara MCP servers** — integrate the OAuth flow right away, or Bearer-only in 1.0?
2. **Plugin sandboxing** — how much to isolate third-party plugins? Iframe-style or trust-by-default?
3. **Wire sheet** — is this a stretch goal or a critical Niagara parity feature? Depends on users.
4. **Cloud sync for the workspace** — there's a need, but it adds surface for security and persistence. Defer to post-1.0 or include as an option?
5. **Mobile companion** — is it worth investing in, and in what form (read-only, or full-featured)?

These questions are for product discovery after the first 2 milestones, once there are users and feedback.

### Resolved in M1 kickoff (2026-05-11)

Decisions made at the start of Milestone 1 — here so a future reader of the spec understands "why this way" without digging through correspondence. The detailed M1 plan (atomic commits + acceptance criteria + repo structure with a Δ-list of deviations from §11): `docs/milestone-1.md`.

1. **Shell — Electron** (not Tauri). Tauri saves megabytes at the cost of Rust knowledge in the stack; for a Claude-Code-driven workflow and Node-native integrations (keytar/safeStorage, electron-updater, stdio-subprocess) that's a useless trade. §4 already assumed this; the decision is confirmed.
2. **M1 protocol scope — "Standard": HTTP + stdio + Bearer / custom header / none.** stdio is the primary transport per the spec and in community tutorials; "an MCP client without stdio" is half-baked positioning. OAuth 2.1 / PKCE (redirect listener, refresh, dynamic client registration) is too large a surface for M1; moved into an **"M1.5" OAuth mini-milestone** right after M1, before the Niagara plugin in M2. Sequence: universal HTTP+stdio → +OAuth → Niagara plugin. (Closes §14.1 for the M1 phase.)
3. **Persistence — pure-JS in M1, migration to better-sqlite3 in M4.** `electron-store` + lowdb-style JSON for profiles and tool-call history; better-sqlite3 is a native module — ABI rebuilds across the Win/Mac/Linux matrix in the foundation = weeks of debugging instead of feature delivery. The data shape is designed to be queryable-friendly, with an explicit `// TODO(M4): migrate to better-sqlite3` in the code so the migration is mechanical (the trigger is macros + audit log from M4/M5, which need a queryable backend). A deviation from §4's "better-sqlite3 (workspace)".
4. **License — Proprietary / All Rights Reserved** during development. A minimal copyright notice in the sources. The OSS decision (MIT/Apache vs commercial vs internal) is for after 1.0; we don't close off options in advance, and it doesn't affect the M1 scope.
5. **shadcn/ui is vendored in `apps/desktop/src/renderer/components/ui`**, `packages/ui` is not created until M2. shadcn is copy-in source, not a dep; with a single consumer a shared package = pure overhead + an extra abstraction layer on every customization. The natural moment to extract it is M2, when the Niagara plugin needs the same components. A deviation from §11 (`packages/ui`).
6. **Other things fixed at the start:** pnpm + electron-vite as the build tool (electron-vite gives exactly the `src/main | src/preload | src/renderer` triad from §11 in one config — a deviation from §11/§4, which name only "Vite"); a monorepo from day one (`packages/{mcp-client, schema-form, plugin-api}` are real workspace packages; no empty plugin stubs); the main process = the single source of truth for connections and credentials, credentials never cross the boundary into the renderer; React Query (server state) + Zustand (UI state); **React 18**, not 19 (stability over novelty for the foundation; an upgrade to 19 is a separate commit for a concrete reason, e.g. the React Compiler); i18next wired in, English-only strings in M1; e2e against `@modelcontextprotocol/server-everything` (no hand-rolled mock — avoiding tech debt in the foundation); no code signing / notarization in M1 (unsigned artifacts in CI as proof of working packaging; signing is M8); the Python PoCs (`mcp_app.py`, `mcp_console.py`) archived in `prototypes/`, not in the production git history; `@modelcontextprotocol/sdk` is wrapped, JSON-RPC is not reimplemented.

The full list of deviations from §11 (Δ1–Δ8) with rationale — in `docs/milestone-1.md`.

### Adjustments during the M1 build

Refinements that came up during implementation (after kickoff). Here so the spec reflects the actual state without digging through commit messages.

- **§4 persistence — a hand-rolled `JsonStore` instead of `electron-store`.** A ~100-line dependency-free JSON-file store in main (`config.json` / `workspace.json` / `credentials.json` in userData; load-on-construct, atomic `*.tmp`→rename on save, `schemaVersion` + a `migrate()` hook). Reason: `electron-store` v9+ is ESM-only, which conflicts with the CJS bundle of the main process; a hand-rolled store is easier to migrate to better-sqlite3 in M4 than to go through electron-store's abstraction. The better-sqlite3 migration in M4 is unchanged (an explicit `// TODO(M4)` in `json-store.ts`). [C5]
- **The theme (`light | dark | system`) is stored in renderer `localStorage`**, not in the main config — contrary to the literal "config stores the theme" in §4/the M1 plan. The theme is applied to `<html>` synchronously before the first paint (`main.tsx`), which requires a synchronous read; localStorage provides that, async IPC before the first paint doesn't (it'd be a FOUC). The main config keeps the rest (window bounds, feature flags). [C3/C5]
- **The ESM `@modelcontextprotocol/sdk` is bundled into the CJS main bundle** (`externalizeDepsPlugin({ exclude: ['@mcp-studio/mcp-client'] })` in the electron-vite main config; main bundle ~480 kB). Reason: Electron 33.2.1 ships Node 20.18.1, which can't `require()` ESM. The renderer is always ESM (Vite). Reversible — during build optimization in M8 we can go back to an ESM main if there's a benefit. [C7b]
- **Electron pinned to `33.2.1` (exact)** instead of the latest 33.x — the version from the local `@electron/get` cache; a fresh 33.x stalled on the ~115 MB binary download. A bump is a separate commit when convenient (the 33 branch still gets security fixes). [C2]
- **C7 split into C7 + C7b** in the plan: C7 = the `mcp-client` package (as planned); C7b = a minimal `ConnectionManager` + `connections:*` IPC + a `ConnectionsView` dev harness — it borrows pieces of C8 (connection manager) and C11 (connection inspector) two commits early for an end-to-end "proof of life". C8/C11 "for real" extend the minimal versions, they don't rewrite them. [C7b]
- **The command palette — `cmdk`** (the vendored shadcn wrapper `components/ui/command.tsx`). Commands are assembled by the shell hook `useAppCommands` (built-ins: navigate to a view, toggle the inspector/theme, reload, connect/disconnect a profile, re-run the last tool, a context-scoped "clear history" only on the History view). A full plugin-contributed command registry is M2 (together with the plugin API). [C21]
- **Tab/layout state — Zustand** (`stores/workspace.ts`, persisted to `localStorage`). A tab = a view instance + a (forward-looking) optional `connectionId` + `pinned`; open/close/reorder(drag)/pin. In M1 each view tab keeps its own connection picker — binding a tab to a specific connection isn't exposed in the UI (it's in the data model). [C22]
- **Renderer code-split** — the feature views (`tools`/`resources`/`prompts`/`history`/`raw`/`inspector`/`connections`) are loaded via `React.lazy` behind `<Suspense>`; schema-form (+ react-hook-form + zod) moves into a separate ~228 kB on-demand chunk. Initial renderer bundle ~681 kB (was ~1.0 MB). [C24]
- **e2e — Playwright + Electron** (`tests/e2e/`, not a workspace package; `pnpm test:e2e` builds first). One spec runs the happy path against `@modelcontextprotocol/server-everything` over stdio: launch → the wizard adds an stdio profile → connect → Tools → invoke `echo` → the result viewer → the inspector shows `tools/call`. Coverage gates: `schema-form` ≥90 (as before), `mcp-client` — a regression floor (lines 55 / funcs 40 / stmts 55 / branches 50; actually ~68/45/68/67), raise it when unit tests for the HTTP/SSE transports and error paths are added. CI: lint → typecheck → unit → build → e2e (xvfb on Linux). [C23]
- **`node-linker=hoisted` moved from `.npmrc` into `pnpm-workspace.yaml`** (`nodeLinker: hoisted`) — pnpm 11 reads it from there; in `.npmrc` it wasn't applied to the whole workspace (electron didn't end up in the root `node_modules`). electron-builder wants a flat `node_modules` for the packaged app. [C24]
- **electron-builder — unsigned smoke only.** `apps/desktop/electron-builder.yml` (NSIS / dmg / AppImage), `pnpm --filter @mcp-studio/desktop dist`; no code signing/notarization in M1. `apps/desktop/build/` (custom icons/installer assets) doesn't exist yet — Electron defaults. [C24]
- **`packages/plugin-api` not created yet** (the §11/layout plan mentions it) — created in M2, when the first plugin appears. [M1 build]
- **Markdown resources in the preview are shown as monospace text** (not rendered) — a real renderer (`react-markdown`) is a dep+bundle cost, not justified in M1. schema-form renders `oneOf`/`anyOf` discriminated unions via the `json` escape hatch, not via a variant picker. Both are M2 polish. See `docs/m1-followups.md`. [C18]

See `docs/m1-followups.md` — the full list of items deferred from M1 with where each fits.

### M1.5 — OAuth (2026-05-12, `v0.1.5-m1.5`)

A third auth method (alongside none / bearer / header): **OAuth 2.1 + PKCE**. The plan — `docs/milestone-1.5.md` (commits C25–C32).

- **What the SDK does, what we do.** `@modelcontextprotocol/sdk` already implements (and tests) discovery (`.well-known/oauth-protected-resource` → `.well-known/oauth-authorization-server` (RFC 8414) → `openid-configuration`), PKCE (S256), the `auth()` orchestrator, DCR (RFC 7591), code exchange, refresh, and in the transports — try-token → refresh-on-401 → `redirectToAuthorization` + `UnauthorizedError`. We write: the implementation of the SDK's `OAuthClientProvider` interface (`packages/mcp-client/src/oauth.ts` — storage-agnostic, wired into the credential vault), a loopback redirect listener in main (`main/oauth/redirect.ts`, RFC 8252 §7.3 — one-shot `127.0.0.1:<ephemeral>/callback`), the glue in `ConnectionManager.connectOAuth` (`Connection.create({authProvider})` → has-token / `PendingAuthError`→`waitForCallback`→`finishAuth`→reconnect; a refresh-then-reject guard with max-1-retry; mid-session 401 → `auth-required`, no auto-retry; the cancellation pathway closes the listener immediately — no orphans), the wizard section (`oauth` radio + scope + a pre-registered client-id with a hint), sign-in/out UI + command-palette commands, and an e2e against the SDK demo server (`examples/server/simpleStreamableHttp.js --oauth`, headless via `MCPSTUDIO_OAUTH_AUTOAPPROVE`).
- **Storage.** Tokens + DCR client info (+ `tokensSavedAt` for absolute expiry) — one encrypted JSON blob per profile in the credential vault (`schemaVersion` 1→2). The PKCE verifier — in-memory only. The renderer sees only a redacted status (`oauth:status` → signed-out/signed-in/expired + expiresAt + scope; `oauth:signOut`).
- **DCR with a fallback.** DCR is used if the auth-server metadata contains `registration_endpoint`; otherwise — a manually-entered `client_id` (`auth: {method:'oauth', scope?, clientId?}`).
- **Redirect — loopback** (not a custom URL scheme): RFC-blessed for native apps, works in dev and packaged, the system browser via `shell.openExternal`, never an in-app `BrowserWindow`.
- Build adjustments and deferred items — `docs/milestone-1.5.md` → "Build adjustments" and `docs/m1-followups.md` → "M1.5 / OAuth follow-ups" (proactive-refresh-at-80%, OAuth round-trips in the inspector, the hidden-then-surfaced client-id field, a custom-URL-scheme redirect, RFC-7592 DCR-DELETE on sign-out).

### M2 — Niagara explorer + plugin architecture (2026-05-12, `v0.2.0-m2`)

Server-specific plugins become reality: the first plugin is Niagara, a read-only station browser. The plan — `docs/milestone-2.md` (commits C33–C47, four phases, check-ins at phase boundaries). Read-only in M2 (write — M3, history viewer — M4, BearerResolver / `rotateMcpToken` — M3).

- **Plugin architecture.** `packages/plugin-api` — the contract: `Plugin` (manifest + views[] + optional `commands(ctx)` + optional `toolSchemaHints`), `PluginView` (id / title / icon / `component({ctx})`), `PluginContext` (the bound connection + thin wrappers over the IPC channels + `setCwd` for `{{cwd}}`), `PluginCommand`, `PluginManifest` (name / version / title / `matches: RegExp|string`) + `pluginManifestSchema` + `matchesServerName`. Build-time static import: the renderer's `plugins/registry.ts` holds `IN_BOX_PLUGINS`, `pickPlugin(serverInfo)` matches by `serverInfo.name`. Plugin views are rendered by the host (`AppShell`'s `PluginViewHost` in a `<Suspense>`), rail items + tab labels are generic; plugin commands are merged into `useAppCommands`; `toolSchemaHints` are merged into the generic Tools form (`ToolsCatalog` → `pickPlugin` → `ToolInvocationDialog.mergeSchemaHint`). `packages/ui` — the extracted vendored shadcn (Button / Input / Dialog / Command + `cn` + the Tailwind base), shared by `apps/desktop` and `plugins/niagara`. The `{{cwd}}` token — `stores/templating.ts` (resolved in tool-call arguments; a plugin view publishes its "cwd" via `ctx.setCwd`).
- **Niagara plugin** (`plugins/niagara`) — `matches: /^niagara/i` (confirmed: `serverInfo.name === "niagaramcp"`), four lazy views: **Explorer** (a lazy slot tree via `listChildren` per-node, React-Query-cached; breadcrumbs; `Ctrl/Cmd+P` quick-nav over the loaded nodes), **Folder** (a flat sortable children list Name/Type/ORD), **Properties** (`inspectComponent` identity + a `getSlots` slot table — display-only, edit = M3), **BQL** (a CodeMirror 6 editor; builds the `<ord>|bql:` prefix; `limit` is a dedicated control; parses TSV; history in localStorage). Type-aware component icons; `toolSchemaHints` with English `title`/`description`/`examples` over niagaramcp's (partly Russian) schemas.
- **niagaramcp quirks** (the source of truth for the wrappers + the mock server): tool results carry JSON twice (`structuredContent` + a JSON string in `content[0].text`); `bqlQuery` returns TSV in `content[0].text`; `getSlots`/`inspectComponent` return display-localized values (`"поистине"` instead of `true`); ORDs are `station:|slot:/A/B/C`, `inspectComponent.parentOrd` comes back bare (`slot:/...`). Coordination items on the niagaramcp side (tracked in `docs/m1-followups.md`, fixed there): write-tool annotations are wrong (`readOnlyHint: true` / `destructiveHint: false` on create/update); the `bqlQuery` input format is hostile (requires a full ORD prefix; an SQL-style `LIMIT N` in the query string silently fails); tool descriptions are partly in Russian. Relevant to M3.
- **e2e** — `tests/fixtures/niagara-mock/server.mjs` (a dependency-free stdio MCP server that replays the recorded envelopes from `tests/fixtures/niagara-mock/*.json`) + `tests/e2e/niagara-plugin.spec.ts` (connect → badge → Explorer tree → Properties → BQL). e2e green ×3.
- Build adjustments — `docs/milestone-2.md` → "Adjustments during the M2 build" (including the three found-while-testing fixes: `useConnections` seeding from `connections:list`; `PluginContext.callTool` unwrapping the `{result,error}` envelope; `@tanstack/react-query` + `react/jsx-runtime` added to the renderer's `resolve.dedupe` — otherwise the plugin's lazy chunks get a second React Query instance in the prod build). Deferred — `docs/m2-followups.md` (tree virtualisation; a links/extensions panel in the property sheet when/if niagaramcp exposes read tools; a host `ctx.openView` hook + a per-node context menu; quick-nav as a host command; slimming the CM6 chunk + a dark editor theme + a Lezer BQL grammar; per-connection explorer state; a deeper schema merge).

### M3 — Write & safety (2026-05-13, `v0.3.0-m3`)

The Niagara plugin becomes write-capable, safely. The plan — `docs/milestone-3.md` (commits C48–C60, four phases, check-ins after Phase A and Phase C; full deferred-items list in `docs/m3-followups.md`).

- **Tool-annotation overrides + audit trail (host-side, generic).** `Plugin.toolAnnotationOverrides?: Record<string, ToolAnnotations>` is the contract extension; `mergeToolAnnotations(base, override)` is the pure helper; `applyAnnotationOverrides(tool, plugin)` is the **single resolution point** in `ToolsCatalog` (mapped over the tool list once — the filters, the badges in `ToolRow`, and the destructive-confirm gate in `ToolInvocationDialog` all read `tool.annotations` downstream of that one map, so no badge / behaviour drift). The niagara override map corrects niagaramcp's wrongly-annotated `walkthrough-write` family + `importKnowledge`. Tool-call history grew an optional `write?: boolean` flag — computed at call time from the *effective* annotations (renderer is the source of truth, because it knows about plugin overrides) and persisted via `connections:call` → `tool-history-repository`. `HistoryPanel`: "Writes only" filter + amber "write" badge per row + "Export audit log" (JSON download of currently-visible entries). Re-runs preserve the original flag.
- **Niagara write engine (per-connection diff-and-approve queue).** `plugins/niagara/src/lib/write-ops.ts` — a tagged-union `WriteOp` (SetSlot / ClearSlot / CreateComponent / RemoveComponent / AddExtension / LinkSlots / UnlinkSlots) + the pure `isReversible(op)` / `describe(op)` / `toToolCall(op)` (and `bsimpleKind` / `parseBSimpleValue` for the property-sheet editor). `state/pending-store.ts` — Zustand **keyed by `connectionId`** (per-connection; session-only, never persisted across a restart). `applyAll(connectionId, ctx)` runs the queued ops sequentially via `ctx.callTool(name, args, { write: true })` (the M3 extension to `PluginContext.callTool`) and fires a final `commitStation`; stops on first error (rest stay pending; retry skips already-done); returns `{ ok, failed, committed }`. After Apply, `['niagara', cid]` is invalidated on the React-Query client so reads refetch transparently.
- **Niagara write UI.** A new `changes` plugin view — queued ops with `describe()` + status chip + per-op **`Reversible`** / **`⚠ Irreversible`** badge (the §D2 reversibility table; `SetSlot` / `ClearSlot` / `CreateComponent` / `LinkSlots` reversible; `RemoveComponent` / `UnlinkSlots` / `AddExtension` not). The Apply confirm dialog is loud about irreversibility — destructive-styled button + explicit "Including K irreversible — Niagara has no native undo" callout when the queue holds any. Property-sheet inline edit for BSimple Property slots: Enter / blur commits → enqueue `SetSlot`; per-row "Reset" → enqueue `ClearSlot`; pending cells show the new value with an amber "modified" badge + `(was …)` + one-click revert. Explorer tree right-click context menu (`views/NodeActions.tsx`): Copy ORD · New child… · Add extension… · Link slots… · Remove… (the Remove dialog runs `dryRunRemove(ctx, ord, force?)` at open and re-runs on `force` toggle, surfacing inbound-link refusals and disabling the destructive Apply until force is set). An auto-commit toggle (with a visible amber warning) for fast iteration on a dev station.
- **User-context Bearer bootstrap (feature-detected).** `lib/bootstrap.ts` — `pickBootstrapMode(toolNames)` probes `ctx.listTools()` and picks `provisionMcpUser` → `rotateMcpToken` → `setupTestUser` (test-mode label only on the fallback); `unavailable` hides the trigger. `views/BootstrapBearer.tsx` opens from a button in the Changes view header: generate a 32-byte hex token → `callTool(detected, {username, token}, {write:true})` → `credentials:set` on the profile (`window.studio.invoke` directly — known abstraction leak, one caller, tracked) → `connections:reconnect`. **Post-M3 niagaramcp work (`provisionMcpUser` / `rotateMcpToken`) unlocks production-mode with no Studio code change.**
- **niagaramcp coordination items (cross-repo).** Tracked in `docs/m1-followups.md` and replicated in `docs/m3-followups.md` with M3 context: the annotation fix (Studio papers over via the override map; the override becomes a no-op once fixed); `provisionMcpUser` / `bindMcpToken` + `rotateMcpToken` (production-mode bootstrap path); a Workbench `BMcpProvisionAction` (optional UI counterpart); enum slot ordinal exposure in `getSlots` (unblocks enum slot editing); `bqlQuery` input format + slot value localization polish (UX-only).
- **e2e — stateful niagara-mock + write-flow spec.** `tests/fixtures/niagara-mock/server.mjs` was rewritten as a tiny in-memory station (nodes / children-by-parent / slots-by-ord / links-by-sink; mutations + reads share the model; fault injection via `__fail`); seeded from the recorded envelopes so the M2 `niagara-plugin.spec.ts` passes **unmodified** (backward-compat integrity check). `tests/e2e/niagara-write.spec.ts` exercises the end-to-end deliverable: queue 2 ops (CreateComponent + SetSlot) → reversibility badges → Apply confirm → "done" → reads reflect mutations → History "Writes only" shows 3 attributed entries (setSlot + createComponent + commitStation). e2e green ×4.
- Build adjustments — `docs/milestone-3.md` → "Adjustments during the M3 build" (including two found-while-testing fixes: the Zustand selector loop / React #185 — stabilise `selectQueue`'s empty-default with a singleton; and the property-sheet `SetSlot` double-enqueue — `lastSentRef` guard). Deferred — `docs/m3-followups.md` (a host `Plugin.onBeforeDisconnect` hook + plugin-api seams `ctx.openView` / `ctx.updateAuthSecret` / `ctx.reconnect`; "issue the inverse" buttons + `Delete` shortcut UX polish; visual wire-mode for `linkSlots`; enum / complex-slot editors; the Zustand singleton gotcha for `CONTRIBUTING.md`).

### M4 — Observability (2026-05-13, `v0.4.0-m4`)

A live monitor, a history viewer, a performance timeline, and tool-usage stats — the operator's "what's the station doing right now / what did it do an hour ago / where did time go" surface. The plan — `docs/milestone-4.md` (commits C61–C68 + the recharts-split chore, four phases, check-ins after Phase A and Phase C; full deferred-items list in `docs/m4-followups.md`).

- **Shared chart primitives.** New `packages/charts` — three renderless-about-layout components (`TimeSeriesChart`, `Sparkline`, `BarChart`) + `downsampleTimeSeries` (min/max bucketed reducer that preserves spikes) + `paletteColor` / `DEFAULT_PALETTE` + `mergeSeries` (union timestamps for multi-series overlays). Recharts under the hood for the line / bar; hand-rolled SVG for the 24-px sparkline (recharts' `ResponsiveContainer` overhead is wasted there). Consumed by the Niagara History + Monitor views, the host Tool-usage + Performance views, and (forward-looking, `handover.md` §A) the M5 AI co-pilot's chat-inline trend renderer. The package's `recharts` dep is split into a shared chunk (`apps/desktop/electron.vite.config.ts` `manualChunks`) — every chart-bearing view since pays a 10–30 kB lazy cost on top of one shared 1 MB recharts load.
- **Tool-usage stats + Performance view (host-level).** `lib/usage-stats.ts` (`usageByTool` / `latencyStats` / `errorBreakdown`) and `lib/perf-stats.ts` (`latencyHistogram` / `slowestN` / `p95DeltaOverWindows` — regression flagged when recent p95 is ≥ 25% above the previous-of-equal-length window). Both are **pure derivations over the persisted `tool-history`** — no new storage in M4. New rail items + `usage` / `perf` `AppView` enums; `VIEW_KEYS` so the command palette navigates. The most-called bar / per-tool latency table / error breakdown render via `@mcp-studio/charts` BarChart; the slowest-N table is plain HTML. A dedicated perf-repo (longer retention, signed export) is M5+ if real ops-grade audit needs more than 200 entries.
- **Niagara history viewer (plugin-contributed).** `plugins/niagara/src/lib/niagara-history.ts` — defensively-typed `readHistory(ctx, args)` wrapper (accepts the field-name variants niagaramcp's response *might* use — `records`/`points`/`samples`, `t`/`ts`/`timestamp`, `v`/`value`, ISO datetime *or* epoch ms, bool → 0/1, null gaps); returns `{ord, points, raw, truncated, rowCount}` with `points` already downsampled to ≤ 2 k. `views/HistoryView.tsx` — sixth Niagara view: five preset ranges (1 h / 4 h / 1 d / 7 d / 30 d) + custom `datetime-local`, aggregation toggle (none/avg/min/max/count — the niagaramcp arg), `useQueries` (not a loop of `useQuery` — the rules-of-hooks killer when the array length changes) over the union of [primary ord + extra overlay ords picked from the Explorer's `known` cache via a CommandDialog], chart + per-series paginated table dual view, truncation banner.
- **Niagara live monitor (plugin-contributed) — the M4 deliverable.** `shared/domain/watches.ts` + `WORKSPACE_VERSION` 2 → 3 with an **idempotent** migrator; `watches:list` / `watches:set` IPC; `WatchRepository`; plugin `state/watch-store.ts` Zustand mirror with `ensureLoaded(profileId)`. `views/MonitorView.tsx` — seventh Niagara view: drag-from-Explorer (TreeNode rows are `draggable`, the Monitor body is the drop zone, the `useExplorerStore.known` cache supplies the cached `displayName`), per-row poll interval popover (1 s / 5 s / 10 s / 30 s / 1 min / paused) backed by `useQuery({ refetchInterval, refetchIntervalInBackground: false })` (tab-blur pauses naturally, paused rows freeze), per-row threshold editor with low/high inputs (persisted via the C65 store), per-row sparkline buffer capped at 60 samples + the C62 Sparkline's threshold-cross recolour, value-cell red on cross, global "Pause all" toggle. niagara-api's `readPoint` wrapper covers the per-row poll (numeric parsed from niagaramcp's stringified `value`, units from `facets.units`).
- **`useExplorerStore.known` becoming a cross-view primitive.** Three M4 consumers (QuickNav fuzzy / History overlay picker / Monitor drop-target lookup) + the M5 AI co-pilot's ord autocomplete on the horizon. Semantics, eviction policy, and a "register newly-encountered ords" contract are tracked in `m4-followups.md`.
- **e2e** — `tests/fixtures/niagara-mock/server.mjs` gains `readPoint` (deterministic sine over wall clock, base offset hashed from the ord) + `readHistory` (~1 sample/min across the range, same sine shape). New `tests/e2e/niagara-observability.spec.ts` exercises History + Monitor + Performance end-to-end against the stateful mock; M2 + M3 specs still pass unmodified. e2e green ×5.
- Build adjustments — `docs/milestone-4.md` → "Adjustments during the M4 build" (including the **+215 kB eager bundle drop** from the recharts manualChunks side win + two found-while-screenshotting fixes: the Monitor sparkline's `useEffect` keyed on `[q.data]` never re-fired on flat-signal polls → keyed on `[dataUpdatedAt, value]`; the watches:list e2e disambiguating the host vs plugin "History" rail items with `.last()`). Deferred — `docs/m4-followups.md` (CodeMirror manualChunks split when a second CM6 consumer appears; `useExplorerStore.known` documented as a cross-view primitive + eviction policy; `ctx.workspace.watches` plugin-api seam; true LTTB downsampler; uPlot fallback; annotation overlays on history chart; batched-read primitive for the watch list; per-watch threshold notifications; drag-and-drop e2e coverage; per-series ranges in History; readHistory real-response-shape recording; semantic error-code colouring; dedicated perf-repo for longer retention).

### M5 — AI co-pilot (2026-05-14, `v0.5.0-m5`)

A chat-based assistant per connection. The LLM reasons in natural language, gathers context via the same MCP tool calls the operator would run manually, and proposes writes through the M3 pending-changes queue — operator approves, LLM never commits directly. The Niagara plugin contributes a system prompt + starter questions + diagnostic flows; chart-inline rendering reuses the M4 `@mcp-studio/charts` primitives so a `readHistory` result drops into a chat message without a second chart lib. The plan — `docs/milestone-5.md` (commits C69 → C80 across four phases + the post-C75 roadmap commit + one screenshots-only pass; full deferred-items list in `docs/m5-followups.md`). Vision context: [`handover.md`](handover.md) Part 2 + [`roadmap.md`](roadmap.md).

- **`@mcp-studio/llm-provider`** — provider-agnostic LLM streaming + a bounded ReAct loop. `LlmProvider` interface; `LlmEvent` normalised union (text-deltas / tool-use-start+input-delta+complete / message-stop with stop_reason); `AnthropicStreamMapper` (a stateful pure mapper feeding Anthropic SSE events through, replayable against captured JSONL fixtures); `runReAct({provider, system, history, tools, dispatchTool, signal, maxTurns=12})` returning the final `LlmMessage[]` history. The package is **renderer-only consumption** — Electron-33 main is CJS-bundled per M1 C7b; Anthropic SDK is ESM-first; running the provider in the renderer dodges the bundle-config dance. Documented deviation from the D4 "key never leaves main" aspiration; the key is fetched on-demand via the `llm:getKey` IPC into the chat-runner's closure for the lifetime of one ReAct iteration. `FakeLlmProvider` + `MockLlmProvider` for tests. 26 unit tests + four JSONL stream fixtures (the canonical Anthropic interleaved-text+tool_use example verbatim from the docs).
- **Chat foundation.** Per-connection multi-conversation scope (`Conversation`s persisted per `profileId` in `workspace.json`; `WORKSPACE_VERSION` 3 → 4 with idempotent migrator; 200-message cap with head-trim — summary-at-trim is m6-followup). API key in the existing `safeStorage` vault keyed by `llm:anthropic:apiKey`. New rail item "Assistant" (`Bot` icon); ConversationList sidebar (newest-first) + streaming MessageView + ToolCallEnvelope (collapsible with raw args/output JSON) + Stop button via `AbortController`. Markdown via `react-markdown` + `remark-gfm`, split into a shared chunk alongside the M4 recharts split; Anthropic SDK gets its own shared chunk too. Eager bundle held flat at the M4 ~600-kB anchor (+ ~30 kB for the chat shell wiring).
- **Plugin contributions — `Plugin.systemPrompt` / `starterQuestions` / `diagnosticFlows` / `canHandleWrite`.** Additive `Plugin` contract extension; `DiagnosticFlow` carries a templated user-message prompt + named `params` for the launcher dialog (M5 D7 — plan-and-execute lifts to stored plan templates in M6). `assemblePluginContributions(plugins, ctx)` single resolution point so the chat empty state + command palette + the runner's system-prompt assembly all see the same contributions. Niagara ships the full M5 surface: a ~300-word system-prompt block covering ORD format with concrete examples, the knowledge layer (`spaces` / `equipment_types` / `equipment` / `standalone_points` + role mapping), kitFuzzy outputs surfacing as standard slot values, the `bqlQuery` syntax wart (full ORD with `|bql:` prefix; LIMIT-in-query-string fails), the Russian-locale boolean stringification (`поистине` / `ложь`), and the write-tool safety semantics + the transparent annotation-override note. Four starter chips; two diagnostic flows (rooftop-diagnosis + knowledge-summary).
- **AI-write safety boundary — the M5 D5 invariant + the M3 `toolAnnotationOverrides` migration onto `PluginManifest`.** Three coupled landings in one commit (C75): the manifest schema gains `toolAnnotationOverrides` so the override table is pure data both renderer and main consume from one source; `apps/desktop/src/main/plugins/manifest-registry.ts` exposes `pickManifest(serverName)` + `getEffectiveAnnotations(manifest, toolName, base)` + a main-side `isWriteCall(annotations)` predicate; `ConnectionManager.callTool` gains `opts.caller: ToolCaller` (absent = `'human'` — every M1–M4 caller path back-compat-preserved; `{type:'ai', conversationId, agentId?}` triggers the safety predicate). For AI callers, `connectionId`'s lazy `tools/list` cache feeds `getEffectiveAnnotations`; an effective-write call returns `{pendingEnqueued: {toolName, args, attribution}}` instead of dispatching to the MCP SDK — the chat view routes it through `enqueueAiWrite(connId, toolCall, source)` into the niagara plugin's `pending-store`. The op shows in the Changes view with a blue "AI" chip + tooltip carrying the conversation id; Apply by the operator sends `caller` absent (back-compat `'human'`) so the dispatch path is M3-identical. **`tests/e2e/niagara-write.spec.ts` (the M3 deliverable) passes unmodified — the C75 regression check.** `ToolCallOutcome` extended with `pendingEnqueued`; `ToolHistoryEntry` extended with `actor` + new `status: 'queued'` (queued AI proposals show in the audit trail as `queued` + actor:`{type:'ai', conversationId}`). niagara's `Plugin.canHandleWrite?(op)` claims ops `fromToolCall` understands; M5 doesn't iterate plugins yet (single-write-plugin reality), the hook keeps the contract complete.
- **Chart-inline rendering — JSON code fence with `language-chart`, parsed via `react-markdown`'s `components.code`, rendered via `<TimeSeriesChart>` from `@mcp-studio/charts`.** Fourth consumer of the M4 chart primitives. Defensive parser (`chart-payload.ts`): 256-kB oversize guard; JSON-parse failure falls through to the default code block (preserves the LLM's ability to *document* the chart syntax with deliberately-invalid examples); zod against `chartPayloadSchema` (`type:'timeseries'` strict literal — bar/sparkline are m5-followups + require explicit code change); normalises `t` from ISO string OR epoch ms (the M4 history-wrapper convention); drops unparseable timestamps point-by-point; sorts by `t`; downsamples to ≤ 500 points per series via `downsampleTimeSeries`. Schema / oversize / no-points failures render as a warning chip with the payload underneath; round-trip success renders the chart with title + truncation note + "Show payload" debug toggle + `role="img"` for screen readers.
- **Phase D polish.** Token usage ledger per conversation: versioned pricing table (`ANTHROPIC_PRICES_AS_OF = '2026-05-14'`) per the promt15 nuance; UI marks the cost estimate "approximate, prices as of …"; warn at 80 % of the 50k soft cap, over at 100 % (still soft — sending isn't blocked); the `message-stop` event's cumulative usage threads onto the persisted `Message.usage` field. Chat polish: `<ord>X</ord>` markdown extension (pre-rewrites to `mcp-studio-ord:<base64>` links; `components.a` decodes + renders a clickable chip; click publishes to the new `useHostBus` in `@mcp-studio/plugin-api` — pnpm-hoist gives both renderer + plugins the same Zustand instance; AppShell switches to the niagara Explorer view, the niagara `ExplorerView` consumes the pending ord and calls `reveal()` + `select()` + `ctx.setCwd()`). Keyboard shortcuts: Ctrl/Cmd+Enter send / Esc stop / Ctrl/Cmd+Shift+N new conversation / Ctrl/Cmd+/ focus input. Regenerate button (truncate to before the last user-text message + re-send via the runner).
- **e2e** — three new specs against the mock LLM provider (env-gated `MCPSTUDIO_LLM_PROVIDER=mock`): `chat-rooftop` (diagnostic-flow launcher → 3 tool-call envelopes → chart-inline render), `chat-write` (AI-attributed write → safety-boundary interception → AI-badged pending op), `chat-cancel` (Stop mid-stream → `[stopped by user]` synthetic marker). The mock-provider library lives in `apps/desktop/src/renderer/src/lib/llm-mock-programs.ts` — four canned programs (greeting / rooftop / write-propose / cancel). MockLlmProvider widened to accept `MockEvent[] = LlmEvent | MockDelay` so the cancel program paces deltas with `{type:'__delay', ms}` sentinels (filtered out before yielding, honours `signal.aborted`). e2e green ×8 (5 existing M1+M2+M3+M4 specs + 3 new M5 specs).
- Build adjustments — `docs/milestone-5.md` → "Adjustments during the M5 build" (the API-key-reaches-renderer D4 deviation; the markdown chunk 372 kB vs ~80 kB projection — three optimisation paths documented in followups, not preemptive; the C75 three-coupled-landings consolidation per the promt11 nuance; the three e2e strict-mode locator collisions surfaced + fixed during C77; the C79 polish kept as a separate commit per the promt15 "do not fold into C77" guidance). Deferred — `docs/m5-followups.md` (API-key-reaches-renderer deviation explicitly tracked; per-profile API key override for M6+; canHandleWrite iteration when a second write-plugin appears; `ctx.openView(viewId)` plugin-api seam; the markdown chunk's three optimisation paths; CodeMirror manualChunks split carry-over; recorded-LLM-playback canary; conversation summary at head-trim; richer starter chips with ord autocomplete; AI-initiated history filter; cross-conversation cost dashboard; token-price refresh via provider metering API; conversation export to markdown; the react-hooks/exhaustive-deps rule as a separate sweep commit chore; the e2e assertion principle "assert on operator-visible outcomes" added to CONTRIBUTING.md).

### M6 — Diagnostic flows + RAG tier 1 (2026-05-15, `v0.6.0-m6`)

Structured plan-and-execute alongside the M5 ReAct loop; knowledge-layer enrichment in the system prompt; summarise-then-drop at head-trim; selection-aware diagnostic-flow quick actions. The plan — `docs/milestone-6.md` (commits C81 → C89 across four phases). Vision context: [`handover.md`](handover.md) Part 2 §A canonical rooftop-diagnosis scenario; [`roadmap.md`](roadmap.md).

- **Structured `PlanStep` data model + `ConditionExpr` DSL + `evalCondition` / `substituteVars` / `substituteValue` helpers** (C82). `PlanStep` tagged union with `tool-call` + `llm-step` kinds for v1; per-step `runIf?: ConditionExpr` (six leaf kinds: `always` / `never` / `var-truthy` / `var-defined` / `var-compare` / `var-length-gt`); `${path}` substitution against bound vars with **type-preservation for whole-token args** (canonical pitfall in `CONTRIBUTING.md` — most niagaramcp tools take `limit: integer` / `force: boolean` / `points: array`, so stringifying everything breaks the SDK's zod validator). `DiagnosticFlow.plan?` optional — flows without `plan` fall back to M5 ReAct via the templated `prompt`.
- **Plan-and-execute runner + inline PlanEditor card** (C83). `packages/llm-provider/src/plan-runner.ts` — `runPlan(...)` async generator yielding the M5 `RunnerEvent` union extended with `plan-step-start` / `plan-step-skip` / `plan-step-complete` / `plan-step-error` / `plan-stop`. Per-step variable binding via `extractBoundValue(rawResult)` (structuredContent → text-JSON-parse → text → raw unwrap so `${equipment.ord}` substitutes from a CallToolResult). `apps/desktop/src/renderer/src/features/chat/PlanEditor.tsx` — inline collapsible preview/run card; per-step status icons (pending / running / done / skipped / error); pre-execution show-and-run; post-completion collapses to "{done}/{total} done · {skipped} skipped · {errored} failed" summary. ChatView branches on `flow.plan` presence — with-plan → PlanEditor + runPlan; without-plan → M5 ReAct fall-through. Same `dispatchTool` plumbing through the C75 safety boundary (AI-attributed writes still route to the pending queue).
- **Async `Plugin.systemPrompt` + 10-second timeout + warning chip** (C84). `Plugin.systemPrompt` return type widens to `string | null | Promise<string | null>` (implicit `Promise.resolve` keeps M5 sync plugins compiling); `assemblePluginContributions` becomes async with a 10-second timeout per plugin; on timeout the section drops + a "Knowledge inventory unavailable" chip surfaces in the chat header. Sync rendering paths (chat empty state, command palette) use a new `collectStaticContributions(plugins, ctx)` subset that's resolved synchronously; full async assembly happens at runner-launch time only.
- **Niagara knowledge-layer enrichment + rooftop / knowledge-summary flows lifted to structured plans + per-(plugin, profileId, connectionId) systemPrompt cache** (C85, split into C85a + C85b per the promt18 ~150-LoC trigger). `plugins/niagara/src/system-prompt.ts` — async; calls `ctx.callTool('getKnowledgeSummary', {})` + formats `## Connected station inventory` section (caps at 20 equipment / 10 type items with `… and N more`); accepts four response shapes (bare object / content[0].text JSON / structuredContent / result-wrapped) + snake_case variants. `plugins/niagara/src/diagnostic-flows.ts` — rooftop-diagnosis becomes a 5-step plan (findEquipment → inspectComponent → getActiveAlarms → readHistory with `runIf: var-length-gt(alarms, 0)` → terminal llm-step summary); knowledge-summary becomes 3 steps. M5 `prompt` field retained as the no-plan back-compat fallback. **`apps/desktop/src/main/cache/system-prompt-cache.ts`** — 30-min default TTL; renderer calls `llm:systemPromptCache:{get,set,clear}` for warm-cache hits (returns cached value + fires fire-and-forget background refresh) vs cold-cache blocking assemble (up to 10s timeout). Cache invalidation precision: TTL-only in v1; per-niagaramcp-`knowledgeHash` is m1-followup coordination work.
- **Summarise-then-drop on conversation head-trim — the M6 deliverable** (C86). When `messages.length` crosses `SUMMARY_TRIGGER_THRESHOLD = 180` (20 below the M5 hard cap of 200 — the **race-against-a-hard-cap** pattern paternised in CONTRIBUTING.md), the renderer fires a one-shot LLM summariser call. `apps/desktop/src/renderer/src/lib/summariser.ts` — `runSummariser(opts) → Promise<SummariserResult | null>` (never throws; null = graceful degradation); preserves "key facts / tool results / conclusions / pending questions"; threads full `tool_use` / `tool_result` blocks; AbortSignal threaded through. `apps/desktop/src/renderer/src/stores/conversations.ts` — `summariseAndTrim(profileId, conversationId, {summarise})` replaces the head with a synthetic `marker: 'summary'` assistant message carrying the summariser call's usage (UsageBadge + workspace-global spend totals see it); re-summarisation continuity (a prior `'summary'` marker is consumed into the next head slice — single summary marker grows in scope, doesn't accumulate). `MessageView` renders the marker as a **collapsible** card (default-collapsed chip; expandable to reveal text). Failure path (null summary): silent-drop head + "Summary unavailable — older messages dropped" fallback chip in the chat header — the **graceful-degradation-on-background-LLM-call-failure** pattern also paternised in CONTRIBUTING.md. Workspace schema additive: `WorkspaceLlmSettings.summariserModel?: 'haiku' | 'sonnet' | 'opus' | 'same-as-main'` (default `'haiku'` — 20× cheaper than Opus for the summary turn); no version bump; permissive migrator. Test escape hatch: `getTriggerThreshold()` / `getHeadSliceCount()` read a `globalThis.__MCPSTUDIO_E2E_SUMMARY_TUNING` override so the C88 e2e can trigger summarisation with a handful of sends.
- **Selection-aware diagnostic-flow quick actions + `useExplorerStore.known` contract formalisation** (C87). New `useHostBus.selectedOrd: {ord, displayName?} | null` state channel (vs the M5 event channel for ord-navigation — peek is the read, publish overwrites with structural-equality short-circuit). Niagara `ExplorerView` publishes on `selected` / `known` changes + clears on unmount. Chat empty-state diagnostic-flow buttons + command palette entries decorate with the selection ("Run rooftop diagnosis on `AHU-1`") and pre-fill the launcher's first text param. `CONTRIBUTING.md` "Cross-view explorer state" section formalises the contract (semantics + `remember(nodes)` registration + consumer roster: QuickNav M2 + HistoryView M4 + MonitorView M4 + M6 selection-aware flows via the host bus + future M7 RAG-on-selection / M8 visual flow builder ord-picker; eviction-is-future note).
- **e2e** — two new specs against the existing mock LLM provider (extended with `summary-success` + `summary-failure` programs that match on `SUMMARISER_SYSTEM_PROMPT` + a `SUMMARY_FAILURE_SENTINEL` user-message token). `chat-plan.spec.ts` — focused on the PlanEditor surface: launches rooftop-diagnosis, asserts the 5-step plan rendered with operator-readable labels + the `if alarms.length > 0` runIf hint, runs the plan and asserts "4/5 done · 1 skipped · 0 failed" (the readHistory conditional skip fires because niagara-mock's `getActiveAlarms → []`). `chat-summary.spec.ts` — two scenarios in separate test blocks (so the failure-path sentinel doesn't bleed): success (2 hello sends → trim → collapsible marker rendered + UsageBadge ≥ 165 confirms summariser usage credited); failure (sentinel-bearing first user message → mock error event → silent-drop fallback chip in the header, no summary marker). e2e green ×11 (8 existing M1+M2+M3+M4+M5 specs + 3 new M6 scenarios).
- Build adjustments — `docs/milestone-6.md` → "Adjustments during the M6 build": the C84 timeout chosen at 10s vs the recon's 5s after observing real `getKnowledgeSummary` latency; the C85 split into C85a + C85b per the cache-infra threshold; the C86 trigger moved to the renderer (vs the recon's main-emitted `conversations:summaryRequired` event — provider lives in renderer per M5 D4, routing through main adds a round-trip without correctness); C86 single-cohesive-commit despite ~700 LoC (cohesion > line count); the C87 `useExplorerStore.known` formalisation deferred from m4-followups (5th consumer threshold met); the C88 catch of a captured-let bug in C83b's `plan-step-complete` handler (the const-snapshot fix). Deferred — `docs/m6-followups.md` (`Plugin.summarisationHints?` per-plugin guidance; per-step edit form + Run/Skip toggle + mid-run pause+edit — M8 visual builder home; `and` / `or` combinators in ConditionExpr; soft-cap-on-token-budget head-trim trigger; rolling summary; multi-agent plan execution; user-saved flows; renderer-side knowledge-browser UI; `knowledgeHash` niagaramcp coordination — added to `m1-followups.md` carry-over list). Resolved (closes from earlier followups lists): conversation summary at head-trim; async system-prompt with knowledge-layer enrichment; selection-aware diagnostic flows; the cross-view `useExplorerStore.known` contract.

---

## Next step

You hand this document to Claude Code as the project's master spec. The first prompt — "read the plan, return an implementation plan for Milestone 1 broken into atomic commits with acceptance criteria, plus a proposed repo structure with rationale for any deviations from §11". We don't touch code until we go through the same recon + plan ritual as for niagaramcp.
