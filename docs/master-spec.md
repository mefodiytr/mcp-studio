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

| Тулзу | Что MCP Studio делает лучше |
|---|---|
| MCP Inspector | Полноценная UI, persistent sessions, history, scripting |
| Claude Desktop connectors | Прямой контроль, без OAuth-обязаловки, debug-grade visibility |
| Workbench Property Sheet | Удалённо, без heavy Java client, скриптуемо |
| Postman для MCP | Schema-aware forms, server capability awareness, multi-server workspaces |
| `curl` + `jq` циклы | Один UI, history, recall, шаринг |

### Differentiators

- **Workbench parity** для Niagara: explorer, property sheet, BQL playground, history viewer, watch-based monitoring.
- **Universal MCP client**: работает с любым MCP сервером, плагинная архитектура для server-specific UI.
- **Production-safe**: diff-and-approve workflow для write-операций, audit log, time-travel, restore points.
- **Scriptable**: macro-recording, replay, parameterised templates, JSON-RPC pass-through.
- **AI co-pilot integrated**: natural-language прослойка поверх tool catalog, доступна как боковая панель.

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
- Renderer стоит на React+Zustand+React Query — стандарт для production-grade desktop. Claude Code знает идиоматически.
- Main process держит MCP-клиент в одном процессе, renderer общается через typed IPC — это даёт нам контроль над credentials (никогда не уходят в renderer), thread-safe сессии, и единую точку для logging/audit.
- Plugin layer на стороне renderer: server-specific UI компоненты подгружаются по `serverInfo.name`. Niagara-плагин рендерит explorer, BQL, property sheet; для незнакомого сервера показывается generic tools/resources/prompts UI.

---

## 4. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Shell | **Electron 30+** | Universal binaries, mature, Claude Code excellent at it. (Tauri alt — меньше bundle, но Rust в стеке усложняет AI-driven dev.) |
| Frontend | **React 18 + TypeScript + Vite** | Industry standard, fast HMR, type safety end-to-end. |
| UI components | **shadcn/ui + Tailwind CSS** | Modern design system, owned (not deps), themeable. |
| State | **Zustand + React Query** | Zustand для local UI state, React Query для server state с caching/refetch. |
| MCP client | **@modelcontextprotocol/sdk** (TypeScript) | Official, typed, supports all transports. |
| Forms | **react-hook-form + zod** | Schema-driven validation, generated from MCP tool input schemas. |
| JSON viewer | **react-json-view-lite** или custom | Collapsible, copyable, searchable. |
| Code editor | **Monaco** (BQL, JSON, prompts) | VSCode's editor, syntax highlight, autocomplete hookable. |
| Charts | **Recharts** или **uPlot** для live monitor | Время-серии, точечные значения. |
| Persistence | **better-sqlite3** (workspace) + **electron-store** (config) | Local-first, no cloud dep. |
| AI integration | **@anthropic-ai/sdk** | Optional co-pilot. User provides their own API key. |
| Distribution | **electron-builder** | NSIS for Win, dmg for Mac, AppImage/deb for Linux. Auto-updater via electron-updater. |
| Testing | **Vitest** (unit) + **Playwright** (e2e) | Standard. |

Один язык (TypeScript) на всём stack'е, один package.json (monorepo через workspaces если будем разделять plugins). Claude Code пишет это в spec'е почти автономно.

---

## 5. Feature taxonomy

Организовано по user goal, не по техническому слою.

### 5.1 Connect to servers

**G:** «I have an MCP server — let me connect to it and explore.»

- **Connection wizard** — добавление нового сервера: transport (HTTP/SSE/stdio), URL, auth method (none / Bearer / OAuth / custom header).
- **Server profiles** — saved connections с тегами (env: dev/staging/prod, project: foo/bar). Quick-switch dropdown.
- **Workspace** — группа профилей. Можно держать несколько workspaces (например, разные клиенты).
- **Connection inspector** — live status, latency, session id, capabilities (tools/resources/prompts counts).
- **Multi-session per server** — несколько одновременных подключений к одному серверу под разными identity (apiToken / user-Bearer / OAuth).

### 5.2 Discover capabilities

**G:** «What can this server do?»

- **Tools catalog** — поиск, фильтр по category/annotations, schema view, last-call timestamps.
- **Resources browser** — static URIs и templates, preview content, MIME-aware rendering (JSON, Markdown, image).
- **Prompts library** — list of declared prompts, parameter forms, preview of generated message stream.
- **Server capabilities** — protocol version, server info, advertised capabilities, transports.

### 5.3 Invoke tools

**G:** «I want to call a tool with specific arguments and see the result.»

