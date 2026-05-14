# M5 follow-ups

Things deferred during Milestone 5 (AI co-pilot), with a pointer to where
each fits. Nothing here blocks the M5 deliverable; this is the "we know about
it" list. See `docs/m{1,2,3,4}-followups.md` for the earlier ones, and the
**niagaramcp-side coordination** list in `m1-followups.md` (which still
applies; M5 introduced no new server-side asks — every M5 feature ships
against the M4-era niagaramcp tool surface).

## Architecture seams

- **API key reaches renderer via `llm:getKey` IPC** — documented deviation
  from the M5 D4 aspiration of "key never leaves main". The reason
  (`docs/milestone-5.md` D4 Adjustments, the `apps/desktop/src/main/ipc/
  llm.ts` docstring, and the C71 commit message all carry it): the
  `@anthropic-ai/sdk` is ESM-first; Electron-33 main is CJS-bundled per the
  M1 C7b decision; bringing the SDK into main would mean fighting the
  bundle config to keep the `MessageStream` async-iterator semantics
  intact. The compensating control: the key is fetched on-demand into the
  chat-runner's closure for the lifetime of one ReAct iteration — no
  long-lived renderer state holding the key. The M6+ background-agent /
  scheduled-flow case is where this moves into main; the IPC remains the
  canonical setter / hint accessor at that point.

- **Per-profile LLM API key override** — M5 D4 ships workspace-global only
  (one Anthropic key for every connection). The MSP / multi-customer
  billing case (one operator running MCP Studio against multiple customers'
  stations with separate billing) wants per-profile override. The vault
  infrastructure (`llmKeys: Record<provider, …>`) already supports it; the
  add-on is renderer-side UI + a `provider:profileId` keying scheme.
  Surface alongside M7's multi-provider work when real workflow shows the
  need.

- **`Plugin.canHandleWrite` actually iterated.** M5 hardcodes the chat
  view → niagara plugin enqueue path (single write-capable plugin reality);
  the `canHandleWrite` hook is on the contract but not iterated yet. When a
  second write-capable plugin appears, replace the direct
  `enqueueAiWrite(...)` import with a host iteration that asks each active
  plugin via `canHandleWrite` + dispatches to the first claimant.

