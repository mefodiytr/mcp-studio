# M6 follow-ups

Things deferred during Milestone 6 (Diagnostic flows + RAG tier 1), with a
pointer to where each fits. Nothing here blocks the M6 deliverable; this is
the "we know about it" list. See `docs/m{1,2,3,4,5}-followups.md` for the
earlier ones, and the **niagaramcp-side coordination** list in
`m1-followups.md` (which still applies; M6 introduced one new server-side
coordination item — `knowledgeHash` for cache invalidation — appended there).

## Architecture seams

- **`Plugin.summarisationHints?` per-plugin guidance for the summariser**
  (promt19 edge case #3 future seam). M6 ships a single global
  `SUMMARISER_SYSTEM_PROMPT` that asks the model to preserve "key facts /
  tool results / conclusions / pending questions". The natural extension is
  a per-plugin hint string the niagara plugin (and future plugins) can
  contribute — e.g. niagara: "preserve equipment ORDs referenced, alarm
  states, BQL queries used". Shape: `Plugin.summarisationHints?: (ctx) =>
  string | Promise<string>`; the host concatenates active plugin hints
  into the summariser prompt as an extra paragraph. Lands when the first
  in-the-wild summary loses plugin-specific context the operator notices.

- **`HostBusSelection` is single-source-of-truth, no per-plugin
  namespace yet.** C87 lifts the Niagara Explorer's selection onto the
  host bus as one `selectedOrd: {ord, displayName?}` field. Multi-plugin
  scenarios (M7+ with a 2nd plugin contributing its own "selection"
  semantics) want a namespaced channel: `selectionByPlugin:
  Record<pluginName, HostBusSelection>` + consumers pick which one to
  read based on the active plugin connection. Lands when the second
  selection-aware plugin appears; not blocking M7.

- **`useExplorerStore.known` eviction policy** (formalised in
  `CONTRIBUTING.md` "Cross-view explorer state"). Cache is unbounded today
  — fine for the thousands-of-components case M2 + M4 + M6 ship against.
  An LRU cap + explicit `forget(ord)` API is m1-followup work if a station
  shows up that matters (>50k components ≈ tens of MB). Joins the
  carry-over list.

## Diagnostic flow editor — m6-followups from D3 v1 scope

- **Per-step edit form** — the M6 PlanEditor is preview-only. Operators
  who want to tweak step args / prompts / `runIf` before run today
  cancel + relaunch with different params. The full edit form (inline
  reveal per step row, save-back to the in-flight plan) lands in M8's
  visual flow builder, which natively edits the same `DiagnosticFlow.plan`
  shape — sharing the editor surface avoids two competing implementations.

- **Per-step Run / Skip toggle** — pre-run disabling of individual steps.
  Same M8 home; the visual builder's per-node enable/disable affordance
  produces the same `plan: PlanStep[]` with `runIf: never` on disabled
  steps.

- **Mid-run plan pause + edit** — Stop button cancels the whole flow
  today (the M5 abort plumbing extends straight into runPlan). Pause +
  patch-the-rest is a richer UX deferred until operator workflow shows
  the need; the plan runner's generator shape supports it cleanly when it
  lands (yield a `pause-requested` event; consumer awaits a continue / new
  plan).

- **`and` / `or` / `any` / `all` combinators in `ConditionExpr`** —
  deferred from D1 v1 scope. The six leaf kinds (`always` / `never` /
  `var-truthy` / `var-defined` / `var-compare` / `var-length-gt`) cover
  every M6 in-box flow. Combinators land when the first real flow needs
  multi-condition logic (likely: M8 visual builder's UI surface for
  combined conditions).

- **Soft-cap-on-token-budget head-trim trigger** — the M6 head-trim stays
  on the M5 hard 200-msg cap (with summarisation on cross). The soft-cap
  variant (compute context-window pressure via a model-specific token
  budget, trigger summarisation when 80% full) is a refinement that lands
  when real-world conversation costs grow past what the message-count
  trigger captures. The C86 trigger logic generalises — swap
  `messages.length` for a token-budget reading.

- **Rolling summary** (update each N turns instead of summarise-on-trim).
  M6's drop-block approach is simpler + matches what the operator can
  observe in the conversation log. Rolling summary is a "lossless"
  alternative that pays summariser cost every N turns regardless of need.
  Lands if drop-block summaries demonstrably lose context the operator
  needs.

## Plan execution shape — deferred to later milestones

- **Multi-agent plan execution** — single-agent + single-step-at-a-time
  in M6. Specialist agents per node (knowledge agent / math agent /
  summariser agent) arrive in the "Later" row of the roadmap (post-M8
  visual builder + agent-blocks story).

- **User-saved flows** — operator-authored flows persisted in
  `workspace.json` (not just plugin-contributed). The shape
  (`WorkspaceData.savedFlows`) lands when M8's visual editor produces
  them; M6 only consumes plugin-contributed flows.

- **Renderer-side knowledge-browser UI** — a dedicated view to browse
  niagaramcp's knowledge layer (spaces tree → equipment list → equipment
  detail) outside the chat. Optional polish in M7+ if operator workflow
  shows the need; M6's chat surface covers the M6 scope.

## Coordination items (n→niagaramcp)

These cross M6 → niagaramcp; they're documented here AND appended to
`m1-followups.md` so the niagaramcp side picks them up.

- **`knowledgeHash` or `knowledgeVersion` on `getKnowledgeSummary`
  response** — the C85b system-prompt cache invalidates on a 30-minute
  TTL today. A version field on the niagaramcp response would let the
  cache invalidate on real knowledge-model edits (operator-driven import,
  point/equipment renames) instead of waiting for TTL expiry. Shape:
  `getKnowledgeSummary → { ...summary, knowledgeHash: 'sha256:...' }`;
  the M6 cache stores the hash alongside the cached prompt + invalidates
  on mismatch.

- **`saveConversation` / `loadConversation`** — server-side conversation
  persistence per `docs/handover.md` §7. Local-only persistence (M5) is
  enough until shared-across-MCP-Studio-instances is a real need; M7+
  when the niagaramcp side ships.

- **`getDiagnosticContext(equipmentId)`** — collapses the rooftop flow's
  discovery quartet (`findEquipment` → `inspectComponent` →
  `getActiveAlarms` → equipment points) into one server-side call.
  Integration: the rooftop-flow's plan gains a feature-detect at
  flow-launch time — if `tools/list` advertises `getDiagnosticContext`,
  short-circuit four steps into one. Same pattern as M3's Bearer-bootstrap
  feature-detect. Lands when niagaramcp ships the tool.

- **`getTrendAnalysis(ord, from, to, type)`** + **`getFuzzyAssessment` /
  `getKitFuzzyOutputs`** — server-side stat / bulk-read tools that
  flatten plan steps into single tool-calls. M6 plans are written so the
  forward-looking tools slot in as feature-detect short-circuits without
  changing the plan's terminal `llm-step`.

## Resolved by M6

These were open in `m5-followups.md` (or earlier); M6 closed them:

- **Conversation summary at head-trim** (m5-followup) → **closed** by C86
  summarise-then-drop on the 200-msg cap. Configurable via
  `WorkspaceLlmSettings.summariserModel` (default `'haiku'`); summary
  rendered as a collapsible marker; cost-credited into UsageBadge totals.

- **Async system-prompt enrichment with knowledge layer** (M6 D4) →
  **closed** by C84 (Plugin.systemPrompt → Promise<string|null> + 10s
  timeout + warning chip) + C85a (niagara getKnowledgeSummary section) +
  C85b (per-(plugin, profileId, connectionId) TTL cache with
  background-refresh).

- **Selection-aware diagnostic-flow launchers** (M6 C87) → **closed**.
  `useHostBus.selectedOrd` state channel; ChatView empty-state +
  command palette decorate flow buttons with the operator's current
  Explorer selection + pre-fill the launcher's first text param.

- **Cross-view `useExplorerStore.known` contract** (carry-over from
  m4-followups, 5th-consumer threshold met) → **closed**. Formalised in
  `CONTRIBUTING.md` "Cross-view explorer state": semantics, registration
  pattern (`remember(nodes)`), consumer roster (QuickNav M2 +
  HistoryView M4 + MonitorView M4 + selection-aware flows M6 + future
  RAG/visual-builder).

## Kept open (not M6's job)

- **API key reaches renderer via `llm:getKey` IPC** (carry-over from
  m5-followups). M6 didn't move the provider into main; the M7+ multi-
  provider work is where the CJS bundling pass happens.

- **Per-profile LLM API key override** (carry-over from m5-followups).
  M6 didn't add the MSP / multi-customer billing case. M7+ alongside
  multi-provider.

- **`Plugin.canHandleWrite` actually iterated** (carry-over from
  m5-followups). M5 hard-coded niagara; M6 didn't change. Closes when a
  second write-capable plugin appears.

- **Richer starter chips with ord autocomplete** (carry-over from
  m5-followups). M6 C87 adds selection-aware decoration to the
  diagnostic-flow buttons but not to starter questions. The autocomplete
  substrate (`useExplorerStore.known` via the host bus) is now in place;
  wiring is a small polish item when operator workflow asks for it.
