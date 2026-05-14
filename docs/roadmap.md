# Post-M5 roadmap

This doc covers the **direction after M5** (`v0.5.0-m5` — AI co-pilot
foundation: chat + ReAct + plugin contributions + write-tool safety boundary).
Three named milestones plus a stretch row; M6 → M7 → M8 in order, linear,
each landing before the next opens.

For the bigger-picture vision (the AI co-pilot rationale, the three
concrete scenarios, the safety pattern, the integration points with the
existing M1–M4 work), see [`handover.md`](handover.md) Part 2. This doc is
the milestone-shape sketch — what each lands, what's deferred, and why
the order is the order.

The active milestone's commit-level plan lives in `milestone-{N}.md`
(written as Step 0 of that milestone's first commit, before any code).

---

## M6 — Diagnostic flows + RAG tier 1

**Theme.** Lift `Plugin.diagnosticFlows` from M5's templated user prompts
to a structured plan data model, with a plan-and-execute loop layered on
top of M5's ReAct. The M5 chat foundation is the runtime substrate;
M6 makes the canned flows first-class — *editable*, *previewable*,
*per-step approvable* — and enriches the LLM's starting context with
the connected server's knowledge layer.

**What lands.**

- **Plan-and-execute layered onto ReAct.** ReAct stays for ad-hoc
  questions (the most natural shape when the next tool depends on the
  last result). For canned `diagnosticFlows`, a plan is generated /
  loaded upfront and executed deterministically — the LLM fills in
  parameters, runs the steps, and synthesises results. M5's `runReAct`
  becomes one of two strategies the chat runner picks based on whether
  a flow is active.

- **Structured plan data model.** `DiagnosticFlow.prompt: string` (M5)
  expands to `DiagnosticFlow.plan?: PlanStep[]`. Each `PlanStep` carries
  a kind (`tool-call` / `condition` / `llm-step` / `aggregator`), a
  parameter map (substituted from upstream step outputs + the flow's
  initial `params`), an expected-output schema, and edges to dependent
  steps. The on-disk shape is JSON-serialisable so M8's visual builder
  edits it.

- **Plan editor UI inline in chat.** When the operator picks a flow,
  the chat view shows the planned tool sequence before execution —
  steps with their resolved arguments, the data they'll consume, the
  shape they'll produce. The operator can edit any step's args,
  delete steps, or pick **per-step approval** mode: every tool call
  pauses for a thumbs-up. (Default is plan-then-go; per-step is a
  toggle for the cautious operator + the high-stakes flow.)

- **Conversation summary at head-trim.** M5 D3 set a 200-message cap
  with head-trim; M6 replaces the trim placeholder with a real
  summarisation call ("here's what we've discussed so far") so a long
  diagnostic walk keeps context across the cap. The summariser is the
  same LlmProvider — no new dep.

- **Knowledge-layer enrichment in the system prompt.** The Niagara
  plugin's `systemPrompt` becomes feature-aware: at session start it
  calls `getKnowledgeSummary` (and possibly `findEquipment(query:'*')`
  for a compact inventory) and injects the summary into its system-
  prompt section. The LLM starts a conversation already knowing what
  equipment exists, without burning turns on discovery. Capped at ~1k
  tokens of injected context; truncated with "…and N more" if the
  knowledge model is large. Plugins opt in via the existing `ctx`
  argument to `systemPrompt(ctx)`.

- **`Plugin.canHandleWrite` actually iterated.** M5 hardcoded the
  niagara path; M6 wires the host-side iteration that asks each active
  plugin "do you handle this op?" before routing to a pending-store.
  Lands when there's a second write-capable plugin to actually exercise
  it (or trivially during M6 cleanup work).

**What's deferred.**

- True LTTB chart downsampling (m4-followup; M6 inherits whatever
  ships in the charts package).
- Per-conversation cost dashboard beyond the M5 in-header counter.
- Recorded-LLM-playback canary tests (M5 D9 deferred this; M6 could
  add it if real Anthropic API drift starts biting the per-line
  fixture assertions).

**Cross-product niagaramcp dependencies (forward-looking, none
blocking M6 v1).** `getTrendAnalysis(ord, from, to, type)` once it
ships unlocks the rooftop-flow's "trend analysis" step at the cost of
zero LLM tokens; `getFuzzyAssessment(equipmentId)` collapses N round-
trips into 1 for the fuzzy-read step; `getDiagnosticContext(equipmentId)`
collapses the rooftop flow's discovery quartet into a single primitive
call. Plan templates that prefer these tools when available + fall
back to the M4 surface land as a per-flow update once the tools ship.
Tracked in [`m1-followups.md`](m1-followups.md); the diagnosticFlows
prompts in `plugins/niagara/src/diagnostic-flows.ts` are the integration
point.

---

## M7 — RAG tier 2 + multi-provider + LLM-provider hardening

**Theme.** Two parallel surfaces, both bolt-ons over the M5 abstraction.
RAG tier 2 brings unstructured-document retrieval (manuals, runbooks,
incident reports); multi-provider lets the operator pick OpenAI / Ollama
alongside Anthropic.

**What lands.**

- **`packages/rag` — local vector store.** New workspace package.
  Embedding pipeline: PDF / Markdown / plaintext → chunked
  (≈500-token windows with overlap) → embedded → indexed into an
  in-process vector store. `sqlite-vec` is the front-runner (sqlite
  ubiquity + good ann-search perf + no external service); LanceDB
  + a thin Node wrapper is the alternative if sqlite-vec proves
  fragile on Windows. **In-process, no external service** — the M5
  philosophy "the desktop app is the whole runtime" continues.

- **Document upload pipeline.** A "Knowledge" rail item (or a section
  inside Settings — judgment call at M7 plan time). Operator drops
  files, the main process embeds + indexes. Per-workspace storage
  alongside `workspace.json`. Categories: station manuals, incident
  reports, operator runbooks, kit module references. The first three
  are the high-leverage ones — runbooks turn the AI into a
  "what would an experienced operator do here" rather than just
  "what does the docs say".

- **Retrieval into LLM context.** At chat-message time, the assembled
  system prompt gains a retrieval pass: top-N chunks semantically
  similar to the current user message are concatenated into a
  "Relevant context from your knowledge base" section. Token-capped;
  re-runs per turn so the context tracks the conversation. The
  retrieval is invisible to plugins — the host owns the pipeline.

- **Multi-provider adapters via the M5 `LlmProvider` interface.**
  `createOpenAiProvider({apiKey, model})` — OpenAI Chat Completions
  + tool use. `createOllamaProvider({baseUrl, model})` — local-hosted
  Ollama, no API key, useful for air-gapped stations and dev. Both
  drop into the same `LlmProvider` shape, same `LlmEvent` union; the
  ReAct loop + the chat view don't change. **The M5 abstraction is
  the payoff here** — adapters are isolated files, not a repaint.

- **Provider selection UI in Settings.** Per-provider API key entry
  (vault re-keyed by `llm:<provider>:apiKey`, same M5 infrastructure).
  Workspace-level default; per-conversation override.

- **Per-profile API key override.** M5 D4 deferred this (workspace-
  global only); M7 ships the per-profile path for the "MSP runs MCP
  Studio against multiple customers' stations with separate billing"
  case. UI lives in the connection-profile editor.

**What's deferred.**

- Embedding-model selection UI (auto-pick a small efficient model;
  user override is an M8+ knob if needed).
- RAG result citations inline in chat ("according to RTU-Manual.pdf
  page 17, …" with a clickable jump) — possible in M7 but more
  likely an M7-followup.
- Cross-workspace knowledge sharing (deferred — workspace boundaries
  are the right scope until a multi-workspace use case appears).

**Cross-product niagaramcp dependencies.** None new in M7. The
`saveConversation` / `loadConversation` server-side conversation
persistence from handover §7 would compose well (share an investigation
across MCP Studio instances) but stays optional — M5/M6/M7 ship local-
only and that's enough.

---

## M8 — Visual flow builder ("agent blocks")

**Theme.** Power-user feature: visually compose flows from nodes,
schedule them, run history with full audit. The Niagara-engineer
operator picks this up immediately because the wire metaphor matches
how they already work.

**What lands.**

- **`packages/flow-builder` — canvas-based node editor.** `react-flow`
  (a.k.a. `@xyflow/react`) is the front-runner — mature, well-typed,
  TypeScript-first. Renders a draggable canvas with typed input /
  output ports per node + connecting wires. Saved-flow JSON
  serialises the node graph; the M6 structured-plan model is the
  same shape inside-out (M6's PlanStep ≈ M8's flow node — the visual
  builder *edits* the M6 model).

- **Node palette.**
  - **Trigger** — manual (a "Run" button in the flow header) /
    scheduled (cron-like, e.g. `daily 08:00` for morning sweeps) /
    event (alarm-fires from `getActiveAlarms` polling / threshold-
    cross via M4 watch primitives / external webhook from an MCP
    server connector). Multiple triggers per flow allowed.
  - **Condition** — if/else branching on data from an upstream node
    (e.g. `if equipment.alarm.count > 0 → branch A else branch B`).
    Predicate expressed as a small expression language; the editor
    surfaces field-name autocomplete from the upstream node's typed
    output.
  - **Tool call** — invokes an MCP tool with parameterised args
    (`${upstream.field}` substitutions from upstream node outputs).
    Produces a typed structured output downstream consumers can wire
    into.
  - **LLM step** — templated prompt with `{{variable}}` substitution
    from upstream node outputs, optional system-prompt override
    (M5 D7's plugin-contributed prompt is the default), model
    choice (per-node provider — cheap small model for "classify
    this alarm severity", big model for the synthesis step). The
    power feature when M7's multi-provider lands.
  - **Aggregator** — collect / summarise / reduce multiple upstream
    outputs ("summarise all 12 equipment readings into one
    operator-readable report"). Internally backed by an LLM step
    + a deterministic mode for cheap fan-ins (count / mean / max).
  - **Output** — terminal node. Renderers: chart (reuses
    `@mcp-studio/charts` from M4 — `TimeSeriesChart` / `BarChart` /
    `Sparkline` drop right in) / table / notification (Telegram,
    email, Slack, all via MCP server connectors — Slack & Telegram
    & email MCP servers already exist publicly) / submit to the M3
    pending-changes queue (the operator-approval gate).

- **Wire metaphor inspired by Niagara's wire-sheet.** Operators
  trained on Niagara transfer the metaphor immediately — left side
  is sources (triggers / data fetchers), right side is sinks
  (renderers / notifications / pending queue), wires carry typed
  data. Naming conventions (`Inputs` / `Outputs` ports, not
  `From` / `To`) align with N4 Workbench.

- **Saved flows in `workspace.json`.** Similar pattern to M4
  watches: per-workspace storage, with a `WORKSPACE_VERSION` bump
  (5 → 6) + idempotent migrator adding an empty `flows: {}` map.
  Each saved flow gets a stable id + the JSON-serialised node graph.

- **Scheduled execution daemon in main process.** Watches saved
  flows with a `Trigger:scheduled` node; runs the flow at the
  cron-resolved time. Backed by a small scheduler (the project
  picks one at M8 plan time — `node-cron`, or a hand-rolled
  setTimeout loop). Survives app restart by replaying the schedule
  at boot from the persisted definitions.

- **Run history composes M3 audit + M4 tool-history.** Each flow
  run gets a `runId`; every tool call the flow makes is attributed
  `flow:<id> (run #N)` in the audit trail. The Performance view
  (M4) gains a "by flow" scope so the operator sees which flow is
  burning the latency budget.

- **Safety boundary unchanged from M5 C75.** Write tools invoked
  from flow steps route through the pending-queue same as chat-
  initiated writes (the same `caller` attribution shape, with
  `caller: {type:'flow', flowId, runId, ...}` — a new branch in
  the `ToolCaller` union). Operators approve bulk actions from
  scheduled flows before apply; the Changes view badges them with
  a flow-name chip (the M5 "AI" chip pattern generalises).

**What's deferred.**

- Sharing flows across workspaces (export / import to a `.flow.json`
  is M8; a public marketplace of flows is M8+ stretch).
- Real-time flow debugging (pause / step / inspect — an
  M8-followup once basic execution is stable).
- Conditional retries / error-handling branches beyond simple
  if/else.

**Cross-product niagaramcp dependencies.** None blocking. The
`getActiveAlarms` polling-based trigger benefits from any future
push / subscription model on niagaramcp's side (already a separate
followup); M8 ships polling-based first.

---

## Later — multi-agent orchestration

Stretch milestone, post-M8. Specialist agents (knowledge agent /
math agent / summariser), main agent dispatches sub-queries, shared
scratchpad for cross-agent state. The architecture is interesting
but the demand isn't there yet — single-agent ReAct + plan-and-
execute + RAG covers the diagnostic + reporting use cases that drive
the project. Lands when an operator has a real "this single agent
keeps making the same kind of mistake / running out of context on
the same kind of question" pain point that's solvable by partitioning.

---

## Ordering rationale

The order is **linear** — no parallel-milestone starts. Concretely:

1. **M5 chat foundation is the runtime substrate.** Without working
   chat + ReAct + the safety boundary at `ConnectionManager.callTool`,
   no flows have anywhere to execute, no RAG has a chat context to
   inject into, no multi-provider has a `LlmProvider` interface to
   slot into.

2. **M6's structured plan data model is what M8 visualises.**
   Designing the flow-builder node types + the wire metaphor before
   the plan data model exists is guesswork — we'd ship something the
   M6 model can't actually represent + then refactor. M6 → M8 keeps
   the editor and the executable in lockstep.

3. **M7's multi-provider abstraction unlocks per-node provider choice
   in M8.** Cheap small models for routine classifier steps, big
   models for synthesis nodes is one of the more compelling
   flow-builder superpowers — and it presupposes multi-provider
   plumbing being there. M7 → M8 lands the plumbing before the UI
   makes it visible.

4. **Linear delivery keeps focus, prevents polish debt from
   compounding across multiple in-flight milestones.** The
   "Adjustments during the build" + per-milestone followups
   sections in `milestone-{N}.md` would muddle into a
   cross-milestone soup if two were in flight; the
   recon → build → close-out ritual works because the next one
   doesn't start until the current is tagged.

The full handover.md §"Phased delivery sketch" listed M6/M7/M8 in
this same order; this doc is the elaboration that gives each
milestone its named scope before its recon doc opens.

---

## Cross-product niagaramcp dependencies (canonical reference)

The forward-looking tool wishes (`getTrendAnalysis` / `getFuzzyAssessment`
/ `getDiagnosticContext` / optional `saveConversation` /
`loadConversation`) live in [`handover.md`](handover.md) §7 and are
tracked operationally in [`m1-followups.md`](m1-followups.md). M6+
benefits when they land — diagnostic flow prompts adapt; the host's
RAG retrieval and the flow-builder's "diagnostic-context source"
node compose better.

**No MCP Studio blockers at any milestone.** Every roadmap milestone
ships against the niagaramcp tool surface as it is today; the wished-
for tools accelerate scenarios, never gate them.
