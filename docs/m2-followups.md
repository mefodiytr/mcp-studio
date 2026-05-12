# M2 follow-ups

Things deliberately scoped out of, or deferred during, Milestone 2 (the Niagara
read-only explorer + plugin architecture). Nothing here blocks the M2 deliverable.
See `docs/m1-followups.md` for the M1 / M1.5 lists and the niagaramcp-side
coordination items (which still apply).

## Niagara plugin

- **Tree virtualisation.** `ExplorerView`'s slot tree renders every expanded
  node — no windowing. Real stations land fine at current sizes; adding
  `@tanstack/react-virtual` was deferred to avoid a new (un-cached) dep without an
  observed need. **Add when a real station shows slow render on a wide level**
  (hundreds–thousands of children under one component). (`plugins/niagara/src/views/ExplorerView.tsx`)
- **Property sheet is identity + slots only — no links / extensions panel.** The
  C41 plan sketched a Workbench-style sheet with facets / links / extensions
  sections, but the niagaramcp **read** surface (46 tools) has no
  `listLinks` / `listExtensions` equivalent — `linkSlots` / `unlinkSlots` /
  `addExtension` are *write* tools (M3). So the sheet is `inspectComponent`
  (identity + child count) over `getSlots` (name / type / value / facets). If
  niagaramcp later exposes link / extension *reads*, add two collapsible sections
  (feature-detected on tool presence, fetched on expand). (`plugins/niagara/src/views/PropertySheetView.tsx`)
- **Tree-row context menu / cross-view "open here".** No per-node context menu
  ("copy ORD", "open in property sheet / folder view", "BQL from here"). The
  cross-view actions need a host `ctx.openView(viewId)` hook on `PluginContext`
  (the rail only switches views; it can't be driven from a node). Land the hook +
  menu in C45 or defer to M2 polish / M3. (`packages/plugin-api`, `lib/plugin-context.ts`)
- **`serverInfo.name` is matched by regex (`/^niagara/i`), not pinned.** The
  recorded fixtures carry no `serverInfo`, so the real server name is still
  unconfirmed; the C46 in-process mock server will assert the exact name and the
  manifest's `matches` can be tightened then. (`plugins/niagara/src/manifest.ts`)
- **Quick-nav searches the local `known` cache only.** Ctrl+P fuzzy-matches ORDs
  the explorer has already loaded — it doesn't call the server's search tools
  (`findComponentsByType` / `findInSpace` / `findPoints` / `probeOrd`). A
  server-backed search mode is a follow-up. (`plugins/niagara/src/views/...`)
- **Per-connection explorer state.** `useExplorerStore` is module-global — M2
  surfaces one Niagara connection at a time (the rail binds the first connected
  one). A `connectionId`-keyed split is a follow-up if multiple Niagara
  connections need independent trees. (`plugins/niagara/src/state/explorer-store.ts`)
- **BQL playground editor (C44).** Shipped with CodeMirror 6 via
  `@uiw/react-codemirror` (the pre-flagged offline-cache risk didn't bite — the
  deps fetched fine, so no `<textarea>` fallback was needed). Two follow-ups:
  - **Chunk weight.** The lazy `BqlView` chunk is ~840 kB — `@uiw/react-codemirror`
    pulls the `codemirror` meta-package (basic-setup = autocomplete + search +
    lint + commands + language + view + state). A hand-rolled CM6 integration
    importing only `@codemirror/{state,view,commands,language}` would cut it
    substantially. It's lazy-loaded (only when the BQL view opens on a Niagara
    connection), so not urgent. (`plugins/niagara/src/views/BqlView.tsx`)
  - **Editor theme.** The editor uses CodeMirror's default (light) theme
    regardless of the app theme — add a dark variant keyed off the app's theme.
  - **BQL highlighting is a minimal `StreamLanguage`** (keyword / string / number
    / operator). A full Lezer grammar with completion (column names, type specs)
    is a follow-up. (`plugins/niagara/src/lib/bql-lang.ts`)
