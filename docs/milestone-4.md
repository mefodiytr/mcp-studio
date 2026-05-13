# Milestone 4 — Observability

> Live monitor (watch list with polling + spark-lines + threshold visuals), a
> history viewer (`readHistory` + range picker + chart/table dual view +
> aggregation toggle), a performance timeline (tool-call latency aggregated
> from tool-history, regression detection), and tool-usage stats (most-called
> / success rate / avg duration / error breakdown). Charting primitives are
> built shared so the M5 AI co-pilot can render trends inline in chat without
> a second chart lib.

**Target:** `v0.4.0-m4` · ~3–4 weeks · commits C61 → C68, four phases, check-ins at phase boundaries (after A, after C, big one after D). The plan + acceptance criteria + the decisions below are this doc; it's committed as the "Step 0" of M4 (`docs: M4 recon — observability plan`).

The same workflow as M1/M1.5/M2/M3: written plan first → atomic commits, each passing `pnpm lint` + `pnpm -r --if-present typecheck` + `pnpm -r --if-present test` + `pnpm --filter @mcp-studio/desktop build` + `pnpm test:e2e`, all green; constructive deviation = labelled + rationale, never silent; the §13 coverage ratchet (run coverage before committing if a commit touches a covered package; add a test in the same commit if near the floor; no fix-forward); no progress check-ins within a phase except (a) ad-hoc on an architectural contradiction, (b) phase boundaries. The C-numbering is a guideline — splits / re-orderings are pragmatic atomicity, not deviations.

---

## What earlier milestones already give M4

- **`tool-history-repository`** — every tool call is already persisted (`toolHistoryEntrySchema` with `durationMs` + `status` + `profileId` + `toolName` + `args` + `ts`, capped at 200 in `workspace.json`). M3 added the optional `write` flag. **The perf timeline + tool-usage stats are *derivations* of this data — no new storage needed in M4.**
- **`ProtocolTap` ring buffer** (`apps/desktop/src/main/connections/protocol-tap.ts`, cap 2000) — in-memory JSON-RPC traffic, per process. Feeds the Protocol inspector. M4 leaves it alone; persistence isn't worth a new repo for M4 (see §D5).
- **`niagaramcp.readHistory` tool** — already callable today via the generic Tools catalog (`{ ord, from, to?, aggregation?, limit? }` → history records). M4 adds a *view* around it; the tool surface is unchanged.
- **The `PluginContext` seam** — M3 added `callTool(name, args?, opts?: { write?: boolean })`. M4 needs nothing additional from `plugin-api` (the watch / history work is read-only).
- **`workspace-store` (JSON, atomic *.tmp→rename, `schemaVersion` + `migrate()`)** — the watch-list persistence (§D4) extends `WorkspaceData` with a new field + a one-step migrator; same JSON store, no new file.
- **The stateful `tests/fixtures/niagara-mock/server.mjs`** — gains a `readHistory` handler in C67 (returning a canned multi-day sine/saw time series + alarm-overlay data); the M2 + M3 e2e specs stay unchanged.

---

## Recon — decisions, with recommendations

### D1 — Charting library: **recharts**, with a downsampling pass at the edge

Three credible candidates for the M4 chart set (time-series + spark-lines + bar/donut for usage stats):

