# Milestone 6 — Diagnostic flows + RAG tier 1

> Lift `Plugin.diagnosticFlows` from M5's templated user prompts to a
> structured plan data model with a **plan-and-execute** runner layered on top
> of M5's ReAct. The Niagara plugin's rooftop diagnostic moves from "a prompt
> that hopes the LLM walks the right sequence" to "a typed plan the operator
> previews + edits before the runner executes it deterministically". Enrich
> the LLM's starting context with the connected server's knowledge layer
> (Niagara queries `getKnowledgeSummary` once per conversation so the LLM
> doesn't burn discovery turns). Lift the M5 D3 head-trim from drop-the-oldest
> to summarise-the-prefix-then-drop. Context-aware quick actions for diagnostic
> flows when an equipment node is selected in the Niagara Explorer.

**Target:** `v0.6.0-m6` · ~3–4 weeks · commits C81 → C89, four phases, check-ins at phase boundaries (after A, after C, big one after D). The plan + acceptance criteria + the decisions below are this doc; it's committed as the "Step 0" of M6 (`docs: M6 recon — diagnostic flows + RAG tier 1 plan`).

The same workflow as M1/M1.5/M2/M3/M4/M5: written plan first → atomic commits, each passing `pnpm lint` + `pnpm -r --if-present typecheck` + `pnpm -r --if-present test` + `pnpm --filter @mcp-studio/desktop build` + `pnpm test:e2e`, all green; constructive deviation = labelled + rationale, never silent; the §13 coverage ratchet (run coverage before committing if a commit touches a covered package; add a test in the same commit if near the floor; no fix-forward); no progress check-ins within a phase except (a) ad-hoc on an architectural contradiction, (b) phase boundaries. The C-numbering is a guideline — splits / re-orderings are pragmatic atomicity, not deviations.

Vision references: [`handover.md`](handover.md) Part 2 §A — the canonical rooftop-diagnosis scenario M6 makes deterministic; [`roadmap.md`](roadmap.md) — the M6 entry written during M5 (commit `48f51df`); [`m5-followups.md`](m5-followups.md) — the M5 deferrals M6 picks up (conversation summary at head-trim; knowledge-layer enrichment in system prompt).

---

## What earlier milestones already give M6

- **`@mcp-studio/llm-provider`** (M5 C70) — `LlmProvider` interface, `LlmEvent` union, `runReAct` bounded loop, `FakeLlmProvider` + `MockLlmProvider`, the four canned mock programs the e2e use. The package is the substrate; M6's plan-and-execute runner sits alongside `runReAct` (a second function exporting the same `LlmEvent` shape, callable from the same chat-runner control flow).
- **The chat foundation + `useConversationsStore`** (M5 C71) — per-connection multi-conversation persistence, the Zustand renderer-side mirror with `appendMessage` + `patchInflight` + the stable `EMPTY` reference. M6 plan execution appends synthetic `assistant` + `user` messages exactly like the ReAct loop; no schema change on the message side.
- **`Plugin.systemPrompt` / `starterQuestions` / `diagnosticFlows` / `canHandleWrite`** (M5 C73) — the plugin contract surface. M6 extends `DiagnosticFlow` with an optional `plan?: PlanStep[]` (the M5 `prompt` field stays as the back-compat fallback); the `systemPrompt` hook becomes `Promise<string | null>` (additive — sync returns still satisfy the new signature).
- **`assemblePluginContributions(plugins, ctx)`** (M5 C73) — single resolution point for plugin contributions. M6 makes this `Promise`-returning to accommodate the async system prompt; otherwise no shape change.
- **The M5 C75 caller-attributed safety boundary at `ConnectionManager.callTool`.** The plan-and-execute runner is just a different orchestrator dispatching the same `caller: {type:'ai', conversationId}` tool calls — every plan step that writes routes through the M3 pending-changes queue automatically.
- **The Niagara plugin's `niagara-api.ts` wrappers + the `useExplorerStore.known` cross-view cache** (M2 + M4). Plan steps reuse these wrappers; the cache supplies cached `displayName`s + the "equipment selected in Explorer" context the C87 quick-actions wire feeds from.
- **The `@mcp-studio/charts` primitives + the M5 `chart` code-fence pipeline** (M4 + M5 C76). Plan steps that produce time-series data emit chart code fences in their `llm-step` results; the chat renderer renders them inline — no new chart wiring.
- **`useHostBus` in `@mcp-studio/plugin-api`** (M5 C79) — the cross-plugin pub/sub seam introduced for the `<ord>` chip → Explorer navigation. M6 reuses it for the C87 "selection-aware diagnostic flow launcher" — the niagara Explorer publishes the selected ord (already does, via `useExplorerStore.selected`); the AppShell consumes it to pre-fill flow launcher params.
- **The `MockLlmProvider`'s `__delay` sentinel + canned programs** (M5 C77). M6 adds a fifth canned program ("rooftop-plan" — the structured rooftop-diagnostic walk) that the C88 e2e exercises.
- **`Message.usage` + `sumUsage`** (M5 C78) — already capture per-message token totals. M6's summary-at-head-trim feeds the same field; the UsageBadge totals + the soft-cap warning continue to work after summary replaces the prefix.

---

## Recon — decisions, with recommendations

### D1 — Plan format: **linear sequence with `runIf?` conditional skips per step**

Three credible shapes for the structured plan:

- (a) **Pure linear** — ordered `PlanStep[]`; branching exists only inside `llm-step` prompts ("if the result of the previous step has alarms, mention them; otherwise say everything's fine"). Simple data model, no editor complexity.
- (b) **DAG with explicit branch nodes** — `if` / `else` nodes split execution; `join` nodes merge. M8's visual canvas eventually edits this shape natively. Powerful, but complex to data-model AND to edit inline (M6's editor lives in the chat thread, not a canvas).
- (c) **Linear with per-step `runIf?` conditional skips** — each `PlanStep` carries an optional `runIf` predicate evaluated against bound variables from upstream steps. Skipped steps render greyed-out in the editor + log "(skipped: condition <expr>)" in the execution. No fork/join — branching is "this step runs or doesn't".