- **Schema-derived form** — automatically generated from each tool's input JSON schema (zod runtime + react-hook-form). Type-correct widgets (numeric slider with bounds, enum dropdown with values, autocomplete for known reference types).
- **Result viewer** — structured content rendered as table/tree/JSON; text content with syntax highlight; errors with code + data expansion.
- **Annotation awareness** — destructive tools get a confirm-dialog automatically. Read-only tools batch-runnable without prompt.
- **Argument templating** — `{{cwd}}`, `{{lastResult.ord}}`, `{{prompt:enterValue}}` substitution. Recall previous arguments per tool.
- **Tool history** — every invocation logged with timestamp, args, result, duration. Filter, search, re-run, edit-and-rerun.
- **JSON-RPC pass-through** — send raw JSON-RPC for tools/calls outside the schema mould. Power-user escape hatch.

### 5.4 Browse Niagara station (plugin)

**G:** «I want to navigate the station like a file tree.»

- **Tree explorer (left panel)** — lazy-loaded, virtualised tree of station slot hierarchy. Click to expand, drag to reorder (where supported), context menu per node.
- **Breadcrumb bar** — current path with clickable segments. Always-visible.
- **Property sheet (right panel)** — slot dump of the selected component: type, parent, slots with values, facets, links, extensions. Each row editable inline if writable.
- **Quick navigation** — `Ctrl+P` opens fuzzy-search across all known ords in current cache. Like VSCode's file finder.
- **Folder view** — for any node, see flat children list with column sorting (Name, Type, ORD, Last modified).
- **Component icons** — visual differentiation: 📁 folder, 📊 numeric, 🔘 boolean, 🔤 string, 📐 enum, ⚙️ service, ⏰ schedule, 🔔 alarm class, 📜 history.

### 5.5 Edit components (Niagara plugin)

**G:** «I want to create, modify, and remove station structure safely.»

- **Inline create** — right-click in any folder → `New… → Folder | Numeric Writable | Boolean Writable | …`. Dialog with schema-derived form (type picker, facets builder, initial value).
- **Inline edit slot** — double-click any property in the property sheet → editable. Save on Enter / blur. Errors shown inline.
- **Add extension** — context menu on a point → Add Extension → list of compatible extension types from server (via `getExtensionPoints` tool). Config form generated from extension schema.
- **Wire (link slots)** — visual link mode: drag from source slot to sink slot. Backend validates via `linkSlots`. Type-mismatch offers converter picker.
- **Rename** — F2 on any node. Rename atomic on backend.
- **Move** — drag-and-drop in tree. Backend `moveComponent`.
- **Delete** — Delete key or context menu. Always dry-run first, preview displayed, two-click confirm.

### 5.6 Diff & approve

**G:** «I'm about to push 15 changes. Let me see them all before committing.»

- **Pending changes queue** — every write operation while "Hold" mode is enabled gets queued, not executed.
- **Diff view** — visual list of pending operations: `+ created`, `~ modified`, `- removed`. Per-operation toggle.
- **Apply all / apply selected / discard** — explicit gate. No accidental cascades.
- **Auto-commit toggle** — for fast iteration on dev stations, can disable diff queue entirely (with warning).
- **Audit log** — every committed change recorded locally with user, server, timestamp, full JSON-RPC envelope. Searchable.

### 5.7 BQL playground (Niagara plugin)

**G:** «I want to write a BQL query and see results.»

- **Monaco editor** with BQL syntax highlighting (custom language def).
- **Autocomplete** for known component types, slot names, operators (probed live from station).
- **Result table** — sortable, filterable, paginated. Click row to navigate to component.
- **Query history** — saved with timestamp, can star favourites, share as `niagaramcp://` link.
- **Saved queries** — named, organized in folders, parametrised (`{station}|slot:/Drivers|bql:select * from {type}`).
- **Export results** — CSV, JSON, clipboard.

### 5.8 Live monitor (Niagara plugin)

**G:** «I want to watch 10 points update in real time.»

- **Watch list** — drag points from tree → watch panel. Each row shows current value + facets + status + last-update timestamp.
- **Polling adaptive** — read all watched points every N seconds (configurable, default 5s). Diff to avoid flicker.
- **Subscribe via watch tool** — if server supports MCP watch/subscribe primitives (future), prefer push over poll.
- **Charts mode** — toggle to chart view: each watched point becomes a line on a time-series chart. Configurable window (last 5 min / 1 hour / 24 hour).
- **Threshold alerts** — set per-point bounds; visual + system notification on cross.
- **Export** — CSV time series of recorded history during watch session.

### 5.9 History viewer (Niagara plugin)

**G:** «I want to see historical values, not just live ones.»

- **History tool integration** — via `readHistory` MCP tool.
- **Range picker** — from/to with calendar; presets (last hour / day / week / month).
- **Chart + table dual view** — chart on top, table below, scrubber-synced.
- **Multi-history overlay** — pick N histories, overlay on one chart with color legend.
- **Statistics panel** — min/max/avg/count/coverage% for selected range.

