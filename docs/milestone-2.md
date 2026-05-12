# Milestone 2 — Niagara explorer

The first specialized plugin: a **read-only Niagara station browser** that doubles
as a thin Workbench alternative for inspection (spec §5.4, §5.7, §8). This is the
milestone that makes MCP Studio a product rather than "yet another MCP client" —
so it also lays the **plugin architecture** the rest of the roadmap stands on.

**Scope.** Plugin scaffold (loader + detection by `serverInfo.name`); tree
explorer (lazy, virtualised) + breadcrumbs; property sheet (slot dump); quick
navigation (`Ctrl+P` fuzzy-ord search); folder view (sortable flat children); BQL
playground (editor + syntax highlighting + result table). Plus the cross-cutting
plugin foundation: `packages/plugin-api`, `packages/ui` extracted, a plugin
registry, an extensible command registry, and the `{{cwd}}` templating token wired
to the Explorer's selection.

**Out of scope** (deliberately, per the roadmap): write — inline create/edit/
delete, extensions, diff queue, audit log — is **M3**. History viewer is **M4**.
The BearerResolver / user-Bearer write-auth flow is **M3** (see "Decisions" → D5).
Runtime-installable plugin archives, plugin sandboxing, a plugin marketplace —
post-1.0.

## What the host already gives the plugin

The plugin's views talk to the server through the *existing* IPC surface — no new
transport, no main-process extension in M2. A `PluginContext` (from
`packages/plugin-api`) hands a plugin view: the active `ConnectionSummary`, and
thin wrappers over the existing channels — `callTool`, `listTools`,
`listResources` / `readResource`, `listPrompts` / `getPrompt`, `rawRequest`. The
plugin contributes: rail items + tab types (its views), command-palette commands,
and tool-name → schema hints. Detection is by `serverInfo.name` regex
(`manifest.matches`); a non-matching server gets the existing generic
Tools/Resources/Prompts/Raw UI.

## Decisions resolved at kickoff (2026-05-12)

- **Plugin physical model: renderer-only React contributions** [D1]. No
  `plugins/niagara/main/` piece in M2 — every Niagara view works through the
  existing host IPC (D5 makes this possible: niagaramcp's read-tools only need
  the service-identity `apiToken`, which rides the MCP connection-level auth).
- **Loading: build-time pnpm-workspace static import** [D2]. The renderer's
  plugin registry statically imports the known in-box plugins; Vite tree-shakes
  and lazy-chunks the heavy views. Runtime-installable `.mcpstudio` archives
  (marketplace, signing, sandboxing, versioning, security review) are a post-1.0
  product feature, if ever.
- **Security: same-process, trust-by-default** [D3]. VS Code style; we author
  both host and the one in-box plugin. The `packages/plugin-api` contract is the
  seam; sandboxing (iframe/worker, capability-scoped context) is designed if/when
  third-party plugins appear.
- **niagaramcp tool surface** [D4]. The plugin's views target real niagaramcp
  tools (`inspectComponent`, `runBql`, the children/hierarchy tools, …) — the
  exact names + input/output schemas come from a live `tools/list` (niagaramcp
  v0.5.1, ~45 tools; read-tools are what M2 needs). Until that lands, Phase A is
  plugin-agnostic; from Phase B on we build against the real surface, with
  feature-detection (probe `tools/list` at activation; hide a view whose tool is
  missing) as the safety net regardless.
- **No BearerResolver in M2** [D5]. niagaramcp's `apiToken` (service identity) is
  sufficient for all read-tools; `user-Bearer` (via the `mcp:tokenHash` Tag) is
  only required for write-tools (createComponent / setSlot / removeComponent /
  invokeAction / addExtension / linkSlots / commitStation). M2 is read-only → it
  uses the profile's MCP connection-level auth (a Bearer header carrying the
  apiToken, or an OAuth-issued token) for everything. The BearerResolver — and
  the `rotateMcpToken` cross-product coordination with niagaramcp — is **M3**,
  designed there with the write workflow.
- **BQL editor: CodeMirror 6, not Monaco** [D6]. Deviation from spec §5.7 —
  Monaco is ~5 MB+; CodeMirror 6 is a few hundred kB and ample for a BQL editor
  (syntax highlight + autocomplete + a result table). Still lazy-loaded (the BQL
  feature chunk). If CodeMirror's BQL language def proves more involved than
  expected, that's an ad-hoc-check-in trigger.