**Recommendation: (c).** The 80 %-case in `handover.md` §A is conditional skip ("if `equipment.alarms.length > 0`, run a trend-analysis step; otherwise jump straight to the summary"), not divergent branching. Linear-with-skip is a clean data model the inline editor handles trivially (each step's row gets a runIf field) AND maps cleanly to the M8 visual builder later — each linear step becomes a node in the canvas, sequential edges + `runIf` predicates render as edges-with-condition. True branching (a step that emits one output type OR another type, where downstream depends on which) lifts to a fork/join data model in M8; M6 doesn't try to ship that.

**Step kinds for v1** (the recon's data-model scaffold — exact shape pinned at C82 time, but the kinds + the fields here are the contract):

- `tool-call` — `{ kind: 'tool-call', id, tool: string, args: Record<string, ParamTemplate>, bindResultTo?: string, runIf?: ConditionExpr }`. `args` values are either literals or `${var.path}` templates substituted from upstream-bound variables (and the flow's collected `params`). Calls `connections:call` with `caller: {type:'ai', conversationId, agentId: 'plan-runner'}` — the M5 safety boundary intercepts writes automatically.
- `llm-step` — `{ kind: 'llm-step', id, prompt: string, bindResultTo?: string, runIf?: ConditionExpr, model?: string }`. Templated prompt substituted from bound vars; the LLM result is bound + becomes part of the conversation log. The terminal step (no `bindResultTo`) renders as the final assistant message — its prompt is the "summarise findings with citations" instruction.

Out of scope for M6: `aggregator` / `condition` / `output` step kinds. Two kinds cover the rooftop walk + the knowledge-summary walk (the two Niagara M5 flows lifted to plans). M8 adds more kinds against the same envelope; the contract is forward-compatible.

`ConditionExpr` v1 — a tiny tagged-union DSL (not arbitrary JS); see D5 in the plan editor below.

### D2 — Plan storage: **the plan IS the diagnosticFlow** (template); the conversation logs the resolved instance

Three storage shapes:

- (a) **In-memory per conversation only** — the plan is generated each run + dies with the chat session. Doesn't compose with M8 (no template to visually edit).
- (b) **Persisted per-conversation** — each conversation stores its own plan snapshot. Storage bloat; no template reuse.
- (c) **The plan IS the `DiagnosticFlow`** — M5 already persists `DiagnosticFlow` shapes in plugin manifests (Niagara contributes them statically; `NIAGARA_DIAGNOSTIC_FLOWS` is the source). M6 extends the type with `plan?: PlanStep[]`. The conversation records the **execution** (params collected from the launcher dialog + each step's bound result) via the same `Message.content` blocks the M5 ReAct loop emits — `tool_use` blocks for tool-call steps, `text` blocks for llm-step results. No new conversation schema fields; no per-conversation plan snapshot.

**Recommendation: (c).** Aligns with M8: the visual builder edits the `DiagnosticFlow.plan` template; user-saved flows (operator-created flows that aren't plugin-contributed) live in `workspace.json` as the same `DiagnosticFlow` shape under a new `WorkspaceData.savedFlows` field. M6 doesn't ship the saved-flows surface yet — that's M8 territory — but the storage shape is ready for it.

**Execution-log shape**: each plan step's invocation appears in `conversation.messages` exactly as a ReAct loop step would. A `tool-call` step lands as a `tool_use` block (with the resolved args) in an assistant message + a `tool_result` block (with the response) in the next user message. An `llm-step` lands as a `text` block in an assistant message. Two synthetic fields on `Message` to mark the plan: `planFlowId?: string` + `planStepId?: string` — purely for the chat view's "this message was part of plan X step Y" rendering hint; the runner doesn't read them. Schema is additive + optional; no migration.

### D3 — Plan editor UI shape: **inline collapsible card in the chat thread**, pre-execution edit only

Three placements:

- (a) **Inline collapsible card** in the chat thread, between the user message that launched the flow + the first plan-execution turn. Matches the M5 ToolCallEnvelope precedent for collapsible-inline-detail; doesn't fragment attention; keeps chat-thread continuity.
- (b) **Side panel** opening to the right. Layout complexity competes with the chat-message width; the rail is already on the left.
- (c) **Modal overlay** blocking chat until dismissed. Too heavyweight for what's essentially a parameter-collection + step-preview gesture.

**Recommendation: (a) inline collapsible card.** The card renders:

- Plan title + the flow's `description`.
- Collected params (from the launcher dialog, already familiar from M5).
- Step list: each step's `kind` / a one-line description / `runIf` (if any) / `args` (resolved with `${var.path}` references rendered, unresolved variables shown as chips). Each step's row has a "✓ Run" toggle (default on) + an edit pencil that flips the row into edit mode. Skipped steps render greyed-out.
- "Run plan" button at the bottom + a "Cancel" button. After Run: the card collapses to a one-line summary ("Plan run: 4 of 5 steps OK, 1 skipped"); the operator can expand to see each step's result inline.

**Edit semantics — pre-execution only.** Once "Run plan" is clicked the plan is frozen for that run. Mid-run pause + edit is **not M6**; it's an M6-followup. The operator's mid-run lever is Stop (the M5 AbortController path) which cancels the plan + leaves the conversation in a "[stopped by user]" marker state. Cancel-and-redo by editing the plan + re-launching is one click + one launch; matches M5's Regenerate pattern (C79).

### D4 — Knowledge-layer enrichment: **lazy on first turn + per-profileId TTL cache in main**

Three triggers for the `getKnowledgeSummary` enrichment call:

- (a) **Eager at session start** — call `getKnowledgeSummary` the moment the operator opens a Niagara conversation; inject the summary into the system prompt for every turn. Burns the call on conversations that never ask a single substantive question.
- (b) **Lazy on first turn** — defer the call to the chat-runner's first `streamResponse` invocation. The summary is baked into the system prompt for that conversation from turn 1 onward. The cost lands when the operator sends their first message; abandoned conversations skip the call entirely.
- (c) **Lazy on demand via the LLM** — leave it to the LLM to call `getKnowledgeSummary` itself when needed. This is what M5 already supports (the LLM has the tool in its catalog); the value of (b) over (c) is that the LLM doesn't burn a discovery turn on the obvious "what's here?" first move.

**Recommendation: (b) lazy on first turn + cached in main.** Cost-aware (the call is amortised across the rest of the conversation; abandoned chats pay nothing); the LLM starts turn 1 already knowing what equipment exists.

**Implementation** (per promt17 D4 extension):
- `Plugin.systemPrompt(ctx)` becomes `Promise<string | null>` (additive — sync `string | null` returns continue to satisfy the new signature via implicit `Promise.resolve`).
- `assemblePluginContributions` becomes `async`. The chat-runner awaits the assembled prompt right before the first `streamResponse`.
- **10-second defensive timeout** on each plugin's `systemPrompt(ctx)` (not 5 s — real niagaramcp stations with large knowledge models take 2–4 s for `getKnowledgeSummary` and the 5 s default would fire too often). On timeout: silent fall-back to the prompt-without-inventory path + a **warning chip in the chat header** ("Knowledge inventory unavailable") so the operator knows the LLM is operating without the enrichment.
- **Per-`profileId` TTL cache in the main process** (30 min default; configurable via a constant for the dev-iteration case). Cache key: `(profileId, connectionId)` — a reconnect to the same profile re-uses the cached inventory if still warm; a different connection (e.g. failover to a different station) populates a fresh entry.
- **First-session behaviour**: cache miss → block the chat's first turn up to the 10 s timeout while `getKnowledgeSummary` runs; on success, populate the cache + inject the inventory; on timeout, fall back as above.
- **Subsequent-session behaviour**: cache hit → use the cached inventory immediately (no blocking) + **fire-and-forget background refresh** (call `getKnowledgeSummary` asynchronously; replace the cached entry on success; the active conversation's prompt isn't reassembled — the operator gets the refreshed version on the next conversation in that profile).
- **Cache invalidation in v1**: TTL only. A `knowledgeHash` / `knowledgeVersion` field on `getKnowledgeSummary`'s response would let main invalidate precisely on knowledge-model edits without an arbitrary TTL — tracked in `m1-followups.md` as a niagaramcp coordination item.

The Niagara plugin's `systemPrompt(ctx)`:
1. Calls `ctx.callTool('getKnowledgeSummary', {})` (which routes through main; main's cache layer transparent).
2. Formats the result (spaces / equipment_types / equipment counts; a compact list of equipment names + their types).
3. Returns the M5 system prompt + an injected `## Connected station inventory` section at the end. Cap at ~1k tokens of injected context; truncate with `… and N more` if the model is large.
4. On call failure (no knowledge layer / network error): returns the M5 prompt unchanged; logs a one-line warning to the console + the chat header warning chip fires (the host detects the absence of an inventory section + surfaces the chip).

**Implementation split (possible)**: C85 may split into C85a (niagara contributions lifted; uses lazy-on-first-turn without cache yet, blocking each first-session call) + C85b (the main-side TTL cache + background-refresh layer). Judgement call at C85-time — if the cache work grows past ~150 LoC + warrants its own tests, splits naturally; otherwise lands as one commit.

### D5 — Conversation summary at head-trim: **hard cap (200 msgs, M5 D3), summarise-then-drop, configurable `summariserModel` (default `'haiku'`)**

Promt16 directs the shape: "Current 200-msg cap drops oldest (M5 D3) — lift to LLM-summarizes-trimmed-prefix-into-single-system-message before dropping". The trigger stays at the M5 hard cap (the soft-cap-on-token-budget alternative is m6-followup if real-world conversations want it); the granularity is drop-block (the rolling-summary alternative would fire summary calls every N turns regardless of need).

**Summariser model configuration** (per promt17 D5 extension):
- New workspace setting `llm.summariserModel: 'haiku' | 'sonnet' | 'opus' | 'same-as-main'` (default `'haiku'` — 20× cheaper than Opus; summary turns shouldn't burn Opus prices). Tracked in `workspace.json` alongside the existing `llm.provider` field; defaults stay sensible without UI exposure in M6.
- The escalation path: if real-world summaries lose key context (operators report "the next turn forgot something important"), the m6-followup is to bump the default to `'sonnet'` (3× cheaper than Opus; substantially better fluency than Haiku). UI exposure (a settings dropdown) lands in M7 alongside the multi-provider work.
- The `'same-as-main'` choice uses whatever model the active conversation is running — useful for parity-debugging the summariser's quality without affecting other conversations.

**Implementation**:

1. `ConversationRepository.append` (main) sees the message count cross the cap (`MAX_MESSAGES_PER_CONVERSATION = 200`, from M5 `shared/domain/conversations.ts`). Instead of slicing off the head silently, it emits a `summary-required` event back to the renderer.
2. The renderer's chat-runner subscribes; on the event, fires a one-shot LLM call:
   - **Model**: from `workspace.json`'s `llm.summariserModel` setting (default `'haiku'` → `claude-haiku-4-5`).
   - **Prompt**: "Summarise the conversation below in ≤200 tokens. Preserve operator concerns, equipment names, tool calls made, and conclusions. Omit fluff."
   - **Input**: the first N messages getting dropped (head slice).
3. The summary text replaces the head as a single synthetic `assistant`-role message: `{role:'assistant', content:[{type:'text', text:'<summary>'}], marker:'summary', ...}` — uses the existing `marker` field on `Message` (extended with a `'summary'` variant; M5's `'aborted'`/`'max-turns-reached'`/`'error'` markers continue to work).
4. The replaced messages are **deleted** from the persistent log. (Audit-trail concerns are covered by the existing tool-history-repository, which stores tool calls + their results independently of conversations; we don't need to keep the raw chat history for replay.)

**Rendering**: the `'summary'` marker renders as a **collapsible** summary message — collapsed by default with the "— earlier messages summarised —" centered greyed-out marker line; expandable to reveal the summary text (the M5 ToolCallEnvelope pattern lifts cleanly). Operators can click to expand for context recall without the summary dominating the conversation log.

**Cost transparency**: the summary call's usage lands in the UsageBadge totals + accumulates into the conversation's `messages[i].usage` field (the same path M5 C78 already uses). The operator sees the summary call's cost the same way every other turn registers.

**Edge cases** (m6-followup if they bite):
- The summariser's call itself fails → fall back to the M5 silent-drop behavior + log a warning.
- The summary exceeds 200 tokens → re-prompt with "shorter" once; if still over, truncate.
- The operator deletes a synthetic summary message → the next summary recomputes from whatever's left.

### D6 — RAG tier 1 surface: **knowledge-layer enrichment in system prompt + structured-plan tool-call orchestration**

The handover.md Tier 1 definition: "structured knowledge already in the server. niagaramcp's knowledge layer (`findEquipment` / `findInSpace` / `findPoints` / `validateKnowledge` / `getKnowledgeSummary` / `exportKnowledge`) is itself a queryable knowledge base. AI uses it via tool calls, no embedding store required."

Two surfaces this milestone owns:

- **System prompt enrichment** (D4) — the LLM starts turn 1 with the equipment / space inventory baked in. Zero new tool-call cost per turn after the one upfront `getKnowledgeSummary`.
- **Structured-plan tool-call orchestration** — plan steps that call knowledge-layer tools are first-class `tool-call` steps with typed args + bound results. The rooftop diagnostic flow's "find the unit" step IS `findEquipment` — that's "RAG tier 1" by another name. M6's contribution: making these queries deterministic and editable (vs M5's "LLM might call findEquipment, might not, depending on its mood").

What's deferred to Tier 2 (M7): unstructured-document retrieval (PDFs / Markdown / plaintext via a local vector store), per-workspace document upload, retrieval into LLM context per turn. The `packages/rag` workspace package + the sqlite-vec front-runner + the upload pipeline land in M7's recon. M6 ships **no** new tool-call orchestration for documents; the existing niagaramcp knowledge-layer tools cover the M6 scope completely.

**Renderer-side knowledge-browser UI** — a dedicated view that lets the operator browse the knowledge layer (spaces tree → equipment list → equipment detail) outside the chat. NOT M6 scope; the chat is the UX surface in M6. Optional polish in M7+ if the operator workflow shows the need.

---

## Cross-product niagaramcp dependencies (forward-looking, none blocking M6)

The handover §7 forward-looking tools land naturally into M6's structured plans when they ship. M6 v1 ships against the M5-era niagaramcp surface; the integration points are documented so future-us has the landing zone.

- **`getDiagnosticContext(equipmentId)`** — collapses the rooftop flow's discovery quartet (`findEquipment` → `inspectComponent` → `getActiveAlarms` → equipment points) into one server-side call. Integration: the rooftop-flow's plan gains a feature-detect — at flow-launch time, if `tools/list` advertises `getDiagnosticContext`, the runner short-circuits the four-step discovery into one `tool-call` step + a single bound result; otherwise it runs the four-step walk. Same pattern as M3's Bearer-bootstrap feature-detect (`pickBootstrapMode(toolNames)`).
- **`getTrendAnalysis(ord, from, to, type)`** — server-side statistical analysis on history time-series. When available, the rooftop flow's "trend analysis" step (currently an `llm-step` with `readHistory` results) becomes a deterministic `tool-call` step. Saves opus tokens on the analysis.
- **`getFuzzyAssessment(equipmentId)` / `getKitFuzzyOutputs(ord)`** — bulk fuzzy reads. Plan step: a single `tool-call` step replacing N round-trips on the kitFuzzy-typed points.
- **Optional `saveConversation` / `loadConversation`** — server-side conversation persistence per handover §7. Local-only persistence (M5) is enough until shared-across-MCP-Studio-instances is a real need; M7+ when the niagaramcp side ships.

**No new niagaramcp asks in M6.** The existing list in `docs/m1-followups.md` remains canonical. The flows are written to prefer the forward-looking tools (when they appear) but fall back to the M5-era surface gracefully — same defensive shape as M3's Bearer bootstrap.

---

## Scope guardrails

What M6 **does not** include, with a pointer to where it lands:

- **RAG tier 2** (vector store, document upload, unstructured-doc retrieval, the `packages/rag` workspace package) — deferred to M7 per the roadmap. M6's "RAG tier 1" is **knowledge-layer enrichment in system prompt + structured-plan tool-call orchestration over the niagaramcp knowledge-layer tools only**.
- **Visual flow builder ("agent blocks")** — its own milestone (M8). M6 ships the structured plan data model + the inline plan editor; the visual canvas editor (react-flow / @xyflow/react with the trigger / condition / tool-call / llm-step / aggregator / output node palette) lands in M8 and edits the same `DiagnosticFlow.plan` shape M6 introduces.
- **Multi-provider** (OpenAI / Ollama adapters via the M5 `LlmProvider` interface) — deferred to M7. M6 ships against Anthropic only; the M5 abstraction holds.
- **Saved flows** (operator-created flows that aren't plugin-contributed, stored in `workspace.json`) — deferred to M8. M6 only consumes plugin-contributed flows; the storage shape (`WorkspaceData.savedFlows`) lands when M8's visual editor produces them.
- **Mid-run plan pause + edit** — the M6 plan editor is pre-execution only. Cancel-and-redo via the existing Stop button is the operator's mid-run lever. Mid-run pause is an m6-followup if the operator workflow shows the need.
- **Soft-cap-on-token-budget head-trim trigger** — the M6 head-trim stays on the M5 hard 200-msg cap (with summarisation). The soft-cap variant lifts to a per-provider context-window check; m6-followup.
- **Rolling summary** (update each N turns instead of drop-block) — m6-followup. The drop-block approach is simpler + matches what the operator can observe in the conversation log.
- **Plan execution as multi-agent orchestration** — single-agent + single-step-at-a-time in M6. Specialist agents (knowledge / math / summariser) per node arrive in the "Later" row of the roadmap.

M6 is **structured plans + plan-and-execute runner + knowledge-layer enrichment + summary-at-trim + selection-aware quick actions**, exactly per the promt16 scope.

---

## Commits (C81 → C89) — four phases, check-ins at phase boundaries

> Each commit passes lint + typecheck + tests + desktop build + e2e. The C-numbering is a guideline — substantial commits splitting mid-flight is pragmatic atomicity, not a deviation.

**C81 — `docs: M6 recon — diagnostic flows + RAG tier 1 plan`** — this document. (Step 0.)

### Phase A — structured plan data model + plan editor + plan-and-execute runner (C82–C83) — *check-in after*

- **C82 — `feat(plugin-api): structured PlanStep + DiagnosticFlow.plan + ConditionExpr`.** Extend `packages/plugin-api/src/index.ts` with:
  - `PlanStep` tagged union — `tool-call` + `llm-step` kinds for v1 (per D1).
  - `ConditionExpr` — tagged-union v1: `{kind:'always'}` | `{kind:'never'}` | `{kind:'var-truthy', path: string}` | `{kind:'var-defined', path: string}` | `{kind:'var-compare', path: string, op: '>' | '<' | '==' | '!=', value: number | string | boolean}` | `{kind:'var-length-gt', path: string, value: number}`. Small set; covers the rooftop flow's "if alarms.length > 0" + "if equipment is defined" + "always" common cases. Open-ended JS expressions are an m6-followup if real flows need more.
  - `DiagnosticFlow.plan?: PlanStep[]` — optional. When present, the flow runs plan-and-execute; when absent (M5 shape), the flow falls back to inserting `prompt` as a user message + running ReAct (back-compat preserved).
  - `evalCondition(expr, vars) → boolean` helper exported from plugin-api — pure function, testable.
  - `substituteVars(template, vars) → string` helper — `${path}` substitution against the bound-variables object (paths use dot notation with array indexing).
  + ~20 unit tests covering each ConditionExpr kind + the substituter (happy-path, missing-var, deep-path, array-index, undefined). **AC:** the type compiles; the helpers handle every kind; existing M5 flows (with `prompt` only, no `plan`) still parse; back-compat preserved for `Plugin.diagnosticFlows`.
- **C83 — `feat: packages/llm-provider runPlan + feat(desktop) plan editor inline in chat`.** Two-part landing inside one commit (the runner depends on the types; the editor depends on the runner — splitting them would leave intermediate broken states):
  - `packages/llm-provider/src/plan-runner.ts` — `runPlan({provider, system, history, plan, params, tools, dispatchTool, signal})` async generator yielding the same `LlmEvent` union as `runReAct` + a small extension: `plan-step-start` / `plan-step-skip` / `plan-step-complete` events the chat view's renderer can label per-step. Plan execution: substitute `${param.x}` references against collected params; for each step, evaluate `runIf` against bound vars; if true, dispatch (a `tool-call` step calls `dispatchTool(name, args)`; an `llm-step` calls `provider.streamResponse` with the templated prompt + the accumulated history); bind the result to `vars[step.bindResultTo]` if specified; emit `plan-step-complete` with the bound value. Errors bail the plan (the rest of the steps stay un-run); the operator sees a per-step error chip + can re-launch the flow (with edits) via the editor.
  - + ~25 unit tests using `FakeLlmProvider` covering: happy path; skipped step via `runIf`; variable substitution including missing-vars; tool-call error halts the plan; llm-step result binds correctly; signal aborts cleanly; back-compat — a flow without `plan` falls through to the M5 ReAct runner.
  - `apps/desktop/src/renderer/src/features/chat/PlanEditor.tsx` — the inline collapsible card per D3. Editable step list (each step row: kind chip + tool / prompt preview + `runIf` indicator + per-step "✓ Run" toggle + edit pencil → opens an inline edit form for `args` / `prompt` / `runIf`). "Run plan" button at the bottom; on click, the parent ChatView dispatches the plan + collected params into `runPlan`. The card collapses post-run to a one-line summary ("Plan run: 4 of 5 steps OK, 1 skipped"); expanded form lists each step's result inline.
  - `apps/desktop/src/renderer/src/features/chat/ChatView.tsx` — branches on `DiagnosticFlow.plan` presence: with-plan → render `PlanEditor` between the user message that launched the flow + the runner; without-plan → M5 fall-through (insert `prompt` as user message, run ReAct). Both paths share the same `dispatchTool` + safety-boundary plumbing — the M5 invariant continues.
  + ~10 component-level smoke tests (PlanEditor renders a passed plan; the edit form roundtrips a value; the Run button fires the callback with the right shape).
- → **Check-in after Phase A:** the structured plan data model + the plan editor + the plan-and-execute runner all land; M5 flows continue to run via the back-compat ReAct fallback (the niagara flows still work — they have only `prompt`, no `plan`); a contrived test plan exercises the runner end-to-end.

### Phase B — async systemPrompt + Niagara knowledge enrichment + rooftop flow lifted (C84–C85) — *no mandatory checkpoint*

- **C84 — `feat(plugin-api): Plugin.systemPrompt → Promise<string | null>`.** Widen the return type to allow async (additive — sync returns continue to satisfy via implicit `Promise.resolve`). `assemblePluginContributions` becomes `async`. The chat-runner awaits the assembled prompt once at the start of each conversation + caches it; per-turn re-assembly is m6-followup if real flows need dynamic system prompts. + a defensive timeout (5 s) on each plugin's `systemPrompt(ctx)` — a misbehaving plugin's slow tool call shouldn't block the chat from sending its first turn; on timeout, the section is dropped + a console warning logged. + tests for the timeout + the async-with-await path.
- **C85 — `feat(niagara): system prompt enrichment via getKnowledgeSummary + rooftop flow lifted to structured plan + knowledge-summary flow lifted`.** Two-part lift:
  - `plugins/niagara/src/system-prompt.ts` — the system prompt becomes async. Calls `ctx.callTool('getKnowledgeSummary', {})` first; formats the result into a `## Connected station inventory` section (counts of spaces / equipment_types / equipment; a compact list of up to 20 equipment names + types; truncate with `… and N more`); appends to the M5 prompt body. On call failure: returns the M5 prompt unchanged + logs a one-line warning (per D4).
  - `plugins/niagara/src/diagnostic-flows.ts` — both flows lifted to structured plans (the M5 `prompt` field stays as the fallback for the M5 back-compat path, but `plan` becomes the canonical execution path):
    - **rooftop-diagnosis.plan**: `tool-call: findEquipment({query: '${equipment_query}'}, bindResultTo: 'equipment')` → `tool-call: inspectComponent({ord: '${equipment.ord}'}, bindResultTo: 'inspect', runIf: var-defined(equipment.ord))` → `tool-call: getActiveAlarms({sourceOrdPrefix: '${equipment.ord}'}, bindResultTo: 'alarms', runIf: var-defined(equipment.ord))` → `tool-call: readHistory({ord: '${equipment.points.supply_air_temp}', aggregation: 'avg', from: '24h ago'}, bindResultTo: 'sat_history', runIf: var-length-gt(alarms, 0))` → `llm-step: 'Summarise the findings for the rooftop unit ${equipment.displayName}. ${alarms.length > 0 ? "Cite the active alarms: ${alarms}" : "Confirm normal operation."} Include a chart code-fence for the SAT history if present. End with operator-readable conclusions.'`.
    - **knowledge-summary.plan**: `tool-call: getKnowledgeSummary(bindResultTo: 'summary')` → `tool-call: validateKnowledge(bindResultTo: 'validation', runIf: always)` → `llm-step: 'Surface the inventory + the integrity issues in priority order (orphan refs first; missing roles second; advisories last). If the knowledge model is empty, suggest the operator run the niagaramcp bulk-import tools.'`.
  - + tests for the new plans (canonical structure verified — every step has the right kind, the right tool name, the right runIf; the conditional skips fire as documented).

### Phase C — conversation summary at head-trim (C86) — *check-in after (the M6 deliverable)*

- **C86 — `feat(desktop): summarise-then-drop on 200-msg conversation cap`.** Lift the M5 D3 head-trim. Per D5:
  - `apps/desktop/src/main/store/conversation-repository.ts`: when `append` sees the count cross `MAX_MESSAGES_PER_CONVERSATION`, emit a `summary-required` event to the renderer via a new `conversations:summaryRequired` IPC event (the existing event-channel pattern from `connections:changed`). The drop is **deferred** — the repo holds the messages until the renderer's summary call completes + comes back with a replacement.
  - `apps/desktop/src/renderer/src/stores/conversations.ts`: a new `summariseAndTrim(profileId, conversationId)` method. Picks the model (`claude-haiku-4-5` for cost — per D5; configurable via a workspace setting that defaults to the cheap-tier choice), fires a one-shot `provider.streamResponse` with the "summarise in ≤200 tokens" prompt + the messages getting dropped, awaits the result, replaces the head with a synthetic assistant-marker message (`marker: 'summary'`), persists via `conversations:save`.
  - `apps/desktop/src/renderer/src/features/chat/MessageView.tsx`: render the `'summary'` marker like the other M5 markers — a centred greyed-out inline note: "— earlier messages summarised —", expandable to show the summary text.
  - `apps/desktop/src/shared/domain/conversations.ts`: `messageSchema.marker` adds `'summary'` to the enum; the existing M5 markers stay.
  + ~15 unit tests covering: count crosses the cap → event fires; summary call returns → head replaced; on summary error → fall back to the M5 silent drop (per D5); the synthetic summary message renders correctly with `marker: 'summary'`. + the summary call's `usage` is captured into the conversation's totals (the UsageBadge continues to work).
  - **AC**: a 201-message conversation triggers a summary call → the first N messages are replaced by a single synthetic summary message → the conversation continues from message N+1 with the summary in the head + the system prompt intact; the operator sees the summary inline as a marker; UsageBadge totals include the summary call's cost.
- → **Check-in after Phase C — the M6 deliverable:** plan-and-execute is the canonical path for the Niagara flows; the system prompt carries the knowledge-layer inventory; head-trim is summarise-then-drop. M5 free-form chat continues to run via ReAct identically.

### Phase D — selection-aware quick actions + e2e + docs + tag (C87–C89) — *big check-in after*

- **C87 — `feat(desktop): selection-aware diagnostic-flow quick actions`.** The Niagara explorer's `useExplorerStore.selected` (the currently-selected ord) feeds into the diagnostic-flow launcher. Per promt16:
  - When the operator has a selection in the Niagara Explorer (`useExplorerStore.selected !== null`), the chat empty state's diagnostic-flow buttons render with the selection name: "Run rooftop diagnostic on `AHU1`" instead of "Run rooftop diagnostic". Clicking pre-fills the flow launcher's `equipment_query` param.
  - The command palette gains the same context-aware naming for the "Run diagnostic flow: …" entries.
  - The plumbing reuses `useHostBus` (M5 C79) — the Niagara `ExplorerView` publishes the selected ord (already does, internally via `useExplorerStore.selected`); the chat empty state + the palette read it via a new `useHostBus.peekSelectedOrd()` channel.
  - + ~5 component tests covering the "no selection / with selection" rendering branches.
- **C88 — `test(e2e): m6 plan execution + summary + selection-aware launchers`.** Two new e2e specs:
  - `tests/e2e/chat-plan.spec.ts` — open Assistant on a Niagara connection → click the Rooftop diagnosis flow button → the plan editor card renders with the four-step plan + the collected `equipment_query` param → click "Run plan" → assert each step renders as a collapsible envelope in order (`findEquipment` → `inspectComponent` → `getActiveAlarms` → `readHistory`) → the final assistant text + chart-fence render. Screenshot: `m6-plan-editor` + `m6-plan-run`.
  - `tests/e2e/chat-summary.spec.ts` — open Assistant; programmatically inflate a conversation past 200 messages (via the `conversations:save` IPC) → send one more message → assert the chat shows the `— earlier messages summarised —` marker; the UsageBadge total includes the summary call's tokens.
  - Selection-aware quick-action verification — extends the chat-rooftop spec: select an equipment node in the Explorer first → switch to Assistant → assert the empty-state button label reflects the selected ord.
  - **AC**: e2e green ×10 (8 existing M1+M2+M3+M4+M5 specs + 2 new M6 specs).
- **C89 — `chore: M6 docs + tag`.** `docs/milestone-6.md` "Adjustments during the M6 build"; master-spec → an "M6 — Diagnostic flows + RAG tier 1 (2026-…, `v0.6.0-m6`)" section; `docs/m{1,2,3,4,5}-followups.md` → mark resolved items (the m5-followup "conversation summary at head-trim" closes; the m5-followup "Plugin.canHandleWrite actually iterated" is **deferred** to when a 2nd write-capable plugin appears — keep open; the m5-followup "richer starter chips with ord autocomplete" stays open); `docs/m6-followups.md` — the M6-deferred items (mid-run plan pause + edit; soft-cap head-trim trigger; rolling summary; user-saved flows storage; the saved-flows UI; the renderer-side knowledge browser; `getDiagnosticContext` feature-detect in the rooftop plan; etc.); tag `v0.6.0-m6`. **AC**: docs reflect the shipped state; tag annotated.
- → **Big check-in after Phase D:** `git log --oneline` C81–C89 + new screenshots (`m6-plan-editor`, `m6-plan-run`, `m6-summary-marker`, `m6-selection-aware-flow`); coverage report; e2e green; the tag `v0.6.0-m6`. Then M7 — RAG tier 2 + multi-provider per the roadmap (a `packages/rag` workspace package with `sqlite-vec`, OpenAI + Ollama adapters via the M5 `LlmProvider` interface, per-profile API key override).

---

## Repo-layout deltas (vs. M5)

- **`packages/plugin-api/src/index.ts`** — gains `PlanStep` + `ConditionExpr` types; `evalCondition` + `substituteVars` helpers; `DiagnosticFlow.plan?` optional field; `Plugin.systemPrompt` return widens to `Promise<string | null>`.
- **`packages/llm-provider/src/plan-runner.ts`** — new. `runPlan(...)` async generator alongside the existing `runReAct`. + tests.
- **`apps/desktop/src/renderer/src/features/chat/PlanEditor.tsx`** — new inline collapsible card per D3. + `PlanStepEditor.tsx` for the per-step edit-form UI (split if PlanEditor grows beyond ~300 LoC; otherwise inline).
- **`apps/desktop/src/renderer/src/features/chat/ChatView.tsx`** — branches on `DiagnosticFlow.plan` presence to pick ReAct vs plan-and-execute.
- **`apps/desktop/src/main/store/conversation-repository.ts`** — `append` defers head-trim, emits `conversations:summaryRequired` event when the cap crosses.
- **`apps/desktop/src/main/ipc/conversations.ts`** + `apps/desktop/src/shared/ipc/contract.ts` — new `conversations:summaryRequired` event channel.
- **`apps/desktop/src/shared/domain/conversations.ts`** — `messageSchema.marker` enum adds `'summary'`; `Message.planFlowId?` + `Message.planStepId?` optional fields for plan-execution log rendering.
- **`apps/desktop/src/renderer/src/stores/conversations.ts`** — gains `summariseAndTrim(profileId, conversationId)` method.
- **`apps/desktop/src/renderer/src/features/chat/MessageView.tsx`** — renders the new `'summary'` marker.
- **`plugins/niagara/src/system-prompt.ts`** — becomes async; calls `getKnowledgeSummary`; injects the inventory section.
- **`plugins/niagara/src/diagnostic-flows.ts`** — both flows gain `plan: PlanStep[]` declarations.
- **`packages/plugin-api/src/host-bus.ts`** — gains `pendingSelectedOrd?: string | null` channel + the `selectedOrdChanged(ord)` / `peekSelectedOrd()` API. Niagara `ExplorerView` publishes on `select` (already happens internally; the new path forwards to the bus).
- **`tests/e2e/chat-plan.spec.ts`**, **`tests/e2e/chat-summary.spec.ts`** — new specs.
- **`docs/m6-followups.md`**, **`docs/milestone-6.md`** — new docs.

## Adjustments during the M6 build

*(Filled in as commits land, per the M1–M5 pattern. The shipped state lives here; commit messages flag deviations; `m6-followups.md` carries the deferred list.)*

**C86 — renderer-triggered summarisation instead of main-emitted `conversations:summaryRequired` event.** Plan said `ConversationRepository.append` would detect the cap-crossing in main + emit a `summary-required` event to the renderer (the M4 `connections:changed` pattern). Built differently: the renderer's `ChatView` watches `messages.length` against `SUMMARY_TRIGGER_THRESHOLD` (180, set below the M5 hard cap of 200 to give the operator a 20-message runway) and fires `summariseAndTrim` itself. Why: the summariser call needs the renderer-resident `LlmProvider` (M5 D4 — provider runs in renderer; the API key lives in the credential vault) + the renderer already owns the `messages.length` invariant via the Zustand store. Routing through main would add a round-trip without adding correctness. The main-side hard-cap silent-drop in `ConversationRepository.append` stays as a safety net — if the renderer never fires for any reason (renderer crash, summary-trigger threshold bug), the conversation still doesn't grow unbounded.

**C86 — `summariseAndTrim` accepts the summariser as a callback rather than constructing the provider itself.** Keeps the conversations Zustand store free of `LlmProvider` / IPC dependencies — the unit tests inject a stubbed `summarise(headSlice) → Promise<SummariserResult | null>` directly. The provider + model resolution + signal threading lives in `ChatView` where the chat-runner already orchestrates those concerns.

**C86 edge cases (per promt19):**
- **Failure (#1)** — `runSummariser` returns `null` on any non-success path (provider throw, error event, empty/whitespace summary, aborted). `summariseAndTrim` then drops the head slice silently + sets `outcome: 'dropped'`. `ChatView` surfaces a fallback chip in the header ("Summary unavailable — older messages dropped"); cleared when the next successful trim lands.
- **Cancellation (#2)** — `AbortSignal` threads through `runSummariser → provider.streamResponse`. The chat view's `useEffect` cleanup function aborts on conversation switch / unmount so a stale summary call doesn't write back into the new conversation's store slot.
- **Prompt design (#3)** — `SUMMARISER_SYSTEM_PROMPT` instructs the model to preserve **key facts / tool results / conclusions reached / pending questions**; first-person; ≤200 tokens. The head slice threads full `tool_use` / `tool_result` blocks through (not just text); diagnostic value lives in tool results. `Plugin.summarisationHints?` deferred to `docs/m6-followups.md` as the per-plugin-guidance seam.
- **Re-summarisation continuity (#4)** — `computeHeadSlice` consumes any prior `marker: 'summary'` message into the next head slice (prior summary + the next 100 messages). The single summary marker grows in scope across multiple trim cycles rather than accumulating multiple markers in the conversation log.
- **Schema (#5)** — additive: `WorkspaceLlmSettings.summariserModel?: 'haiku' | 'sonnet' | 'opus' | 'same-as-main'` (default `'haiku'`); `Message.marker` enum already widened in C83b to include `'summary'`. No version bump. The migrator's permissive `parseLlmSettings` keeps M5 workspaces (without the field) loading.

**C86 — cost transparency.** The summariser call's `usage` lands on the synthetic summary marker's `message.usage` field; the UsageBadge picks it up via the same `sumUsage` aggregate the M5 path uses, so workspace-global session spend totals see the cost without a separate code path.

**C86 split judgement** — landed as a single cohesive commit (the summariser module + the trim transaction + the collapsible-card rendering + the workspace setting + the ChatView trigger). The C85 split rule from promt18 was specific to that commit's orthogonal cache infrastructure; C86's surfaces are all part of the one summarise-then-drop feature, so an intermediate split would leave the runner / store / UI in inconsistent shape mid-tree.

## Ad-hoc check-in triggers (otherwise: note-and-continue)

1. **`runIf` DSL turns out too limited for the rooftop plan's real-world conditions.** Concrete: the plan needs an expression like "alarms.length > 0 OR (sat_history.points.length > 0 AND any(sat_history.points, p => p.v > 25))" — not expressible in the v1 tagged-union DSL. Reconsider: expand the DSL with `and` / `or` / `any` nodes, OR drop the v1 DSL for a tiny expression evaluator (e.g. `jsonata`-shaped). Decision deserves a check-in because it bleeds into M8's visual builder's editor surface.
2. **Async system prompt's `getKnowledgeSummary` call is slow** (real niagaramcp stations with large knowledge models return in 2+ s). The 5 s defensive timeout fires → the chat's first turn lands without the inventory section. The user sees the "fallback" path more often than expected. Reconsider: lift the timeout, parallelise with the user message's stream-response request, OR cache the result aggressively (per-`profileId` in main, refresh on a server-side knowledge-version hash if niagaramcp ships one).
3. **`claude-haiku-4-5` summariser produces lossy summaries** (drops key context the LLM later wants). Reconsider: use Sonnet (3× cheaper than Opus, still good) for summarisation; flag in m6-followups + the UsageBadge tooltip.
4. **The plan editor's UX is fiddly** — operators don't want to edit per-step args inline; they want "run this canned thing" + see the results. Reconsider: hide the editor by default (collapsed), reveal only when the operator clicks "Edit plan before running". Pre-execution edit becomes opt-in, not opt-out.
5. **The selection-aware quick-action's `useHostBus.pendingSelectedOrd` channel becomes a third unrelated channel after the M5 `pendingOrdNav`**. If a fourth channel appears in M6, refactor the host-bus into a typed event emitter with explicit channel names + listeners (M6-or-M7 internal cleanup; tracked as an m6-followup).
6. **The M5 mock LLM provider can't model the structured plan execution** — its programs are sequence-based (turn N has these events), but plan execution can skip turns via `runIf`. The mock either needs `runIf`-aware programs OR the e2e spec uses a different mocking strategy (e.g. tool-call interception that returns canned results). Decision affects the C88 e2e shape.

## Check-in points

- **After Phase A** (C83): plan model + editor + runner + back-compat path land; M5 flows still run as before. Structural milestone — gives the M6 work a substrate to build on.
- **After Phase C** (C86): plan-and-execute is the canonical Niagara-flow execution path; system prompt carries the knowledge-layer inventory; head-trim is summarise-then-drop. (The M6 deliverable.)
- **Big check-in after Phase D** (C89): `git log --oneline` C81–C89 + new screenshots + coverage + e2e green ×10 + the tag `v0.6.0-m6`. Then M7 — RAG tier 2 + multi-provider per the roadmap.