### 5.10 Macros & automation

**G:** «I want to record a sequence of operations and replay it.»

- **Record mode** — every tool call captured into a named macro. Stop recording when done.
- **Macro library** — saved macros in workspace, parametrised via templating.
- **Replay** — execute macro against same or different server. Per-step pause/skip/abort.
- **Schedule** — run macro periodically (via OS scheduler integration or in-app timer).
- **Export as code** — convert macro to TypeScript/Python script using MCP SDK. Bridge between GUI exploration and CI scripts.
- **Share** — macro as `.mcpstudio` file (JSON), drop into another workspace to import.

### 5.11 AI co-pilot

**G:** «Tell me what to do in plain English, do it for me.»

- **Side panel** — chat with Anthropic Claude (user provides API key in settings).
- **Tool-aware** — Claude has access to current server's tools and can call them. The user sees tool-calls happen inline.
- **Confirmation gate** — destructive tools require user confirmation in chat before execution.
- **Context-aware** — current cwd, selected component, last result are auto-included in Claude's context.
- **Macro generation** — «record a macro that creates 10 numeric points named oat_1..oat_10» → Claude proposes macro, user reviews, saves.
- **Documentation lookup** — Claude can read server's resources (manuals, schemas) before answering.
- **Token cost meter** — always-visible counter so user knows what they're spending.

### 5.12 Observability

**G:** «Show me what's actually happening under the hood.»

- **Protocol inspector** — dockable panel showing live JSON-RPC stream. Filter by method, by status, by duration.
- **Performance timeline** — per-call latency distribution. Histogram + slowest-N. Helps diagnose server bottlenecks.
- **Session replay** — pick any past session from audit log, replay the protocol exchange against fresh server. Useful for reproducing bugs.
- **Tool usage stats** — which tools used most, by which server, with what error rates.

### 5.13 Compare & sync (advanced)

**G:** «I want to compare two stations' configurations or sync between dev and prod.»

- **Side-by-side explorer** — two trees, two property sheets. Diff highlighting.
- **Path comparison** — pick subtree on each side, see structural diff (components added/removed/modified).
- **Selective sync** — pick differences, generate macro that brings one side in line with the other. Preview before execute.
- **Snapshot management** — take named snapshots of station subtrees (serialized component structures), restore later.

### 5.14 Permission visualizer (Niagara plugin)

**G:** «Show me what mcpSmokeUser can actually do.»

- **User picker + matrix view** — rows = categories/folders, columns = permissions (r/w/i/R/W/I), cells filled per user's effective rights.
- **Why is this allowed/denied?** — click any cell, see resolved permission chain (user → roles → categories → permissions).

---

## 6. UX paradigms

### Command palette (⌘K / Ctrl+K)
Every action discoverable by name. «create folder», «commit station», «open monitor for /Drivers/RTU1». Powered by Cmdk library.

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

Каждый milestone — 3–5 недель работы Claude Code в рамках одного project.

### Milestone 1 — Foundation (4 weeks)
- Electron + Vite + React + TS skeleton, design system установлен.
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

Чтобы scope не разъезжался — явные границы:

- **Not a Niagara replacement.** Workbench делает много вещей, которых MCP Studio не пытается покрыть: PX graphics editor, complex wire sheets, station provisioning, security manager, license management. MCP Studio — про data & tools, не про IDE.
- **Not a generic SCADA HMI.** Live monitor / dashboards дают наглядность, но это не визуализация уровня PX. Для production-операторов остаётся Workbench / front-end.
- **Not an MCP server framework.** Мы клиент, не authoring tool для серверов. Хотя экспорт macros в код — лёгкий шаг в эту сторону, мы там не углубляемся.
- **Not multi-tenant SaaS.** Local-first by design. Все данные на устройстве пользователя.
- **Not a chat client.** AI co-pilot — feature, не центр продукта. Claude Desktop остаётся лучшим выбором для основного чат-flow.

---

## 13. Success metrics

После 1.0:

- Полный цикл MCP-разработчика (create server → test tools → debug → ship) проходится в Studio за время существенно меньшее, чем через Inspector + cURL + Claude Desktop вместе взятые.
- Niagara-оператор может выполнить базовые задачи (создать точку, добавить history, запустить BQL, прочитать тренд) без открытия Workbench.
- Macro «выполни мой типовой commissioning-сценарий на новой станции» работает end-to-end без вмешательства.
- AI co-pilot способен по фразе на русском воспроизвести смысловую операцию через tools без переспросов в 80%+ случаев.
- 100k-компонентная станция отзывчива (interaction < 100ms на actions, tree expand < 500ms).

---

## 14. Открытые вопросы для следующей итерации