- **Tree virtualisation: `@tanstack/react-virtual`** [D7] — same author as
  `@tanstack/react-query` (already in); flatten the tree-with-depth, virtualise
  the flat list.
- **`packages/ui` extraction: move all the vendored shadcn components** [D8] —
  clean break; `apps/desktop` and `plugins/niagara` both consume `@mcp-studio/ui`.
- **Version tag after M2: `v0.2.0-m2`** [D9] (milestone-explicit, per the
  `v0.1.5-m1.5` precedent).
- **Rail/tab plugin integration** [D10]: the active connection's plugin
  contributes rail items + tab types; switching between a Niagara connection and
  a generic one swaps the contributed UI in/out (the multi-tab system becomes
  plugin-aware via the active tab's connection).
- **Niagara e2e fixture** [D11]: a tiny in-process MCP server in `tests/fixtures/`
  that exposes the niagaramcp tool names with canned/recorded responses (no real
  station in CI) — built from D4's surface.

## Commits (C33 → C47) — four phases, check-ins at phase boundaries

Same per-commit gate as M1/M1.5: `pnpm lint` + `pnpm -r typecheck` + `pnpm -r
test` + `pnpm --filter @mcp-studio/desktop build` + `pnpm test:e2e`, all green;
atomic; conventional prefix; `Co-Authored-By` trailer. Any commit that touches
`packages/mcp-client`: run its coverage first and add a test in the same commit if
it dips near the floor (78/60/78/80) — no fix-forward.

> Step 0 — `docs: M2 plan` (this file).

### Phase A — plugin foundation (C33–C37) — *check-in after*

The plugin seam exists; no Niagara features yet. (Plugin-agnostic, so it can
proceed before the niagaramcp surface lands.)

- **C33 — `feat: extract packages/ui (vendored shadcn)`.** Move
  `apps/desktop/src/renderer/components/ui/*` (button, dialog, input, sonner,
  command) + `lib/utils.ts`'s `cn` + the Tailwind base into `packages/ui`; the
  app imports `@mcp-studio/ui`. Tailwind config picks up `packages/ui` as a
  `@source`. **AC:** the app builds + renders identically; no circular deps; the
  e2e still green; `@mcp-studio/ui` is importable from a fresh workspace package.
- **C34 — `feat(plugin-api): the plugin contract`.** `packages/plugin-api`: the
  `Plugin` interface (`manifest: { name, version, matches: RegExp | string }`,
  `views: PluginView[]` — each `{ id, title, icon, component }`, `commands?:
  (ctx) => Command[]`, `toolSchemaHints?: Record<string, unknown>`), the
  `PluginContext` (active `ConnectionSummary` + the IPC-wrapper methods +
  `setCwd(path)` for the templating token), the manifest zod schema. **AC:** unit
  tests for `matches` evaluation + the context shape; nothing imports Electron.
- **C35 — `feat: renderer plugin registry + detection + plugin-aware shell`.**
  `renderer/src/plugins/registry.ts` — statically imports the in-box plugins
  (none yet besides a stub), `pluginFor(serverInfo)` → the matching plugin or
  undefined. `AppShell` / `LeftRail` / `TabBar` become plugin-aware: the active
  tab's connection → its plugin → contributed rail items + openable tab types
  (lazy-loaded); a generic connection → the existing views. **AC:** with no
  plugin registered, behaviour is unchanged; a fake test plugin (in a unit test)
  is detected by `serverInfo.name` and its views become reachable.
- **C36 — `feat: extensible command registry`.** `useAppCommands` takes the
  active plugin's `commands(ctx)` and merges them (the `when`-predicate machinery
  generalises). **AC:** a fake plugin's command appears in the palette only when
  its connection's tab is active; the built-in commands are unchanged.
- **C37 — `feat: {{cwd}} templating token`.** `TemplateContext` gains `cwd?:
  string`; `PluginContext.setCwd(path)` publishes it; `expandTemplates` resolves
  `{{cwd}}`. **AC:** unit test — `{{cwd}}` expands to whatever the active plugin
  pushed; falls back to empty when none.