- **recharts** — React-first, declarative, D3 underneath, ~95 kB gz. Idiomatic in this codebase; composes naturally with the rest of the React Query / state shape; covers every M4 chart kind (line, area, sparkline, bar, donut). Cost: SVG rendering drags past ~5k points per series.
- **uPlot** — ~20 kB gz, ultra-fast canvas time-series. Imperative API; perf headroom up to ~1M points. No bar / donut support (we'd carry a second dep for usage stats).
- **lightweight-charts** (TradingView) — ~50 kB gz, optimised for time-series. API surface too trading-domain-specific (candlesticks, crosshairs); generalises poorly to the usage-stats bar charts.

**Recommendation: recharts, with a `downsampleTimeSeries(points, maxPoints)` helper applied *before* render** (LTTB or simple bucketed-mean, ≤2k output points). One declarative library covering history + sparklines + usage stats + (M5) the AI co-pilot's chat-inline trend. The 2k cap keeps SVG fast enough for a realistic readHistory window without losing the visual shape; the helper is one pure module, easy to swap for uPlot later if a real-world dataset proves SVG-too-slow.

**Out of scope for M4:** uPlot as a secondary perf-tier; revisit only if recharts hits a wall on a realistic station's `readHistory`.

### D2 — Live monitor state model: per-watch React Query, polling, off-when-idle

The watch list is N point ords each polled every K seconds. Three shapes:

- (a) **One `useQuery` per watch row**, `refetchInterval: K`, `refetchIntervalInBackground: false`. Composes with the existing query cache; tab-blur pauses naturally; tab-switch unmounts the rows, the cache keeps the last values, remount resumes.
- (b) **One central polling loop** in a Zustand store, batched reads, manual subscriber notifications. Fewer round-trips when ords share a server, but reinvents cache invalidation and gives up React Query's wins.
- (c) **MCP `subscribe`/`watch` primitives** — niagaramcp doesn't ship any today; revisit if/when it does.

**Recommendation: (a).** Each watch row uses a `useReadPoint(ord, { intervalMs, paused })` hook backed by `useQuery({ queryKey: ['niagara', cid, 'readPoint', ord], queryFn, refetchInterval: paused ? false : intervalMs, refetchIntervalInBackground: false })`. Per-row interval (small popover: 1 s / 5 s / 10 s / 30 s / 1 min / paused; global "pause all" affordance) lives in the watch store (D4); the hook reads it as a derived selector. Off-when-idle is React Query's built-in `refetchIntervalInBackground: false` on tab-blur. Tab switches are free (Niagara plugin view unmount + remount; the query cache keeps the values; polling resumes on remount). When niagaramcp later ships subscribe, the same hook switches to push transparently — the consumer doesn't change.

**Caveat:** at N=50 watches × 5 s polling, that's 10 RPS to the station. A debounced **batch-read** path (manual store with a single `readPointBatch` request — needs niagaramcp side-fix or a client-side coalescer) is an M5 optimisation if real workloads need it. M4 ships per-row.

### D3 — History viewer scope: **Niagara-plugin-contributed for v1**, primitives shared

`readHistory` is a niagaramcp-specific tool name with a niagaramcp-specific arg shape (ord + from/to + aggregation enum + limit). An MCP-spec convention for "history" doesn't exist yet, so a host-level "universal" history viewer would either (a) hard-code niagaramcp's tool name (a leak), or (b) wait on a protocol convention (not M4-able). **Recommendation: the history *view* lives in `plugins/niagara` (sixth view, `History`)**, but the **chart primitives + downsampler live in a new `packages/charts` workspace package** so the AI co-pilot (M5; `handover.md` §A — rooftop diagnosis renders readHistory results as an inline chart in chat) consumes them without a second chart lib. The view's `readHistory` wrapper (`plugins/niagara/src/lib/niagara-history.ts`) is the Niagara-specific layer; the chart components don't know about niagaramcp.

**Extraction path** — when MCP standardises a history capability (or when a second plugin ships a `readHistory`-shaped tool), a host-level `History` view can delegate to per-plugin renderers via a small plugin-api extension (`Plugin.historyAdapter?`); for now the view stays in the plugin.

**Out of scope for M4:** annotation overlays (active alarms drawn on the history chart by time range) — feasible against `getAlarmHistory` but separate UX; M5 candidate.

### D4 — Watch list persistence: per-profile in `workspace.json`

Three options:

- (a) **Per-tab session-only.** Loses the operator's watch list on close — wrong shape for a real artefact ("the 8 points I monitor on RTU-5").
- (b) **Per-`profileId`, persisted in `workspace.json`.** Survives restarts; reconnects to the same profile restore the watches. `connectionId` is session-only, so per-profile is the stable key.
- (c) **One global watch list shared across connections.** Semantically weird — watches are point-ord-shaped, and ords are station-specific.

**Recommendation: (b).** Extend `WorkspaceData` with `watches?: Record<profileId, Watch[]>` where `Watch = { ord, displayName?, intervalMs, paused, threshold?: { low?, high? } }`. One-step migrator (`schemaVersion` bump) seeds an empty record for existing workspaces. Read/write via a new `state/watch-store.ts` in the Niagara plugin that bridges to the host's `workspace:*` IPC (or a thinner dedicated IPC if needed — small).

Within a workspace, the watch list survives reconnects to the same profile. Closing the app + reopening + reconnecting → watches reappear.

### D5 — Performance timeline data source: derive from `tool-history` (no new repo in M4)

Four candidates:

- (a) **Existing `ProtocolTap` ring buffer.** In-memory, cap 2000, no persistence — cross-session timeline lost.
- (b) **A new `perf-repo`.** Persist raw protocol events. Storage grows; build cost.
- (c) **Aggregate at write time into per-minute / per-hour buckets.** Compact + persistent + queryable. Storage cheap; build cost moderate.
- (d) **Derive from `tool-history`.** Already persisted (200-cap default), already attributed, already carries `durationMs` + `status`. Pure renderer-side aggregation.

**Recommendation: (d) for v1, with the 200-cap raised to ~2000 in `workspace.json` as a small follow-up if real-world telemetry needs more history.** Tool-history covers the tool-call latency story end-to-end; ProtocolTap stays unchanged for the live inspector. A dedicated `perf-repo` (longer retention, signed export, finer-grain than tool-history) is an M5+ candidate when ops-grade audit needs it.

**Implication:** the perf-timeline view is a derivation, not a write surface. `apps/desktop/src/renderer/src/lib/perf-stats.ts` — pure helpers (`latencyHistogram(entries) → bins[]`, `slowestN(entries, n)`, `errorBreakdown(entries) → Map<code, count>`, `p95DeltaOverWindows(entries, windowMs)` for the "regression detection" callout). UI consumes these from `useHistory()`.

### D6 — Tool-usage stats: derivation, not new storage

Same family as D5. Pure aggregations on tool-history:
- **Most-called** — top N by `count(toolName)`.
- **Success rate** — `count(status='ok') / count(*)` per tool.
- **Avg duration** — `avg(durationMs)` per tool, with a p50 / p95 next to it.
- **Error breakdown** — distribution of error codes per tool.

`apps/desktop/src/renderer/src/lib/usage-stats.ts` — pure helper, unit-tested. The view renders four small charts (recharts BarChart + a tiny ranked list).

### D7 — Cross-cutting: chart primitives reusable for M5 (handover.md §A)

`packages/charts` ships **renderless-about-layout** components:

- `TimeSeriesChart` — line / area chart for `{ series: [{ name, points: {t, v}[] }, …], xDomain?, yDomain?, height? }`.
- `Sparkline` — small inline `points: {t, v}[]`, no axes, optional threshold band.
- `BarChart` — `{ items: [{label, value, color?}, …], orientation?, valueFormat? }`.

No domain knowledge. The Niagara history viewer wraps `TimeSeriesChart` with the `readHistory` data source; the live monitor wraps `Sparkline` with the recent in-memory polling buffer; the tool-usage view wraps `BarChart` with `usage-stats.ts` aggregations; the AI co-pilot (M5) embeds the same `TimeSeriesChart` inside a chat message with whatever data it pulled. **One chart lib, one downsampler, four consumers.**

---

## Commits (C61 → C68) — four phases, check-ins at phase boundaries

> Each commit passes lint + typecheck + tests + desktop build + e2e. The C-numbering is a guideline — substantial UI commits splitting mid-flight is pragmatic atomicity, not a deviation.

**C61 — `docs: M4 recon — observability plan`** — this document. (Step 0.)

### Phase A — charts foundation + tool-usage stats (C62–C63) — *check-in after*

- **C62 — `feat: packages/charts (recharts wrappers + downsampler)`.** New workspace package `@mcp-studio/charts`. Exports `TimeSeriesChart`, `Sparkline`, `BarChart` (thin recharts wrappers; renderless about layout — height controlled by parent), `downsampleTimeSeries(points, maxPoints)` (LTTB-ish bucketed mean; pure; tested). New dep: `recharts`. **AC:** the package builds + tests; no other package imports it yet; the components render correctly in isolation (unit tests with a tiny jsdom or just snapshot the rendered SVG counts).
- **C63 — `feat(desktop): tool-usage stats view`.** `lib/usage-stats.ts` — pure helpers: `usageByTool(entries) → { name, count, okCount, errCount }[]`, `latencyStats(entries) → { name, avgMs, p50Ms, p95Ms }[]`, `errorBreakdown(entries) → Map<code, count>`. A new "Tool usage" feature view (rail item) — for the active connection (with an "all connections" toggle): a most-called BarChart + success-rate bars + per-tool latency (avg / p50 / p95) table + error-code donut. + unit tests on the pure helpers. **AC:** the view renders against the existing `tool-history` data; read-only servers see an empty state.
- → **Check-in after Phase A:** charts package + tool-usage stats land; the rest of the app behaves identically.

### Phase B — Niagara history viewer (C64) — *no mandatory checkpoint*

- **C64 — `feat(niagara): history view (readHistory + range picker + chart/table)`.** A sixth Niagara plugin view (`History`, lazy). `lib/niagara-history.ts` — typed wrapper over `readHistory({ord, from, to?, aggregation?, limit?})` (parses the response shape defensively; the wrapper returns `{ points: {t, v}[], rowCount, raw }`; downsamples to ≤2k points before display). View UX: a header with `ord` (or multi-ord — picker from the explorer's `known` cache), range picker (presets: last 1 h / 24 h / 7 d / 30 d + custom from/to), aggregation toggle (none / avg / min / max / count), `TimeSeriesChart` (recharts via the C62 wrapper) + a paginated table dual-view (the table rows match the same `t, v` data). Multi-history overlay — pick N points, render each as a coloured series on the same chart. + unit tests for the wrapper / downsampler integration. **AC:** select an ord with history (the C67 mock will gain a canned response) → chart renders → toggling aggregation re-fetches and re-renders; the table dual-view scrolls.

### Phase C — live monitor (C65–C66) — *check-in after (the M4 deliverable)*

- **C65 — `feat(niagara): watch store (per-profile, persisted)`.** `WorkspaceData.watches?: Record<profileId, Watch[]>` (zod schema bump + `schemaVersion` migrator). `plugins/niagara/src/state/watch-store.ts` — Zustand bridge to the host's workspace IPC (`workspace:get/set` or a dedicated `watches:*` IPC — small; whichever is cleaner). Per-watch state: `{ord, displayName?, intervalMs, paused, threshold?: {low?, high?}}`. + unit tests for the store reducer + the migrator. **AC:** add/remove/toggle/threshold-set persists across an app restart against the same profile.
- **C66 — `feat(niagara): live monitor view + spark-lines + thresholds`.** A seventh Niagara plugin view (`Monitor`). Drag-from-Explorer to add (or right-click → "Watch this point"). Each row: current value (large) + Sparkline (recharts) over the last N polls (~60) + status + last-update + per-row interval popover (1 s / 5 s / 10 s / 30 s / 1 min / paused). Threshold visuals: bands on the sparkline, row highlight + (opt-in) native OS notification on cross. React-Query-per-watch polling (`useReadPoint(ord, {intervalMs, paused})`); `refetchIntervalInBackground: false`. + tests for the threshold-cross detector. **AC:** drag N points → live values + sparklines; off-tab → polling paused; thresholds tripped → row + notification fire once per crossing (not every poll).
- → **Check-in after Phase C — the M4 deliverable:** live monitor + history viewer + tool-usage stats wired and operator-usable; M3 write workflow + M2 read flows unchanged.

### Phase D — perf timeline + polish + e2e + tag (C67–C68) — *big check-in after*

- **C67 — `feat(desktop): performance timeline view + readHistory in mock + e2e`.** `lib/perf-stats.ts` — pure helpers: `latencyHistogram(entries, bucketMs?) → {bucket, count}[]`, `slowestN(entries, n)`, `p95DeltaOverWindows(entries, windowMs)` (the "regression detection" callout: compare p95 over the last window to the previous; flag deltas > X%). A new "Performance" feature view: histogram + slowest-N table + the regression callout when triggered; toggles for per-connection / per-tool / per-window filters. The stateful `niagara-mock` gains a `readHistory` handler returning a canned multi-series sine/saw time series for any `ord` (so the history view can be e2e'd against a stable shape). Extend the existing write e2e (or a new spec) to cover: add a watch → see polling update the value → open History view → readHistory renders → open Performance view → bars + slowest-N present. **AC:** e2e green ×5 (or ×4 if the existing spec extends), flake-free.
- **C68 — `chore: M4 docs + tag`.** `docs/milestone-4.md` "Adjustments during the M4 build"; master-spec → an "M4 — Observability" section; `docs/m{1,2,3}-followups.md` → mark resolved items if any; `docs/m4-followups.md` → the M4-deferred items (uPlot fallback if perf needs it; alarm-overlay on history chart; batch-read for the watch list; signed audit export; per-watch threshold notifications); tag `v0.4.0-m4`.
- → **Big check-in after Phase D:** `git log --oneline` C61–C68 + screenshot capture (extend the e2e screenshot pass with `m4-history`, `m4-monitor`, `m4-usage`, `m4-perf`); coverage report; e2e green; the tag `v0.4.0-m4`.

---

## Repo-layout deltas (vs. M3)

- **`packages/charts/`** — new workspace package (`recharts` wrappers + `downsampleTimeSeries`). New runtime dep: `recharts`. Consumed by `plugins/niagara` (history + monitor) and `apps/desktop` (tool-usage + performance views); designed for M5 AI-co-pilot reuse.
- **`apps/desktop/src/renderer/src/lib/`** — `usage-stats.ts`, `perf-stats.ts` (pure aggregation helpers over `tool-history`).
- **`apps/desktop/src/renderer/src/features/usage/`**, **`.../features/perf/`** — the two new host-level views (or a single "Insights" view splitting on tabs — judgment call at C63 / C67 time).
- **`apps/desktop/src/shared/domain/workspace.ts`** — `watches?: Record<profileId, Watch[]>` + `schemaVersion` bump + the `Watch` zod schema. **`migrate()`** seeds an empty record on the way up.
- **`plugins/niagara/src/views/`** — new `HistoryView.tsx`, `MonitorView.tsx`. `plugins/niagara/src/lib/niagara-history.ts`, `plugins/niagara/src/state/watch-store.ts`.
- **`tests/fixtures/niagara-mock/server.mjs`** — gains a `readHistory` handler returning a canned multi-series sine/saw + any new sample envelopes recorded into `tests/fixtures/niagara-mock/` for the M2-style integration shape. M2 + M3 spec assertions stay green.

## Adjustments during the M4 build

What actually changed vs. the plan above (so the doc reflects the shipped state without spelunking commit messages). Full deferred-items list: `docs/m4-followups.md`.

**Pre-Phase-A housekeeping** — `chore: split recharts into a shared chunk for chart-bearing views` (5d3f7c3). One-line `manualChunks: { recharts: ['recharts'] }` rollup hint in `apps/desktop/electron.vite.config.ts`. Forced the split *before* a second consumer landed (the plan had it as "Vite figures it out eventually") so lazy chunks stay small from day one. **Side win:** the eager renderer bundle dropped 815 → 599 kB (-215 kB) — Rollup re-planned the chunk graph more aggressively once it had an explicit chunking instruction. The chunk-graph pattern is documented as an M4-followup (CodeMirror is the next candidate when a second CM6 consumer appears).

**Phase A (C62–C63)** — landed as planned.
- C62 — `packages/charts` with three renderless-about-layout primitives (`TimeSeriesChart`, `Sparkline`, `BarChart`) + `downsampleTimeSeries` (min/max bucketed reducer that preserves spikes; a true LTTB is an m4-followup) + `paletteColor` / `DEFAULT_PALETTE`. The Sparkline is hand-rolled SVG (recharts' `ResponsiveContainer` overhead is wasted at 24-px height) with a `threshold` prop that recolours the line red on a crossing. + 12 unit tests (downsample × 8, mergeSeries × 4).
- C63 — `lib/usage-stats.ts` (`usageByTool` / `latencyStats` / `errorBreakdown` — pure derivations, nearest-rank percentile, sort by avg desc) + a new "Tool usage" host-level view: most-called BarChart (top 10 horizontal) + per-tool latency table (avg/p50/p95) + error breakdown. Scope toggle (active connection / all) + writes-only filter that threads the M3 audit `write` flag. +10 unit tests. The M3 niagara-write e2e was extended with a "navigate to Tool usage" step + an `m4-usage` screenshot.

**Phase B (C64)** — single commit, the multi-history overlay fit comfortably alongside the single-history core.
- `lib/niagara-history.ts` — defensively-typed `readHistory` wrapper (accepts `records`/`points`/`samples` array names + `t`/`ts`/`timestamp` and `v`/`value` field variants + ISO datetime *or* epoch ms + bool→0/1 + null gaps; returns `{ord, points, raw, truncated, rowCount}` with `points` already downsampled to ≤2k). + `presetRange` + `AggregationMode`/`RangePreset` exports. +14 unit tests.
- `views/HistoryView.tsx` — sixth Niagara plugin view (lazy, `LineChart` icon): five preset range buttons + custom `datetime-local`, aggregation toggle (none/avg/min/max/count), `useQueries` (not a loop of `useQuery`) for the dynamic-length series set so the rules-of-hooks holds, `<TimeSeriesChart>` over union-merged series + per-series paginated table dual view, truncation banner, multi-history overlay via a `CommandDialog` over `useExplorerStore.known`.
- `useExplorerStore.known` becoming a cross-view shared primitive (Quick-nav + History overlay picker + Monitor drop-target lookup, plus the forthcoming M5 AI co-pilot autocomplete) was flagged here and tracked in `m4-followups.md`.

**Phase C (C65–C66) — the M4 deliverable.**
- C65 — `shared/domain/watches.ts` + `WatchesByProfile = Record<profileId, Watch[]>` zod; `WORKSPACE_VERSION` 2 → 3 with an **idempotent** migrator (re-running on a v3 file is a no-op; every field reads defensively); `watches:list`/`watches:set` IPC; `WatchRepository` (+ 8 unit tests). Plugin `state/watch-store.ts` Zustand mirror with `ensureLoaded` (hydrates once per profile per session), `upsert`/`remove`/`patch`/`clear`, and a stable `EMPTY` reference from `selectWatches` (the C55 Zustand-singleton guard — derived-collection selectors must reuse the empty default or `Object.is` loops subscribers). +9 unit tests. The `Watch` interface is a structural mirror of the host type — same `window.studio` IPC pattern as M3's bootstrap; tracked in `m4-followups.md` as a `ctx.workspace.watches` plugin-api seam to surface now that there are two `window.studio` consumers in the plugin.
- C66 — seventh Niagara plugin view (`Activity` icon). Drag-from-Explorer (TreeNode rows are `draggable` setting `application/x-niagara-ord`; the Monitor body is the drop zone, looks the ord up in `useExplorerStore.known` to cache a `displayName`). Per-row poll interval popover (the C65 `POLL_INTERVALS_MS`: 1s/5s/10s/30s/1min/paused) backed by `useQuery({ refetchInterval, refetchIntervalInBackground: false })` — paused rows freeze, backgrounded tab auto-pauses. Per-row threshold editor; `<Sparkline>` recolours red on crossing and the value cell turns red too. Global "Pause all" toggle. Per-row local sparkline buffer capped at 60 samples — **a found-while-screenshotting bug in C68a**: the buffer's `useEffect` was keyed on `[q.data]`, so a flat-signal sequence with identical query-result references never fired the effect and the sparkline never grew past one point (`buildPath` returns null with < 2 numeric points). Fixed by keying on `[dataUpdatedAt, value]` — React Query's `dataUpdatedAt` bumps every fetch regardless of value identity.

**Phase D (C67–C68).**
- C67 — `lib/perf-stats.ts` (`latencyHistogram` over fixed log-ish buckets / `slowestN` / `p95DeltaOverWindows` with a 25% regression threshold) + Performance host-level view (BarChart histogram + regression panel + slowest-N table; window selector 1h/6h/24h/7d). +11 unit tests.
- **C68a** — niagara-mock gains `readPoint` (deterministic sine over wall clock, base offset hashed from the ord) + `readHistory` (~1 sample/min across the requested range, same sine shape); new `niagara-observability.spec.ts` e2e exercises History + Monitor + Performance end-to-end against the stateful mock, with the `m4-history` / `m4-monitor` / `m4-perf` screenshots captured under `MCPSTUDIO_E2E_SCREENSHOTS=1`. Drag-and-drop into the Monitor is **seeded via the `watches:set` IPC in the e2e** (Playwright drag-and-drop on Electron with synthesised DataTransfer is fiddly); the drag affordance is verified manually and tracked as an m4-followup. The Monitor sparkline `dataUpdatedAt` fix surfaced here lands in the same commit.
- C68 — this section + the master-spec M4 section + `m4-followups.md` + the tag `v0.4.0-m4`.

**Numbering:** Phase D ended up as three commits (C67 + C68a + C68b) — the "feat: mock + e2e + sparkline fix" cleanly stood apart from "chore: docs + tag", and the chore landing alone keeps the close-out commit clean. Per the milestone plan's "C-numbering is a guideline".

## Ad-hoc check-in triggers (otherwise: note-and-continue)

1. **recharts perf wall.** A realistic `readHistory` window renders too slowly even after downsampling → ad-hoc check-in to consider an uPlot fallback for the time-series chart only (charts package gains a second renderer, sparkline + bar/donut stay recharts).
2. **Per-row polling overloads the connection.** N=50 watches × 5 s → 10 RPS sustained chokes niagaramcp or the IPC → ad-hoc to add a client-side batching layer (single store-driven loop reading all watched ords each tick) or to pull batched-read into a niagaramcp coordination item.
3. **`readHistory` response shape isn't what the wrapper assumes.** A real niagaramcp call returns a shape the defensive wrapper can't unpack → record a sample, reshape both wrapper + mock in the same commit.
4. **Watch-list workspace persistence collides with `workspace-store`'s migration story.** The `schemaVersion` bump + per-profile schema turn out fiddlier than the §D4 sketch → ad-hoc; possibly move watches to a dedicated `watches.json` instead of growing `workspace.json`.
5. **The chart-package extraction surfaces a workspace circular import** (e.g. `@mcp-studio/charts` → `@mcp-studio/ui` → some indirect path back) → ad-hoc to flatten before consumers wire in.

## Check-in points

- **After Phase A** (C63): chart primitives + tool-usage stats land; the chart package is consumable; the rest of the app behaves identically. (Structural milestone — gives the M5 AI co-pilot work a chart dep to build on.)
- **After Phase C** (C66): the live monitor + history viewer are operator-usable end-to-end against the stateful mock. (The M4 deliverable.)
- **Big check-in after Phase D** (C68): `git log --oneline` C61–C68 + new screenshots (`m4-history`, `m4-monitor`, `m4-usage`, `m4-perf`); coverage report; e2e green; the tag `v0.4.0-m4`. Then M5 — AI co-pilot (`handover.md` Part 2) with the chart primitives already there for chat-inline trend rendering.