1. **Auth для non-Niagara MCP servers** — OAuth flow интегрировать сразу или Bearer-only в 1.0?
2. **Plugin sandboxing** — насколько изолировать сторонние plugins? Iframe-style или trust-by-default?
3. **Wire sheet** — это stretch goal или critical Niagara parity feature? Зависит от пользователей.
4. **Cloud sync для workspace** — потребность есть, но добавляет surface для security и persistence. Откладываем на post-1.0 или включаем как опцию?
5. **Mobile companion** — стоит ли вкладываться, и в какой форме (read-only, или полноценный)?

Эти вопросы — для product-discovery после первых 2 milestones, когда есть пользователи и фидбек.

### Resolved in M1 kickoff (2026-05-11)

Решения, принятые на старте Milestone 1 — здесь, чтобы будущий читатель спеки понимал «почему так» без раскопок в переписке. Детальный план M1 (atomic commits + acceptance criteria + repo-структура с Δ-списком отклонений от §11): `docs/milestone-1.md`.

1. **Shell — Electron** (не Tauri). Tauri экономит мегабайты ценой Rust-знаний в стеке; для Claude-Code-driven workflow и Node-нативных интеграций (keytar/safeStorage, electron-updater, stdio-subprocess) это бесполезный обмен. §4 это и предполагал; решение подтверждено.
2. **M1 protocol scope — «Standard»: HTTP + stdio + Bearer / custom header / none.** stdio — первичный транспорт по spec и в туториалах сообщества; «MCP-клиент без stdio» — половинчатое позиционирование. OAuth 2.1 / PKCE (redirect listener, refresh, dynamic client registration) — слишком большая поверхность для M1; вынесен в **«M1.5» OAuth mini-milestone** сразу за M1, до Niagara-плагина в M2. Последовательность: universal HTTP+stdio → +OAuth → Niagara plugin. (Закрывает §14.1 для фазы M1.)
3. **Persistence — pure-JS в M1, миграция на better-sqlite3 в M4.** `electron-store` + lowdb-стиль JSON для профилей и tool-call history; better-sqlite3 — native-модуль, ABI-ребилды по матрице Win/Mac/Linux в фундаменте = недели debugging вместо feature delivery. Shape данных проектируется queryable-friendly, в коде явный `// TODO(M4): migrate to better-sqlite3`, чтобы миграция была механической (триггер — macros + audit log из M4/M5, которым нужен queryable backend). Отклонение от §4 «better-sqlite3 (workspace)».
4. **License — Proprietary / All Rights Reserved** на время разработки. Минимальный copyright-notice в исходниках. OSS-решение (MIT/Apache vs commercial vs internal) — после 1.0; не закрываем опции заранее, на скоуп M1 не влияет.
5. **shadcn/ui вендорится в `apps/desktop/src/renderer/components/ui`**, `packages/ui` не создаётся до M2. shadcn — copy-in source, не dep; при одном потребителе общий пакет = чистый оверхед + лишний слой абстракции при каждой кастомизации. Естественный момент выноса — M2, когда Niagara-плагину понадобятся те же компоненты. Отклонение от §11 (`packages/ui`).
6. **Прочее, зафиксированное на старте:** pnpm + electron-vite как build-tool (electron-vite даёт ровно тройку `src/main | src/preload | src/renderer` из §11 одним конфигом — отклонение от §11/§4, где назван только «Vite»); monorepo с первого дня (`packages/{mcp-client, schema-form, plugin-api}` — реальные workspace-пакеты; пустых plugin-стабов нет); main process = единственный источник истины по соединениям и кредам, креды никогда не пересекают границу в renderer; React Query (server-state) + Zustand (UI-state); **React 18**, не 19 (stability over novelty для foundation; upgrade на 19 — отдельный коммит при конкретной причине, напр. React Compiler); i18next подключён, строки только English в M1; e2e против `@modelcontextprotocol/server-everything` (без самописного мока — избегаем техдолга в фундаменте); без code signing / notarization в M1 (unsigned-артефакты в CI как proof рабочего packaging; signing — M8); Python-PoC (`mcp_app.py`, `mcp_console.py`) архивированы в `prototypes/`, не в production git-историю; `@modelcontextprotocol/sdk` оборачивается, JSON-RPC не реимплементируется.

Полный список отклонений от §11 (Δ1–Δ8) с обоснованиями — в `docs/milestone-1.md`.

---

## Next step

Передаёшь этот документ Claude Code как master spec для проекта. Первый промпт — «прочитай план, верни план реализации Milestone 1 разбитый на atomic commits с приёмочными критериями, плюс предлагаемая repo-структура с обоснованием отклонений от §11 если есть». Не лезем в код пока не пройдём через тот же recon + plan ритуал что и для niagaramcp.
