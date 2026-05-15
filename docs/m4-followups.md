# M4 follow-ups

Things deferred during Milestone 4 (observability), with a pointer to where
each fits. Nothing here blocks the M4 deliverable; this is the "we know about
it" list. See `docs/m{1,2,3}-followups.md` for the earlier ones, and the
**niagaramcp-side coordination** list in `m1-followups.md` (which still
applies; M4 introduced no new server-side asks).

## Bundle / build

- **CodeMirror manualChunks split** — same pattern as the M4 C62 recharts
  win (eager bundle dropped ~215 kB once the manualChunks hint let Rollup
  re-plan the chunk graph). The `BqlView` lazy chunk is **~840 kB pure CM6**
  today; when a second CM6 consumer appears (M5 AI co-pilot's chat input
  formatting? raw-console JSON editor enhancement? a real BQL Lezer grammar?),
  add `manualChunks: { codemirror: ['@codemirror/...'] }` next to the
  recharts entry in `apps/desktop/electron.vite.config.ts`. Premature without
  a second consumer; the chunk pattern is documented for the future decision
  point.

## Plugin-api seams (emerging contracts)

- ~~**`useExplorerStore.known` as a session-scoped shared cache.**~~
  **Closed by M6 C87** — the 5th consumer (selection-aware diagnostic
  flows via `useHostBus.selectedOrd`) tripped the formalisation
  threshold. Contract now lives in `CONTRIBUTING.md` "Cross-view explorer
  state": semantics (session-scoped, never-evicted Map), registration
  pattern (`remember(nodes)` walks `children?` recursively, called by
  any view that receives fresh nodes outside the tree-load path), full
  consumer roster (QuickNav M2 + HistoryView M4 + MonitorView M4 + M6
  selection-aware flows + future M7 RAG-on-selection / M8 visual flow
  builder ord-picker), cross-plugin reach via `useHostBus`. LRU/age-out
  eviction explicitly noted as future work in `m6-followups.md` —
  not blocking until a 50k-component station shows up.
- **`ctx.workspace.watches` (or similar persistence seam) on PluginContext.**
  The M4 watch store is the second `window.studio.invoke` consumer inside
  the plugin (after the M3 Bearer bootstrap's `credentials:set` +
  `connections:reconnect`). One leak was tolerable; two surface the
  pattern. A typed plugin-api seam — `ctx.workspace.get<T>(key) /
  set(key, value)` — would also benefit a future M5+ plugin that wants
  per-profile preferences. Add when a third plugin (or the second consumer
  in a *different* plugin) asks.
- **`ctx.openView(viewId)` / `ctx.updateAuthSecret(secret)` / `ctx.reconnect()`** —
  still deferred from M2 / M3 followups. M4 did not relitigate.

## Charts package

- **True LTTB downsampler.** The M4 v1 `downsampleTimeSeries` is a
  min/max bucketed reducer — spike-preserving, but a clean stretch ends up
  visually "fattened" (paired peaks per bucket). A true LTTB (Largest
  Triangle Three Buckets) preserves shape better at the same point budget.
  Swap when visual artefacts on real readHistory data justify it.
- **uPlot fallback for large time-series.** Recharts (SVG) is fine after
  the ≤ 2k downsample, but a station with millions of history points and
  an operator zooming in to a dense window could push past that. Adding
  `@mcp-studio/charts`'s `TimeSeriesChart` a second renderer (uPlot,
  canvas) behind a feature flag — same API surface — gives the perf
  ceiling for a small dep cost (~20 kB gz). Deferred until the recharts
  ceiling is observed in practice.
- **Annotation overlays.** Active-alarm bands on the history chart
  (`getAlarmHistory` keyed by source ord) — feasible against the existing
  niagaramcp tool, separate UX work.

## Live monitor

- **Batched-read primitive.** Today each watch has its own `useQuery` with
  `refetchInterval`; N watches × K Hz = N×K RPS. At N=20 × 1 Hz that's
  20 RPS to the station, which a real Niagara box can probably handle but
  niagaramcp's rate limiting / saturation thresholds aren't characterised.
  A client-side batcher (one coalescer per tick reading all watched ords
  via a tool like `readPointBatch` — would need a niagaramcp coordination
  item, *or* a Promise.all over `readPoint` with shared `refetchInterval`)
  is the M5 perf knob if real workloads need it.
- **Per-row sparkline buffer → shared store.** Each row holds its buffer
  in `useState`; at N=100+ rows this could cause excess re-renders per
  poll. Move buffers into a Zustand store keyed by ord with batched
  updates as a perf knob when the user count goes up.
- **Per-watch threshold notifications.** Native OS notification on cross
  (`new Notification(...)` in Electron) — opt-in per row, with a global
  "do not disturb" toggle. Visual signal lands in M4; auditory / pushed
  signal is M4 polish.
- **Drag-and-drop e2e coverage.** The Monitor watch-list e2e seeds via
  IPC (`watches:set`) for stability — Playwright's drag-and-drop on
  Electron windows with synthesised `DataTransfer` is fiddly. Verified
  manually; revisit when Playwright's dispatchDragEvent surface
  stabilises or when a drag-utility helper emerges.

## History view

- **Per-series ranges.** All overlay series share the active range +
  aggregation in M4. Per-series ranges (e.g. "compare yesterday's RTU-5
  trend with today's") would need a richer series model — separate
  follow-up.
- **`readHistory` real-response-shape confirmation.** The wrapper is
  permissive about field names (`records`/`points`/`samples`,
  `t`/`ts`/`timestamp`, `v`/`value`, ISO datetime *or* epoch ms), and
  the C68a mock pins one shape; the first real niagaramcp call may
  surface a variant the wrapper handles defensively but should also be
  recorded as a fixture for the M2-style locked-contract pattern. One-spot
  adjustment when it lands.

## Performance view

- **Dedicated perf-repo (longer retention).** M4 derives from
  `tool-history` (200-cap shared with the History panel). Real ops-grade
  audit / regression analysis wants a longer window and possibly signed
  exports — split `tool-history` into "recent" + "archive" or introduce
  a dedicated `perf-repo` when the 200-cap proves insufficient.
- **Semantic error-code colouring.** The error-breakdown bar chart
  (in the Tool usage view from C63) uses palette rotation. A semantic
  palette — JSON-RPC -32600 series red, MCP -326xx series amber,
  transport-class grey — would help fast-scan. M5 polish.

## niagaramcp coordination (unchanged)

M4 added no new niagaramcp asks. The existing list in `docs/m1-followups.md`
remains the canonical reference: write-tool annotations, `provisionMcpUser` /
`rotateMcpToken`, the Workbench provision action, enum slot ordinals in
`getSlots`, `bqlQuery` input format + slot value localization polish. None
blocks M5; the `provisionMcpUser` + `rotateMcpToken` work is what unblocks
M5's AI-co-pilot writes-with-attribution scenarios.