### Phase B — niagara plugin scaffold (C38–C39)

The plugin activates against a Niagara server. (Needs the niagaramcp surface — or
at least its `serverInfo.name` — by here.)

- **C38 — `feat(niagara): plugin scaffold`.** `plugins/niagara` workspace
  package: `manifest` (`matches` the niagaramcp `serverInfo.name`), the `Plugin`
  object with a placeholder Explorer view, registered in the renderer registry.
  **AC:** package builds; the plugin is in the registry; its placeholder view
  renders when a matching connection is active.
- **C39 — `feat(niagara): detection wiring`.** Connecting to a Niagara server →
  the plugin's rail items appear, the connection card shows "Niagara station",
  the Tools/Resources/Prompts views still work (generic, alongside). **AC:** e2e
  (against the fixture, once it exists) or manual — a Niagara connection shows the
  plugin UI; a generic one doesn't.

### Phase C — core niagara views (C40–C45) — *check-in after (the M2 deliverable)*

- **C40 — `feat(niagara): tree explorer + breadcrumbs`.** Lazy-loaded,
  `@tanstack/react-virtual`-virtualised slot-hierarchy tree (children fetched on
  expand via the niagaramcp children tool); a breadcrumb bar; per-node context
  menu (read-only actions: copy ORD, "open property sheet", "open folder view");
  selecting a node publishes its ORD as `cwd`. **AC:** browse the fixture
  station; expand lazily; breadcrumb navigates; large subtrees stay responsive.
- **C41 — `feat(niagara): property sheet`.** Slot dump of the selected component
  (type, parent, slots with values + facets, links, extensions) via
  `inspectComponent`; rows display-only in M2 (the inline-edit affordance is M3).
  **AC:** select a component → its slots render; facets/links/extensions shown.
- **C42 — `feat(niagara): quick navigation (Ctrl+P)`.** Fuzzy search over the
  ORDs known in the current cache (built from the tree walks so far); Enter →
  navigate the tree to it + open the property sheet. **AC:** `Ctrl+P` → type part
  of an ORD → jump to it.
- **C43 — `feat(niagara): folder view`.** For any node, a flat children list with
  column sorting (Name, Type, ORD, …) — a denser alternative to the tree. **AC:**
  open folder view on a node → sortable table of its children; click → navigate.
- **C44 — `feat(niagara): BQL playground`.** CodeMirror 6 editor with a custom
  BQL language (tokenizer + a completion provider fed by live-probed component
  types / slot names); run via the niagaramcp BQL tool; a sortable/filterable
  result table; click a result row → navigate to the component; query history
  (localStorage). **AC:** write a BQL query → run → results in the table → click a
  row → the tree navigates there; history persists.
- **C45 — `feat(niagara): component icons + tool-schema hints`.** Type-aware
  icons in the tree/folder views (folder / numeric / boolean / string / enum /
  service / schedule / alarm-class / history); the plugin's `toolSchemaHints`
  improve the generic Tools-catalog form for known niagaramcp tool names. **AC:**
  components show distinct icons; a known niagaramcp tool's form uses the hint.

### Phase D — polish + e2e (C46–C47) — *big check-in after*

- **C46 — `test(niagara): in-process fixture server + plugin e2e`.**
  `tests/fixtures/niagara-mock/` — a tiny MCP server (Streamable HTTP) exposing
  the niagaramcp read-tool names with canned/recorded responses + a niagaramcp-ish
  `serverInfo.name`. A Playwright e2e: connect to it → the plugin activates →
  browse the tree → open the property sheet → run a BQL query → assert results.
  **AC:** e2e green ×3, flake-free; CI runs it.
- **C47 — `chore: M2 docs + tag`.** `docs/milestone-2.md` build-adjustments
  section; master-spec §-plugin/§-niagara subsection; `docs/m1-followups.md` →
  any M2-deferred items; tag `v0.2.0-m2`.

## Repo-layout deltas (vs. M1/M1.5)

- `packages/ui/` — extracted vendored shadcn (button/dialog/input/sonner/command),
  `cn`, the Tailwind base. New workspace package; `apps/desktop` + `plugins/niagara`
  consume it. [D8]