- **`ctx.openView(viewId)` plugin-api seam** — the M3 carry-over (originally
  the "cross-view jump from the tree menu" case) now has a second use case:
  M5 C79's ord-chip → Explorer-view switch is currently AppShell-level
  (knows the niagara plugin's view ids by name). A `ctx.openView('explorer')`
  on `PluginContext` would let the chat view delegate to "whatever the
  active plugin's explorer-equivalent view is".

## Performance / bundle

- **Markdown chunk size (372 kB).** The `react-markdown` + `remark-gfm`
  shared chunk landed bigger than projected — remark-gfm pulls a fair
  micromark + unified stack. Loads once per session (caches on first chat
  open). Three concrete optimisation paths if first-open chat latency
  hurts:
  - **(a) Drop remark-gfm → plain CommonMark.** The LLM does emit tables
    + strikethrough, so this is a real loss of capability.
  - **(b) Lazy-load micromark extensions per GFM feature.** Complex; the
    micromark API surface isn't built for this. Marginal win.
  - **(c) Worker-thread markdown parsing on long conversations.** The
    parser is pure → workerizing the parse keeps the main thread snappy
    on a 50-turn diagnostic walk. Stretch M6+ work.
  None of these is preemptive; the path lands when the symptom does.

- **CodeMirror `manualChunks` split** — carry-over from M4 followups. The
  `BqlView` lazy chunk is 831 kB pure CM6 today. When a second CM6 consumer
  appears (M5 didn't add one — the chat input is a plain `<input>`), add
  `manualChunks: { codemirror: ['@codemirror/...'] }` next to the recharts +
  anthropic + markdown entries.

- **`MockProgram` registration timing** — M5 hardcodes `MOCK_PROGRAMS` in
  the renderer; the e2e specs reach them via `MCPSTUDIO_LLM_PROVIDER=mock`
  + the canned library. A future flexible approach would let the e2e
  specs `register()` programs over an IPC at startup so different specs
  carry different program libraries without recompiling the renderer.
  M6+ if the canned-library approach hits its complexity ceiling.

## Test infrastructure

- **`react-hooks/exhaustive-deps` rule deferred** — the M5 codebase
  (especially ChatView's many `useCallback`s + the runner-event loop)
  doesn't run under the rule today. Enabling now = massive noise across
  M1–M4 code that was never written under it. When enabled, **must be a
  separate sweep commit chore**: `chore: enable react-hooks/exhaustive-deps
  + fix all existing violations`. Do not interleave with feature work.

- **e2e assertion principle: assert on operator-visible outcomes** — the
  C77 strict-mode hits ("queued for operator approval" lives inside the
  tool_result block, "MOCK PROVIDER" appears in two places, tool names
  appear transiently in two cards) crystallised a discipline rule the
  CONTRIBUTING.md should carry: **assert on the persisted operator-visible
  outcome** (queue state in the Changes view / audit entry in History /
  badge in the UI), never on intermediate envelope text that may be
  collapsed or re-rendered. Added to CONTRIBUTING.md alongside the
  Zustand-singleton lesson (M3 C55) and the React-Query
  `[dataUpdatedAt, value]` pattern (M4 C68a).

- **Recorded-LLM-playback canary** — M5 D9 ships programmatic mock
  programs; a recorded-playback layer (capture a real Anthropic
  round-trip's SSE stream → JSONL fixture → assert per-line event shape
  every CI run) is m5-followup. Useful as a canary for "did the API
  drift" against the M5 stream-mapper fixtures. The `scripts/capture-
  fixture.mjs` is in place; the harness around it is the add-on.

## UX polish

- **Conversation summary at head-trim.** M5 D3 sets a 200-message cap +
  head-trims with a `<system message: earlier messages trimmed>`
  placeholder — context loss after the trim. M6 polish lifts this to
  "LLM summarises the trimmed prefix into a single replacement system
  message", preserving the gist across long sessions. Uses the same
  LlmProvider — no new dep.

- **Richer starter chips with ord autocomplete.** M5 ships static-string
  chips ("Pick the rooftop unit (or any AHU) you find …"). M6+ could
  surface autocomplete over `useExplorerStore.known` (the M4 cross-view
  cache) so the chip morphs into "What's the current status of <ord
  picker>?" with a live dropdown. Surfaced from the existing
  `Plugin.starterQuestions` contract — the plugin returns templates with
  named slots, the host renders the picker UI per slot.

- **Per-watch threshold notifications** — M4 followup, carries forward.
  M5 didn't add it; the chat could surface "your AHU-2 SAT crossed the
  high threshold" as an assistant interjection but that needs the M5
  chat to be the receiver of niagara-plugin events (no plumbing yet).

- **AI-initiated history filter.** M5 records `actor: {type:'ai', …}` on
  every AI tool call but the History panel doesn't yet expose a "filter
  to AI-initiated only" toggle. One-spot add to `HistoryPanel.tsx`;
  surfaced as polish.

- **Cross-conversation cost dashboard.** M5's per-conversation
  UsageBadge + the workspace-level "spent this session" estimate are
  v1; an M6+ dashboard with per-day / per-conversation / per-flow
  breakdowns + an export-to-CSV is the natural next step. The persisted
  `Message.usage` field is already populated; the aggregation work is
  ahead.

- **Token-price refresh.** `ANTHROPIC_PRICES_AS_OF` is a per-quarter
  manual bump. Long-term: query the provider's metering / pricing API
  at app start; cache result; fall back to the hardcoded table. M7+
  multi-provider work is the natural home (each provider's pricing
  source is different).

## Conversation persistence

- **Conversation export to markdown** — operators may want to copy /
  share an investigation transcript. The persisted `Conversation` shape
  is JSON-friendly; the export is renderer-side serialise + save-as
  dialog. One-day commit.

- **Workspace-global cross-connection conversation archive.** M5 D3
  scopes conversations per `profileId`. The "show me every conversation
  I've ever had" view is workspace-global search across that data; M6+
  when real usage demands it.

- **Server-side conversation persistence** (`saveConversation` /
  `loadConversation` on niagaramcp's side, per handover §7). Carries over
  from M1 followups. Local-only persistence (M5) is enough until shared-
  across-MCP-Studio-instances is a real need; the API shape on the niagara
  side is the gate, not Studio.

## niagaramcp coordination (unchanged)

M5 added no new niagaramcp asks. The existing list in `docs/m1-followups.md`
remains the canonical reference. M6+ benefits when `getTrendAnalysis` /
`getFuzzyAssessment` / `getDiagnosticContext` land (handover §7) — the
diagnosticFlows prompts in `plugins/niagara/src/diagnostic-flows.ts` are
the integration point (one-line "prefer this tool if available" addition).