- `packages/plugin-api/` — the `Plugin` / `PluginView` / `PluginContext` /
  manifest types + the manifest schema. (Spec §11 has had this slot; M1 deferred
  it to "when the first plugin appears" — now.) [D4 of M1 kickoff / now]
- `plugins/niagara/` — the Niagara plugin workspace package (`manifest`, `views/`,
  `commands.ts`, `schemas/`). The `plugins/` dir (a `.gitkeep` since M1) gets its
  first real member.
- `apps/desktop/src/renderer/src/plugins/` — the renderer-side plugin registry +
  loader (the §11 `renderer/plugins/` slot, "populated in M2" — now).
- `tests/fixtures/niagara-mock/` — the in-process niagaramcp-shaped test server. [D11]
- New deps: `@codemirror/state` / `@codemirror/view` / `@codemirror/commands` /
  `@codemirror/autocomplete` / `@codemirror/language` (the BQL editor — lazy
  chunk), `@tanstack/react-virtual` (the tree).

## Adjustments during the M2 build

What actually changed vs. the plan above (so the doc reflects the shipped state
without spelunking commit messages). Full deferred-items list: `docs/m2-followups.md`.

**Phase A (C33–C37)** — landed as planned: `packages/ui` (vendored shadcn
extracted — Button / Input / Dialog / Command + `cn` + the Tailwind base),
`packages/plugin-api` (Plugin / PluginView / PluginContext / PluginCommand /
PluginManifest + `matchesServerName` + `pluginManifestSchema`), the renderer
plugin registry (`IN_BOX_PLUGINS` / `pickPlugin`), the extensible command
registry (`useAppCommands` takes plugin-contributed commands), the `{{cwd}}`
token (`stores/templating.ts`), a plugin-aware AppShell / LeftRail / TabBar
(plugin views rendered in a `<Suspense>` for lazy components). No circular deps;
the app behaves identically with no plugin. (The vendored-shadcn → `packages/ui`
move grew the initial renderer chunk to ~800 kB — noted, not a regression.)

**Phase B (C38–C39)** — `manifest.title` added to `pluginManifestSchema`
(constructive: the host shows "Specialized by <title>" — it shouldn't hard-code
"Niagara"); ConnectionCard badge. `manifest.matches: /^niagara/i` was a flagged
assumption — **confirmed in Phase D**: the real `serverInfo.name` is `niagaramcp`
(the C46 mock pins it; no change needed).

**Phase C (C40–C45)**
- **C41** — the property sheet is `inspectComponent` (identity + childCount)
  over a `getSlots` slot table; *not* the facets/links/extensions panel the plan
  sketched — the niagaramcp **read** surface (46 tools) has no `listLinks` /
  `listExtensions` (those are *write* tools, M3), and `inspectComponent` is
  identity-only. Slots come from `getSlots`, not `inspectComponent`. Display-only
  (inline edit = M3); values shown verbatim (so niagaramcp's display-localized
  `"поистине"` shows through — a niagaramcp-side wart, tracked).
- **C40** — the slot tree is not virtualised: `@tanstack/react-virtual` (plan
  D7) deferred — no observed slow-render need, avoids an un-cached dep mid-stream.
  No per-node context menu — the cross-view bits ("open in property sheet /
  folder view") need a host `ctx.openView(viewId)` hook on `PluginContext`;
  deferred to a follow-up.
- **C44** — the BQL editor is CodeMirror 6 via **`@uiw/react-codemirror`** (not
  the bare `@codemirror/{state,view,commands,autocomplete,language}` set the plan
  named under D6 — the pre-flagged offline-cache risk didn't bite). BQL
  highlighting is a minimal `StreamLanguage` (not a Lezer grammar). The lazy
  `BqlView` chunk is ~840 kB (CM6 + basic-setup) — slimming it (hand-rolled CM6)
  + a dark editor theme + a full Lezer grammar are follow-ups. The `<ord>|bql:`
  ORD prefix is built client-side from a Base-ORD field; row-capping is a
  dedicated `limit` control; a stray SQL `LIMIT n` typed into the query is
  stripped with a warning (both niagaramcp-side warts, tracked).
- **C42** — quick-nav (`Ctrl/Cmd+P`) is rendered inside the Explorer view (works
  while it's the active plugin view, the default); surfacing it as a host palette
  command needs a host-level mount point for the dialog — follow-up.
- **C45** — `toolSchemaHints` wired end-to-end: `ToolsCatalog` resolves the
  active connection's plugin via `pickPlugin` and passes the per-tool hint to
  `ToolInvocationDialog`, which shallow-merges it onto `tool.inputSchema` before
  the args form. The niagara hints overlay English `title` / `description` /
  `examples` onto niagaramcp's (partly Russian-only) schemas.

**Phase D (C46–C47)**
- **C46** — the in-process mock (`tests/fixtures/niagara-mock/server.mjs`) is a
  **dependency-free stdio** server (newline-delimited JSON-RPC, the MCP stdio
  transport), not Streamable HTTP as the plan said — simpler, and `tests/fixtures/*`
  aren't workspace packages so a no-deps script is the clean shape. It replays
  the recorded envelopes (`tools-list.json` + the four `*.json` samples). The
  Playwright e2e (`tests/e2e/niagara-plugin.spec.ts`): connect → "46 tools" +
  "Specialized by Niagara station" → Explorer tree (Services / Drivers; expand
  Drivers → NiagaraNetwork) → select Drivers → Properties shows
  `driver:DriverContainer` → BQL → Run → the recorded `oat` / `1 row` result.
  Green ×3, flake-free.
- **Found while testing (fixes between C45 and C46):**
  - `useConnections()` now seeds from `connections:list` on mount — it only
    subscribed to `connections:changed`, so a component mounted *after* a
    connection was made (a plugin view opened from the rail, the Tools catalog
    navigated to later) stayed empty until the next change event → "This plugin
    view isn't available". (`fix(renderer): seed useConnections …`)
  - `PluginContext.callTool` now unwraps the host's `{ result, error }` envelope
    into the bare `CallToolResult` a plugin reads (`.structuredContent` /
    `.content`) — it was forwarding the envelope verbatim, so *every* niagaramcp
    read came back "empty". Throws on a transport/protocol `error` and on a
    tool-reported `isError` result (so a plugin's `useQuery` surfaces it).
    (`fix(plugin-host): unwrap the ToolCallOutcome …`)
  - `@tanstack/react-query` + `react/jsx-runtime` added to the renderer's
    `resolve.dedupe` — in the production build the lazily-chunked plugin views
    got a *second* React Query instance ("No QueryClient set"); dev mode was
    unaffected, so it only surfaced when the e2e ran the built app.
    (in `test(niagara): in-process fixture server + plugin e2e`)
- **niagaramcp-side coordination** items recorded in `docs/m1-followups.md`:
  write-tool annotations wrong (`readOnlyHint: true` on create/update), slot
  values display-localized, `bqlQuery` input format hostile, tool descriptions
  partly Russian. None blocks M2; relevant to M3 (write & safety).

## Ad-hoc check-in triggers (otherwise: note-and-continue)

1. The `packages/ui` extraction surfaces a hidden circular dependency between the
   renderer and the vendored components (unlikely, possible).
2. The real niagaramcp tool surface differs from the approximate inventory in a
   way that reshapes a view (e.g. no single "children" tool — must paginate /
   walk differently; `inspectComponent`'s output shape forces a different
   property-sheet model).
3. The CodeMirror BQL language def turns out non-trivial (a real grammar, not a
   stream tokenizer) — reconsider scope or accept a plainer editor for M2.

## Check-in points

- **After Phase A** (C37): the plugin foundation is in place — `packages/ui`,
  `packages/plugin-api`, the registry, the extensible command registry, the
  `{{cwd}}` token; the app behaves identically with no plugin registered.
  (Structural milestone.)
- **After Phase C** (C45): the read-only Niagara station browser works — tree,
  property sheet, quick-nav, folder view, BQL playground. (The M2 deliverable.)
- **Big check-in after Phase D** (C47): `git log --oneline` (C33–C47 + docs); a
  screenshot of the Niagara explorer + BQL playground; coverage report; the e2e
  green ×3; the tag `v0.2.0-m2`. Then M3 — write & safety (with the BearerResolver
  + the `rotateMcpToken` coordination).
