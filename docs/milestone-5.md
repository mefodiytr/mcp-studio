# Milestone 5 — AI co-pilot

> A chat-based assistant per connection. The LLM reasons about the connected
> system in natural language, gathering context via the same tool calls the
> operator uses manually. Writes proposed by the LLM route through the M3
> pending-changes queue — the operator approves; the LLM never commits
> directly. The Niagara plugin contributes a system prompt + starter questions
> + a "rooftop diagnosis" diagnostic flow. Chart-inline rendering reuses the
> M4 `@mcp-studio/charts` primitives so a `readHistory` result drops into a
> chat message without a second chart lib.

**Target:** `v0.5.0-m5` · ~4 weeks · commits C69 → C80, four phases, check-ins at phase boundaries (after A, after C, big one after D). The plan + acceptance criteria + the decisions below are this doc; it's committed as the "Step 0" of M5 (`docs: M5 recon — AI co-pilot plan`).

The same workflow as M1/M1.5/M2/M3/M4: written plan first → atomic commits, each passing `pnpm lint` + `pnpm -r --if-present typecheck` + `pnpm -r --if-present test` + `pnpm --filter @mcp-studio/desktop build` + `pnpm test:e2e`, all green; constructive deviation = labelled + rationale, never silent; the §13 coverage ratchet (run coverage before committing if a commit touches a covered package; add a test in the same commit if near the floor; no fix-forward); no progress check-ins within a phase except (a) ad-hoc on an architectural contradiction, (b) phase boundaries. The C-numbering is a guideline — splits / re-orderings are pragmatic atomicity, not deviations.

Source-of-truth vision: [`handover.md`](handover.md) Part 2 — written at M2/M3 boundary; M5 reconciles the §8 open questions against the **actual** M3+M4 reality (the chart primitives shipped, the `PluginContext.callTool({write:true})` seam already exists, the per-profile persistence shape is established by the M4 watch store, `useExplorerStore.known` is now a three-consumer shared cache).

---

## What earlier milestones already give M5

- **`PluginContext.callTool(name, args?, opts?: { write?: boolean })`** (M3 C52) — the `write` flag is already threaded through `connections:call` IPC into `ConnectionManager.callTool` and `tool-history-repository.add`. M5's safety boundary (D5) extends the **same seam** with a caller-attribution arg; no new IPC channel for write tools.
- **M3 audit trail with `write` flag + "Writes only" filter + JSON export** (`HistoryPanel`) — every AI-initiated tool call is already filterable end-to-end. M5 adds an optional `actor` field to `toolHistoryEntrySchema` (`'human'` | `{type:'ai',conversationId}`) — backward-compat additive; "Writes only" naturally covers AI-proposed writes; a future "AI-initiated" filter is one predicate.
- **M3 pending-changes queue** (`plugins/niagara/src/state/pending-store.ts`, per-`connectionId`, session-only) — the **natural safety landing zone** for AI-proposed writes. `pendingStore.enqueue(connectionId, op)` is the API the safety interceptor calls; the existing Changes view renders queued ops identically regardless of source. The M5 attribution work is a small extension: ops carry `source?: 'human' | { type: 'ai', conversationId }` so the Changes view can badge AI-proposed ops.
- **`@mcp-studio/charts` (M4)** — `TimeSeriesChart` / `Sparkline` / `BarChart` + `downsampleTimeSeries` are already shipped, already shared-chunked (the M4 `manualChunks: { recharts: [...] }` win), already exercised by three consumers (HistoryView, MonitorView, UsageView/PerfView). M5's chart-inline rendering in chat (D8) is a fourth consumer of the same `TimeSeriesChart` — no new chart dep.
- **`useExplorerStore.known`** (M4 cross-view shared cache; QuickNav + History overlay picker + Monitor drop-target lookup) — the **AI co-pilot's ord-mention autocomplete** is the fourth consumer flagged in `m4-followups.md`. M5 doesn't change the store's shape; the AI rail items just read `known` for "did the user mention an ord that the system knows about" highlighting.
- **`workspace-store`** (JSON, atomic *.tmp → rename, `schemaVersion` + idempotent `migrate()`) — M3 bumped to v2 (audit `write`), M4 bumped to v3 (`watches`). M5 bumps to **v4** with one idempotent migrator step adding `conversations?: Record<profileId, Conversation[]>` + `llm?: { provider, model? }` workspace-level preferences. The pattern is now well-trodden (M4 `WatchRepository` is the template).
- **The Zustand-singleton `EMPTY` pattern** (M3 C55 / M4 C65) — `selectMessages(conversationId)` must return a shared `EMPTY: readonly Message[]` for the no-conversation case; otherwise React #185 loops. Documented as canonical in `m4-followups.md`; M5 follows it for `useConversationStore` (D3).
- **The `manualChunks` bundle-splitting pattern** (M4 chore for recharts) — M5 adds **two new entries**: `@anthropic-ai/sdk` (≈150 kB gz) into `chunks: { anthropic: ['@anthropic-ai/sdk'] }`, and `react-markdown` (≈80 kB gz) into `chunks: { markdown: ['react-markdown','remark-gfm'] }`. Both lazy-loaded only when the Chat rail opens; the eager renderer stays small (the M4 599 kB anchor).
- **The defensive permissive-parser pattern** (M4 `lib/niagara-history.ts` accepting `records`/`points`/`samples` and `t`/`ts`/`timestamp`) — applied in M5's LLM tool-result parser to handle Anthropic's MessageStreamEvent variant fields and to handle multiple structured-output shapes (D8).
- **`useQueries` over a dynamic-length set** (M4 C64 HistoryView lesson — rules-of-hooks violated by `useQuery` in a `.map()`) — the chat view's tool-call envelope-list uses the same pattern when displaying parallel tool calls from a single assistant turn.
- **Plugin contract precedent** (M2 `toolSchemaHints`, M3 `toolAnnotationOverrides`) — `Plugin.systemPrompt` / `starterQuestions` / `diagnosticFlows` (D7) follow the same shape: optional contributions, default sensible without them, merged in a single resolution point (`apps/desktop/src/renderer/src/lib/plugin-prompts.ts`).
- **The `MCPSTUDIO_LLM_PROVIDER=mock` env-var precedent** — same pattern as M1's `MCPSTUDIO_E2E_FAKE_*` and M4's `MCPSTUDIO_E2E_SCREENSHOTS=1`. The LLM provider factory picks the mock when set; e2e specs set it explicitly.

What handover.md described as forward-looking but is already shipped: chart primitives (handover §"Integration points" — "we'd want chart-inline rendering" → M4 charts package is ready); the write-flag audit (handover § "Audit composition with M3" assumed it; M3 shipped it); per-profile persistence shape (handover assumed; M4 watches established it).

---

## Recon — decisions, with recommendations

The nine open questions from `handover.md` §"Open questions deferred to milestone-planning time", reframed against the M3+M4 reality.

### D1 — LLM provider: **Anthropic Messages API** for v1, with the `LlmProvider` interface defined from day one in `packages/llm-provider`

Two shapes:

- (a) **Single-provider, no abstraction.** Call `@anthropic-ai/sdk` directly from main. Smallest surface; commits us to Anthropic.
- (b) **Single-provider, abstraction in place.** Define `LlmProvider` with one adapter (Anthropic) behind it. M7+ adapters (OpenAI / Ollama) plug in without repainting consumers. Tiny cost up front (~one interface file + one factory).

**Recommendation: (b).** The interface is small (`LlmProvider.streamResponse({system, messages, tools, signal, model?, maxTokens?}): AsyncIterable<LlmEvent>`); the cost to define it is hours. `LlmEvent` is a **normalised** stream-event union (`text-delta` / `tool-use-start` / `tool-use-input-delta` / `tool-use-complete` / `usage` / `message-stop` / `error`) — the Anthropic adapter consumes the Messages SSE stream and emits these; future adapters map their stream shapes onto the same union. **Multi-provider UI is M7+** (no in-app provider picker yet in M5; the workspace just stores `llm.provider: 'anthropic'`). Anthropic is the v1 default because Claude has the most natural ergonomics for MCP-shaped tool use (per handover) and because this is Anthropic-internal infrastructure — eating own dog food.

**No orchestration framework.** No LangChain, no LangGraph, no Vercel AI SDK. The ReAct loop is ~80 lines of TS (D2); Anthropic's SDK handles the SSE + tool-use envelopes natively; a framework would only obscure the path. Same philosophy as M1's "wrap `@modelcontextprotocol/sdk` thinly".

**Out of scope for M5:** OpenAI / Ollama adapters; provider picker UI; per-conversation provider override.

### D2 — Agentic loop: **ReAct as v1**, plan-and-execute deferred to M6

Per handover recommendation. ReAct = Reasoning + Acting interleaved: the LLM picks one tool → sees result → reasons → picks next or finishes. Bounded N turns (recommendation: **N=12**; configurable workspace setting; exceeded → the runner injects a synthetic system message "turn limit reached; summarise what you have"). Most natural for the diagnostic-walk scenarios; the only loop pattern that doesn't require pre-committing to a plan.

Loop shape (in `packages/llm-provider/src/runner.ts` — provider-agnostic, takes an `LlmProvider` + the `tools/list` shape + a `dispatchTool(name, args) → Promise<unknown>` callback):

1. Assemble `messages = [...system, ...history, currentUserTurn]`.
2. `for turn in 1..N`: call `provider.streamResponse(...)` → stream `LlmEvent`s back to the caller (the chat view rendering).
3. On stream end: if the message contained tool-use blocks, dispatch each via `dispatchTool`, append a `tool_result` user message per call, loop. Otherwise stop.
4. Cancellation: `AbortSignal` threaded through the provider stream + each `dispatchTool` call. Aborted mid-stream → emit `{type:'aborted'}`; in-flight MCP calls best-effort cancelled (HTTP transport carries the signal; stdio's JSON-RPC request can't be cancelled mid-flight — the chat view surfaces the truth: "abort signalled; the last tool call may still complete on the server").

**Plan-and-execute** lifts `Plugin.diagnosticFlows` from "a templated user prompt" (M5 D7) to "a stored plan template the runner executes deterministically" — a real lift; defer to M6. M5's diagnosticFlows ship as user-message prompts that ReAct walks naturally; M6's plan-and-execute upgrades them to deterministic plans where the LLM's role narrows to "fill in the parameters + summarise the results".

**Out of scope for M5:** multi-agent orchestration; self-revising plans; reflexion loops.

### D3 — Conversation scope: **per-connection, multi-conversation within a connection** (one rail item, a left-side conversation switcher)

Three shapes:

- (a) **One conversation per connection.** Simple; loses context fast for long sessions.
- (b) **Per-tab.** Mirrors the existing M1 tabbing. A connection can have N tabs each with its own chat — but tabs are session-only, so the chat would die on app restart. Wrong shape.
- (c) **Multi-conversation per connection, persisted per-profileId.** Each conversation is its own thread (own history, own optional system-prompt override); the connection's tool catalog + plugin contributions are shared.

**Recommendation: (c).** A connection scopes the *capability* (tool catalog + auth + plugin contributions); a conversation scopes the *task* (the rooftop diagnosis chat, the BQL query chat). Pollution across tasks is bad UX (a 50-turn rooftop history bleeds tokens into the next question); a hard scope per-conversation is right. The chat rail has a left-side conversation list ("New conversation" + a list of recent conversations) — the same shape as VS Code's Source Control / Comments / Search rails.

**Persistence:** per `profileId` in `workspace.json` (the M4 watches pattern). Schema:

```ts
WorkspaceData.conversations?: Record<profileId, Conversation[]>
Conversation = { id, title, createdAt, updatedAt, model?, messages: Message[], systemPromptOverride? }
Message = { id, role: 'user' | 'assistant' | 'tool_result', content: ContentBlock[], usage?, ts }
ContentBlock = { type:'text', text } | { type:'tool_use', id, name, input } | { type:'tool_result', tool_use_id, output, isError? }
```

`WORKSPACE_VERSION` 3 → 4 with an idempotent migrator (the M4 watches template). Per-conversation message cap (recommendation: **200 messages**) trimmed from the head with a `<system message: earlier messages trimmed>` placeholder when the limit hits — the M3+M4 200-entry tool-history precedent.

**Title generation:** first user message's first ~40 chars (truncated); rename via a small input in the rail. **No auto-summarisation** in M5; tracked as an m5-followup.

**Out of scope for M5:** workspace-global cross-connection archive / search; conversation export to markdown (one-line followup); shareable conversations (server-side persist via `saveConversation` — niagaramcp tool that doesn't exist yet, per handover §7).

### D4 — LLM API key: **workspace-global, provider-account-tied** (one Anthropic key serves all connections)

Two shapes:

- (a) **Per-profile in the existing safeStorage vault** (alongside the connection's Bearer secret).
- (b) **Workspace-global** — one key keyed by `'llm:anthropic:apiKey'` in the vault; reused across all connections.

**Recommendation: (b).** The LLM key is the user's **provider account** (their Anthropic billing), not a per-station credential. Storing it once is the right shape — every conversation against every connection shares it. Per-profile override is an M6+ knob for the "isolated customer-billing enterprise" case (when an MSP runs MCP Studio against multiple customers' stations with separate billing); document the shape, defer the UI.

**Vault placement:** the existing `apps/desktop/src/main/security/vault.ts` (M1.5) handles arbitrary `'<key>': base64-encrypted-bytes` entries. M5 adds one new vault key prefix: `llm:<provider>:apiKey`. Same encryption (safeStorage where available, plaintext fallback with a warning in dev).

**UI:** a small Settings → AI section (new modal — `features/settings/SettingsView.tsx`), surfaced from (a) the chat empty-state ("Connect your Anthropic API key to start"), (b) a status-bar gear icon. The key never leaves main; every LLM call routes through `llm:streamResponse` IPC. Renderer never touches the raw key.

**Token budgets / cost ledger** (handover §8 open question): M5 ships a tiny per-conversation token counter in the chat header — `usage.input_tokens` / `output_tokens` accumulated from `LlmEvent.usage` events; a configurable per-conversation soft cap (default 50k tokens, warning at 80%); a workspace-level "spent this session" approximation using Anthropic's published per-model token prices (hardcoded; flagged as an estimate). Cross-session billing dashboards are M6+.

**Out of scope for M5:** per-profile key override UI; multi-key (dev vs prod) per connection; billing dashboard.

### D5 — Tool-call interception architecture: **in main, at `ConnectionManager.callTool`, with a `caller` attribution arg** — the architectural invariant

The handover called this out as "worth a small dedicated design pass before any AI write-tool wiring". Here's the pass.

Three placements:

- (a) **Renderer-side intercept.** The chat view inspects each tool the LLM proposes, checks the effective annotations (post-overrides), routes writes to `pending-store` before invoking. **Problem: bypassable.** Any other renderer path (a slip in some future feature view, a typo in a plugin) could call `tools:call` with no check. The safety boundary is not enforceable.
- (b) **A new `AgentDispatcher` in main.** The LLM-runner lives in main; AgentDispatcher mediates every LLM tool-call. The chat view subscribes to events. **Better, but it duplicates `ConnectionManager.callTool`'s code path — two ways to invoke an MCP tool exist, drift becomes inevitable.**
- (c) **`ConnectionManager.callTool` gets a `caller` arg.** Threaded through the existing `tools:call` IPC. If `caller.type === 'ai'` AND `effectiveAnnotations(toolName).destructiveHint === true || effectiveAnnotations(toolName).readOnlyHint === false` (i.e. it's a write, the M3 `isWriteCall` predicate) → instead of dispatching to the MCP SDK, return a `{ kind: 'pendingEnqueued', op: WriteOp }` outcome envelope. The renderer's chat runner sees this, displays "queued — awaiting operator approval", and notifies the Niagara plugin's pending-store via a small plugin-api seam.

**Recommendation: (c).** The connection manager is the single chokepoint for **all** tool calls — human (M1+M2+M3) and AI (M5). Putting the safety routing here is architecturally airtight. The renderer **can't** bypass — every `tools:call` IPC carries an explicit `caller` arg; main rejects calls with no `caller` (default-deny → human-attribution is opt-in for back-compat with M1+M2+M3 callers, who get `caller: 'human'` from a tiny wrapper).

**The seam to the pending-store:** the chat view receives `{kind:'pendingEnqueued', op}` and dispatches via `host.broadcast({type:'plugin:enqueue', op})` to a renderer-side bus the Niagara plugin subscribes to. The plugin's `pending-store.enqueue(connectionId, op, { source: { type:'ai', conversationId } })` lands the op. The op carries `source` so the Changes view can badge AI-proposed ops with a small "AI" chip + the conversation ID linkable back to the chat.

**Effective-annotations source of truth in main — C75 AC, not deferrable** (nuance, accepted): the safety predicate `isWriteCall(effectiveAnnotations)` runs in main; main needs the post-override annotations **without a renderer round-trip** (the round-trip is a latency + race source, and a duplicated-override-table is a drift source). The fix is single-source-of-truth: **migrate `toolAnnotationOverrides` from the runtime `Plugin` object to the static `PluginManifest`**. The M2 `pluginManifestSchema` already carries identity + activation regex; extending it with `toolAnnotationOverrides?: Record<string, Partial<ToolAnnotations>>` lets main register the override table from the manifest at startup. Main exposes `pluginRegistry.getEffectiveAnnotations(connectionId, toolName)` (or equivalent); `ConnectionManager.callTool`'s safety predicate consults the registry. The existing renderer-side M3 C50 `applyAnnotationOverrides` becomes a **thin consumer of the same registry** via a new `pluginRegistry:getEffectiveAnnotations` IPC (or a hydration on connection-activated event so the renderer caches the table) — one source of truth, no drift. The Niagara plugin's existing override map declaration (`plugins/niagara/src/tool-annotations.ts` → `NIAGARA_TOOL_ANNOTATION_OVERRIDES`) migrates from a static plugin-side export to the `PluginManifest.toolAnnotationOverrides` field in `plugins/niagara/src/index.ts`. **Without this migration, write tools that niagaramcp mis-annotates as `readOnlyHint:true` (the entire `walkthrough-write` family + `importKnowledge` — the M3 C49–C50 fix's reason for being) would bypass the AI safety gate** — a regression of the M3 guarantee. The migration lands as part of C75 acceptance criteria.

**Edge case:** write tools called from a plugin that's **not** the Niagara plugin. M5 has only the Niagara plugin, so the edge case is theoretical. The host-side `pendingEnqueued` envelope carries the tool name + args; if no plugin claims it (no `Plugin.canHandleWrite?(op)` claims `true`), the chat view shows "queued, but no plugin can render this for approval — please review the JSON below" with a raw approve/reject path. M6+ pluggable pending-stores per plugin if/when a second plugin adds writes.

**For human-initiated writes:** `caller: 'human'` → no interception; the call goes through the existing M3 path (the destructive-confirm dialog in the renderer already gates it). The pending-store still works manually via the Property-sheet edits + tree context menu, exactly as M3 shipped.

**Out of scope for M5:** AI-readable writes (where the LLM wants to dry-run a write before proposing) — `removeComponent(dryRun:true)` is already in M3; a generic "shadow execute" is m5-followup.

### D6 — Streaming UX: **token-stream text, collapsible tool-call envelopes, Stop button via AbortSignal**

Three sub-questions surfaced in handover §8:

**Token streaming?** Yes, inline word-by-word as Anthropic streams. Same React Query streaming pattern as M4 sparkline polling (subscribe to a stream, append text-deltas to the message state). The `ConversationRunner` exposes an `AsyncIterable<LlmEvent>` that the chat view consumes — text-deltas append to the in-progress assistant message; the in-progress message renders with a blinking caret until `message-stop`.

**Tool-call envelopes?** Rendered as soon as the LLM emits a `tool-use-start` block — an inline card ("Calling `findEquipment(query: …)`…" with a spinner). On completion the card collapses to a one-line summary ("→ 2 components found") with a `^ Show details` toggle revealing args + result JSON (consistent with the M1 `ToolInvocationDialog` raw JSON-RPC console). Parallel tool calls within one assistant turn render as stacked cards.

**Cancel-mid-loop?** A "Stop" button while the loop is running. Click → AbortController.abort() → the `LlmProvider`'s stream is cancelled (Anthropic SDK takes signal); the in-flight MCP tool call (if any) is best-effort cancelled (`AbortSignal` threaded through `ConnectionManager.callTool` for HTTP transport; stdio's request can't be cancelled mid-flight — surface the truth). The conversation state captures `[stopped by user at turn N]` as a synthetic assistant-role marker; subsequent turns can resume.

**Markdown rendering:** `react-markdown` + `remark-gfm` (tables, strikethrough, task lists). Custom renderers for: `<chart>` blocks (D8), `<ord>` blocks (clickable ord references that open the Niagara Explorer at that path — uses the existing `command:open-view` palette command), code blocks (syntax highlighting via `highlight.js` lazy-loaded only inside the chat chunk — small dep, fine for v1; flag for replacement if it bloats).

**Out of scope for M5:** rich-markdown editing in the user input (plain `<textarea>` for v1; slash commands in M6); voice input; per-turn regenerate.

### D7 — Plugin contributions: `Plugin.systemPrompt` + `starterQuestions` + `diagnosticFlows` — additive contract extension, Niagara plugin first

Confirm the handover sketch with three refinements:

```ts
interface Plugin {
  // … existing M2/M3 fields
  systemPrompt?: (ctx: PluginContext) => string | null;
  starterQuestions?: (ctx: PluginContext) => string[];
  diagnosticFlows?: (ctx: PluginContext) => DiagnosticFlow[];
}

interface DiagnosticFlow {
  id: string;            // stable key
  title: string;         // palette label
  description: string;   // tooltip
  prompt: string;        // the *user-message template* the runner sends
}
```

- **`systemPrompt`** — called once per chat-session start with the bound `PluginContext`; returns text appended to the assembled system prompt (or `null` to opt out for this connection). The host assembles `system = [hostBaseSystemPrompt, ...activePlugins.map(p => p.systemPrompt?.(ctx))].filter(Boolean).join('\n\n---\n\n')`. Niagara: ORD format explanation + knowledge layer hint (`findEquipment` / `findInSpace` / `findPoints` semantics) + kitFuzzy concept introduction + the BQL syntax wart (M1 followup #3) + equipment-point role-mapping semantics. ~300 words; falls within Anthropic's input-token efficiency window without breaking the bank.
- **`starterQuestions`** — chips in the empty-conversation state. Niagara: ["What's the current status of …?", "Show recent alarms in …", "Compare today's … trend to yesterday's"]. **Static strings for v1** — the `[bracket]` placeholders are noisy but tolerable; **richer prompts with ord autocomplete** become an m5-followup. Maximum 6 chips contributed per plugin; host caps at 6 total (Niagara contributions take priority over host defaults).
- **`diagnosticFlows`** — surfaced as Command Palette entries ("Run rooftop diagnostic", "Equipment health overview") and as a "Diagnostic flows" submenu in the chat empty state. Selecting one inserts `prompt` as the user message and lets ReAct take over. The Niagara plugin contributes **two** flows in M5 (the bare minimum to validate the contract): "Rooftop diagnosis" (the handover §A scenario) and "Knowledge layer summary" (a low-stakes read-only one — `getKnowledgeSummary` + `findEquipment(query:'*')` + summarise).

**Resolution point:** a single host helper `assemblePluginContributions(plugins, ctx)` in `apps/desktop/src/renderer/src/lib/plugin-prompts.ts` — same shape as M3's `applyAnnotationOverrides` (one resolution point for system prompt + starter questions + diagnostic flows so the chat view, the palette, and the empty state all see identical contributions).

**Plan-and-execute extension** (M6 only — not landing in M5): `DiagnosticFlow.plan?: PlanStep[]` where `PlanStep` is a stored tool-call template with placeholder fields the LLM fills in. M5's `prompt` field carries the same intent expressed as a user message; M6 lifts it.

**Out of scope for M5:** dynamic `systemPrompt` evaluation (re-runs per turn based on current state); per-tool prompt overlays; plugin-contributed UI panels in the chat (a Niagara-specific "Equipment overview card" rendered inline) — m5-followup.

### D8 — Chart-inline rendering: **JSON code fence with `chart` language tag, parsed via `react-markdown`'s `components.code`, rendered via `@mcp-studio/charts`**

Three shapes:

- (a) **Plain markdown image (`![chart](data:image/png;base64,…)`)** — would need server-rendered PNG. Big infra detour for a desktop app.
- (b) **Structured `<chart>` tag in the assistant's text** — `<chart type="timeseries" data="<base64-encoded-json>" />`. Custom react-markdown extension parses, swaps in a chart component. Base64 in an attribute adds ~33% token inflation, is character-level error-sensitive (one bad char breaks parsing), and requires the LLM to learn a custom XML-like syntax.
- (b') **JSON code fence with a `chart` language tag** — patterned output the LLM emits naturally; clean interception via `react-markdown`'s `components.code` prop; fallback-to-code-block on JSON parse failure is free (the markdown pipeline already renders unknown languages as a code block).
- (c) **Anthropic structured-output channel** — return JSON alongside text via tool-use-shaped output. Cleaner protocol-wise but Anthropic's API doesn't have a first-class "structured side-channel" for arbitrary assistant outputs (only tool-use); reinventing it on top of tool-use is awkward.

**Recommendation: (b').** The LLM is instructed (host-base system prompt) that to embed a chart, emit a JSON code fence with the `chart` language tag:

````
```chart
{"type": "timeseries", "title": "SAT trend (last 24 h)", "series": [{"name":"SAT","points":[{"t":"2026-05-14T09:00:00Z","v":21.2}, …]}]}
```
````

The renderer's `react-markdown` `components.code` prop intercepts code blocks with `className === 'language-chart'` (the standard react-markdown convention), parses the body as JSON, validates with zod (`chartPayloadSchema`: `{ type, title?, series, xDomain?, yDomain? }`), then renders `<TimeSeriesChart>` from `@mcp-studio/charts` inside a fixed-aspect container (new component — `apps/desktop/src/renderer/src/features/chat/ChatChart.tsx`). **JSON parse failure → fall back to rendering as a normal `chart` code block** (the user sees the payload, not a broken chart; the conversation doesn't break). **Zod validation failure → same fallback** with a small "invalid chart payload" tag.

**Why a code fence over `<chart>` with base64:** LLM emission is natural — code fences are patterned output Claude emits well already; custom XML-like syntax would require few-shot examples in the system prompt. Base64 in an attribute has the token + error-sensitivity costs above. The `components.code` interception is the cleanest react-markdown idiom (no custom remark plugin). Streaming-partial-content concerns are addressable the same way for either shape — the markdown renderer naturally waits for the closing fence before invoking the `code` component on a complete block, so partial-content half-renders aren't a concern.

The mock LLM provider for tests emits deterministic `chart` code fences in the rooftop scenario so the e2e can assert "a `TimeSeriesChart` SVG renders inside a chat message".

**Future extensions** (m5-followups, all behind the same `components.code` interception): `language-bar` for `BarChart`, `language-sparkline` for inline-sentence sparklines (semantics tbd — code fences are block-level so an inline form would need a different shape; m6 thinking), `language-ord-card` for quick-look component cards composable with the rest of Niagara's read tools.

**Out of scope for M5:** interactive charts in chat (zoom, range-pick); chart export-from-chat; saved charts attached to a conversation.

### D9 — Test strategy: **programmatic mock LLM provider in `tests/fixtures/llm-mock/`** (deterministic tool-call sequences), recorded-playback deferred

Two paths:

- (a) **Recorded conversation playback** — capture a real LLM round-trip's stream events to a JSON fixture, replay deterministically. **Problem: brittle.** Small system-prompt drift invalidates the fixture; tests would need re-recording on each prompt change. The fixture file size grows linearly with conversation length.
- (b) **Programmatic mock provider.** `{ programs: Record<string, LlmEvent[]> }` — the mock picks a program based on the first user message's content (substring or regex match) and replays it. The e2e writes `"Run rooftop diagnostic"` → the mock emits the canned tool-call sequence (`findEquipment` → `getActiveAlarms` → `readHistory` → `<chart>` block + summary text); the spec asserts the chat view renders the right envelopes + final summary + chart.

**Recommendation: (b) for v1.** A programmatic mock is unit-testable, deterministic, and the e2e specs read clearly. The mock lives at `tests/fixtures/llm-mock/index.mjs` (plain ESM, same shape as `niagara-mock/server.mjs`); imported in main when `MCPSTUDIO_LLM_PROVIDER=mock` is set. Recorded playback can be layered in later for canary-style "the Anthropic API didn't change shape" tests against a captured real run (m5-followup).

**Mock programs for M5 e2e:**
1. `'greeting'` — text-delta "Hello, how can I help?" + message-stop. Smoke test: chat renders user/assistant turns.
2. `'rooftop'` — the §A handover scenario: tool-use(`findEquipment`) → tool-use(`getActiveAlarms`) → tool-use(`readHistory`) → text-delta with a `<chart>` block + summary. Asserts the ReAct loop + tool-call envelopes + chart-inline render.
3. `'write-propose'` — tool-use(`setSlot`) (which the safety boundary intercepts → pending-store). Asserts the AI-proposed-write safety path (the conversation continues with "queued for operator approval"; the operator approves via the Changes view; the chat receives a follow-up "applied" event).
4. `'cancel'` — long text-delta sequence used by the Stop-button e2e (the spec aborts mid-stream + asserts the conversation captures `[stopped by user]`).

**Unit tests:**
- `packages/llm-provider/src/runner.test.ts` — the ReAct loop with a `FakeLlmProvider` (deterministic, no fixture file) covering happy path, max-turn cap, tool-result threading, abort semantics.
- `packages/llm-provider/src/anthropic.test.ts` — Anthropic SDK adapter mapping the SSE event types to `LlmEvent`s (against synthesised stream events; no network).
- `apps/desktop/src/main/agent/intercept.test.ts` — the safety-boundary unit test (the M3 `isWriteCall` predicate + the `caller` attribution routing).
- `apps/desktop/src/renderer/src/features/chat/ChatChart.test.tsx` — the `<chart>` parser (valid payload renders; corrupt base64 renders fallback; missing `type` renders fallback).

**Out of scope for M5:** real-LLM smoke test in CI (cost, flake); fixture-recorder CLI for capturing real runs.

---

## Cross-product dependencies on niagaramcp (forward-looking, none blocking M5)

Per handover §"Cross-product dependencies on niagaramcp (forward-looking)". M5 ships against the **current** niagaramcp tool surface (the same 46 tools the M2/M3/M4 fixtures lock). The tools below would unlock subsequent AI scenarios; documenting **where they integrate when they arrive** so future-us has the landing zone:

- **`getTrendAnalysis(ord, from, to, type)`** — once available, becomes the preferred call inside the rooftop diagnostic flow's "trend analysis" step (currently the LLM does math on raw `readHistory` arrays — wasteful tokens). Integration point: `plugins/niagara/src/diagnostic-flows.ts` — the rooftop flow's `prompt` text gains an instruction "use `getTrendAnalysis` if available; fall back to summarising `readHistory` results". The system prompt's tool-preference hint auto-updates because it's templated from `ctx.listTools()`.
- **`getFuzzyAssessment(equipmentId)` / `getKitFuzzyOutputs(ord)`** — bulk fuzzy reads. Same integration point: rooftop flow gains a fuzzy-assessment step. The chat view doesn't change.
- **`getDiagnosticContext(equipmentId)`** — the pre-baked one-call diagnostic primitive. Would significantly compress the agent loop (1 call instead of 4). Integration: rooftop flow becomes "if `getDiagnosticContext` exists, prefer it; else do the four reads". Same `tools/list` feature-detect pattern as M3's Bearer bootstrap (D4).
- **`saveConversation` / `loadConversation`** — server-side conversation persistence. M5 has only local persistence (workspace.json per profileId); if niagaramcp ever ships these, MCP Studio gains a "Share this conversation" affordance. Defer.

Tracked: `m1-followups.md` (the canonical niagaramcp coordination list). M5 adds **no new niagaramcp asks** in this milestone — every M5 deliverable works against today's surface.

---

## Scope guardrails (per handover)

What M5 **does not** include, with a pointer to where it lands:

- **RAG tier 2 (vector store, document upload, unstructured-doc retrieval)** — deferred to M7 / M8. The package shape (`packages/rag`) and the local vector store choice (sqlite-vec vs LanceDB) get reconned at that milestone. M5's "RAG" is tier 1: structured knowledge already in niagaramcp (`findEquipment` / `findInSpace` / `findPoints` / `getKnowledgeSummary`), queried via tool calls — no embedding store needed.
- **Visual flow builder ("agent blocks")** — its own milestone (M8+). The wire-sheet-style visual editor for power-user agent workflows; saved flows; scheduled execution. M5's `Plugin.diagnosticFlows` shape is the data model precursor (a stored prompt template per flow); M6's plan-and-execute extension is the second; the visual editor is the third.
- **Multi-agent orchestration** — deferred (the "later" row in handover's phased delivery sketch). Specialist agents (knowledge / math / summariser) routed by a main agent; M5's single ReAct loop is the simpler scaffolding it'll grow into.
- **OpenAI / Ollama provider adapters** — abstraction in place from M5 (D1), adapters in M7+.
- **Per-profile LLM key override** — workspace-global key in M5 (D4); per-profile is M6+.
- **Plan-and-execute** — ReAct in M5 (D2); plan-and-execute lifts diagnosticFlows in M6.
- **Real-LLM CI smoke test** — programmatic mock in M5 (D9); fixture-recorder + canary in M6+.
- **Interactive chat charts** — static `<TimeSeriesChart>` render in M5 (D8); zoom / brush / pan are m5-followup.

M5 is **chat foundation + Niagara plugin contributions + write-tool safety interception**, exactly per the prompt scope.

---

## Commits (C69 → C80) — four phases, check-ins at phase boundaries

> Each commit passes lint + typecheck + tests + desktop build + e2e. The C-numbering is a guideline — substantial commits splitting mid-flight is pragmatic atomicity, not a deviation.

**C69 — `docs: M5 recon — AI co-pilot plan`** — this document. (Step 0.)

### Phase A — provider + chat foundation (C70–C72) — *check-in after*

- **C70 — `feat: packages/llm-provider (LlmProvider interface + Anthropic Messages adapter)`.** New workspace package `@mcp-studio/llm-provider`. Exports: `LlmProvider` interface, `LlmEvent` union, `runReAct({provider, system, history, tools, dispatchTool, signal, maxTurns?})` (the ReAct loop), `createAnthropicProvider({apiKey, model})` (the Anthropic adapter). + the `FakeLlmProvider` test helper. + ~30 unit tests (event-stream mapping, ReAct loop, abort, tool-result threading, max-turn cap). New runtime dep: `@anthropic-ai/sdk`. **AC:** the package builds + tests; no other package imports it yet; the Anthropic adapter is exercisable from a tiny CLI (`packages/llm-provider/bin/repl.mjs` for local sanity, not committed to e2e).
- **C71 — `feat(desktop): chat foundation — rail item, conversation store, message rendering`.** `WorkspaceData.conversations?` + `WORKSPACE_VERSION` 3 → 4 with an idempotent migrator. `apps/desktop/src/main/store/conversation-repository.ts` (+ tests) — `list/get/save/delete/append` per profileId. `apps/desktop/src/main/ipc/conversations.ts` — `conversations:list/get/save/delete/append` IPC. `apps/desktop/src/main/security/llm-key-vault.ts` — `'llm:anthropic:apiKey'` get/set in the existing vault. `apps/desktop/src/main/ipc/llm.ts` — `llm:hasKey / llm:setKey / llm:streamResponse` (the SSE bridge to the renderer; main is the LLM caller, the renderer subscribes to a per-request `IpcMessageChannel`). Renderer: `features/chat/` — `ChatView`, `ConversationList`, `Message`, `ToolCallEnvelope`, `MarkdownRenderer` (react-markdown + remark-gfm; the `components.code` interception for `language-chart` stubbed to fall through to a plain code block — wires up in C76). `useConversationStore` Zustand mirror (`ensureLoaded`/`upsert`/`appendMessage`/`rename`/`delete`/`select` + the stable `EMPTY` reference from `selectMessages`). Rail item ("Assistant", `MessageCircle` icon). Settings view section for the API key. New runtime deps: `react-markdown`, `remark-gfm`. **AC:** open Chat → empty state with the API-key prompt → set key → create a conversation → send a user message → mock provider streams a greeting; persists across restart.
- **C72 — `chore: bundle splitting — anthropic SDK + react-markdown into shared chunks`.** `apps/desktop/electron.vite.config.ts` `manualChunks: { recharts, anthropic: ['@anthropic-ai/sdk'], markdown: ['react-markdown','remark-gfm'] }`. Same pattern as the M4 recharts win. **AC:** the eager renderer bundle stays in the ≤620 kB neighbourhood; the new chat lazy chunk ≤30 kB after deps lift; lint + typecheck + e2e green.
- → **Check-in after Phase A:** chat works end-to-end against the **mock provider** for greetings and single-turn replies; conversation persistence verified across restart; bundle sizes recorded.

### Phase B — plugin contributions (C73–C74) — *no mandatory checkpoint*

- **C73 — `feat(plugin-api): systemPrompt + starterQuestions + diagnosticFlows contract`.** Extend `packages/plugin-api/src/index.ts` with the three optional methods + the `DiagnosticFlow` type. `apps/desktop/src/renderer/src/lib/plugin-prompts.ts` — `assemblePluginContributions(plugins, ctx) → { systemPrompt, starterQuestions, diagnosticFlows }`. Wire into `ConversationRunner` (system prompt assembly) + the chat empty state (starter chips + diagnostic-flow buttons) + the command palette (`Run diagnostic flow: <title>` entries). + a no-contribution mock-plugin test verifying the host doesn't crash when a plugin opts out. + the `Plugin.canHandleWrite?(op)` claim hook for the D5 cross-plugin edge case (M5 doesn't exercise it; landing it now keeps the contract complete). **AC:** the host gracefully handles plugins that contribute nothing, all three, or any subset.
- **C74 — `feat(niagara): system prompt + starter questions + rooftop diagnostic flow`.** `plugins/niagara/src/system-prompt.ts` — ~300 words explaining ORD format, knowledge layer semantics, kitFuzzy concept, BQL syntax wart, equipment-point role-mapping. `plugins/niagara/src/starter-questions.ts` — 4 chips. `plugins/niagara/src/diagnostic-flows.ts` — two flows: "Rooftop diagnosis" (the §A handover prompt) and "Knowledge layer summary". Plugin registration adds the three new methods. **AC:** open Chat on a Niagara connection → starter chips reflect the Niagara contributions; palette shows the diagnostic flows; the system prompt is verifiable via a debug-mode "Show assembled system prompt" Settings link.

### Phase C — safety boundary + chart-inline + the ReAct loop wired to real MCP tools (C75–C77) — *check-in after (the M5 deliverable)*

- **C75 — `feat(desktop): caller-attributed tool dispatch + AI-write safety boundary + tool-annotation-overrides migration to PluginManifest (main)`.** **Three coupled landings** (one commit because the safety boundary's correctness *depends on* the migrated registry — they cannot land separately without an M3-regression intermediate state):
  1. **`PluginManifest.toolAnnotationOverrides?: Record<string, Partial<ToolAnnotations>>`** — `pluginManifestSchema` gains the optional field. The Niagara plugin's existing override map (`plugins/niagara/src/tool-annotations.ts` → `NIAGARA_TOOL_ANNOTATION_OVERRIDES`) migrates from a static plugin-side export to the `toolAnnotationOverrides` declaration on its manifest in `plugins/niagara/src/index.ts`. The renderer-side M3 C50 `applyAnnotationOverrides` becomes a **thin consumer** of the same data via a new shared accessor (`pluginRegistry.getEffectiveAnnotations(connectionId, toolName)` — main side primary, renderer side via cached hydration on `connection:activated` or via a synchronous read from the loaded manifest registry which is mirrored to renderer at startup since it's static).
  2. **Caller attribution + safety predicate in main.** Thread `caller: 'human' | { type:'ai', conversationId, agentId? }` through the `tools:call` IPC + `ConnectionManager.callTool`. **Default to `'human'`** if omitted (back-compat for M1+M2+M3 paths). Main-side twin of `isWriteCall(effectiveAnnotations)` in `apps/desktop/src/main/agent/intercept.ts`, sourcing annotations from `pluginRegistry.getEffectiveAnnotations(connectionId, toolName)`. If `caller.type === 'ai'` AND `isWriteCall` → instead of dispatching to the MCP SDK, return `{ kind: 'pendingEnqueued', op: { name, args }, attribution: caller }`. The `tool-history-repository` audit-log entry gains the optional `actor?: 'human' | {type:'ai',conversationId}` field.
  3. **Renderer routing.** `useConversationStore` listens for `pendingEnqueued` outcomes; broadcasts `host.broadcast({type:'plugin:enqueue', op, attribution})`; the Niagara plugin's `pending-store.enqueue` adds the `source` field on each op; the Changes view badges AI-proposed ops with an "AI" chip + a deep-link back to the originating conversation.
  
  + ~15 unit tests (the manifest-resolved override merge; the interceptor; the audit field; the renderer-side bus subscriber). **AC:** (i) the existing M3 Tools-catalog destructive-confirm + badges still fire correctly on `createSpace` / `bulkCreateEquipment` / `importKnowledge` / the whole `walkthrough-write` family — proving no M3 regression as the override map migrates; (ii) the existing `tests/e2e/niagara-write.spec.ts` (M3 deliverable) passes unmodified; (iii) if the LLM (or the mock) proposes a write tool, the call is intercepted in main, never reaches the MCP server, and lands in the Niagara plugin's pending-changes queue with AI attribution; (iv) the Changes view shows it badged; (v) the operator can Apply (sends `caller:'human'` this time, which routes normally).
- **C76 — `feat(desktop): chat-inline chart rendering (chart code-fence + ChatChart)`.** `react-markdown`'s `components.code` interception: when `className === 'language-chart'`, parse body as JSON, validate with zod (`chartPayloadSchema`), render `<ChatChart>` → `<TimeSeriesChart>` from `@mcp-studio/charts` inside a fixed-aspect container. **JSON parse failure → fall through to the default code-block renderer** (the user sees the payload, not a broken chart). **Zod validation failure → same fall-through** with a small "invalid chart payload" tag above the code block. + parser unit tests (valid payload renders; malformed JSON falls through; oversized payload guard at 256 kB also falls through). + a "Show payload" toggle that swaps the rendered chart for the raw JSON for debugging. + the host base system prompt gains a `chart` code-fence usage example (composed by the host before plugin contributions). **AC:** the mock provider's rooftop program emits a `chart` code fence; the chat view renders a `TimeSeriesChart` inside the assistant message; the chart is keyboard-focusable for screen readers; a deliberately-malformed fence in a separate test program renders as a plain code block, not a stack trace.
- **C77 — `test(e2e): rooftop diagnosis + AI-proposed write + cancel — three chat specs`.** Three new Playwright specs against the **mock** LLM provider (`MCPSTUDIO_LLM_PROVIDER=mock`):
  - `tests/e2e/chat-rooftop.spec.ts` — open Chat → "Run rooftop diagnostic" from the palette → assert: 3 tool-call envelopes (`findEquipment` → `getActiveAlarms` → `readHistory`) collapse to summaries → a final assistant message with a chart-inline SVG renders → the History panel records 3 AI-attributed read calls. Screenshot: `m5-rooftop-diagnosis`.
  - `tests/e2e/chat-write.spec.ts` — user message → mock emits `setSlot` tool-use → main-side interceptor routes to pending-store → chat shows "queued for operator approval" → navigate to Changes view → 1 op badged "AI" → Apply → chat receives "applied" follow-up → audit log shows the write with `actor: {type:'ai',conversationId}`. Screenshot: `m5-ai-proposed-write-in-queue`.
  - `tests/e2e/chat-cancel.spec.ts` — start the mock's `'cancel'` program → click Stop mid-stream → assert the conversation captures `[stopped by user]`; subsequent user message resumes a fresh turn. Screenshot: `m5-chat-stopped`.
  - Empty-state screenshot: `m5-chat-empty-state`.
  - **AC:** e2e green ×8 (5 existing M1+M2+M3+M4 specs + 3 new M5 specs), flake-free.
- → **Check-in after Phase C — the M5 deliverable:** chat foundation + Niagara plugin contributions + write-tool safety interception + chart-inline rendering, all operator-usable end-to-end against the mock LLM provider; the existing M1+M2+M3+M4 surfaces unchanged.

### Phase D — token usage + polish + docs + tag (C78–C80) — *big check-in after*

- **C78 — `feat(desktop): token usage ledger per conversation + cost estimate`.** Accumulate `LlmEvent.usage` events into the conversation's `messages[i].usage`; conversation header shows running total input/output tokens; workspace-level "spent this session (estimate)" widget in the chat rail footer using hardcoded Anthropic per-model prices. + a configurable per-conversation soft cap (default 50k tokens, warning at 80%). + tests for the accumulator. **AC:** every assistant turn updates the counter; the warning fires at threshold; the estimate is labelled "approximate".
- **C79 — `feat(desktop): chat polish — markdown ord-card + keyboard shortcuts + regenerate`.** Custom `<ord>` markdown renderer (clickable ORDs in chat that open the Niagara Explorer at that path via `useExplorerStore.known`); Cmd+Enter sends the current input; ⌃R "regenerate last response" (drops the last assistant message + re-runs the last user turn); empty-state-to-chat keyboard flow tightened. **AC:** the rooftop e2e exercises one ord-card click; manual smoke for shortcuts. *(Folded into C77 if thin.)*
- **C80 — `chore: M5 docs + tag`.** This doc's "Adjustments during the M5 build" section; master-spec → an "M5 — AI co-pilot" section; `docs/m{1,2,3,4}-followups.md` → mark resolved items (the m4-followup `ctx.workspace.watches` plugin-api seam becomes a real `ctx.workspace.*` seam if C71 + C75 surface it; the m4-followup `useExplorerStore.known` cross-view primitive — M5 is its fourth consumer, fold the eviction policy decision in or punt to m5-followups); `docs/m5-followups.md` — the deferred items (multi-provider adapters; plan-and-execute; RAG tiers; flow-builder; multi-agent; per-conversation cost dashboard; recorded-playback test layer; richer starter prompts with ord autocomplete; interactive chat charts; conversation export to markdown; auto-summarise on context-cap; etc.); tag `v0.5.0-m5`. **AC:** docs reflect the shipped state; tag annotated.
- → **Big check-in after Phase D:** `git log --oneline` C69–C80 + screenshots (`m5-chat-empty-state`, `m5-rooftop-diagnosis`, `m5-chart-inline-rendering`, `m5-ai-proposed-write-in-queue`, `m5-chat-stopped`); coverage report; e2e green ×8; the tag `v0.5.0-m5`. Then M6 — plan-and-execute + RAG tier 1 enrichment + first plugin contributions deepening.

---

## Repo-layout deltas (vs. M4)

- **`packages/llm-provider/`** — new workspace package. `LlmProvider` interface; `LlmEvent` union; `runReAct(...)` loop; Anthropic Messages adapter; `FakeLlmProvider` test helper. Runtime dep: `@anthropic-ai/sdk`. Consumed only by `apps/desktop/main` (the LLM never streams in the renderer — keeps the API key in main).
- **`apps/desktop/src/main/agent/`** — new module. `intercept.ts` (the caller-attributed write-routing); `llm-runner.ts` (orchestrates `runReAct` against `ConnectionManager.callTool` with `caller:{type:'ai',...}`); `tool-call-bridge.ts` (the `llm:streamResponse` IPC channel renderer ↔ main).
- **`apps/desktop/src/main/security/llm-key-vault.ts`** — new. Workspace-level `'llm:anthropic:apiKey'` get/set via the existing safeStorage vault.
- **`apps/desktop/src/main/store/conversation-repository.ts`** — new. JSON, per-profileId, capped at 200 messages per conversation.
- **`apps/desktop/src/main/ipc/llm.ts`**, **`apps/desktop/src/main/ipc/conversations.ts`** — new IPC channels.
- **`apps/desktop/src/shared/domain/conversations.ts`** — new zod (`conversationSchema`, `messageSchema`, `contentBlockSchema`).
- **`apps/desktop/src/main/store/workspace-store.ts`** — `WORKSPACE_VERSION` 3 → 4 with one idempotent migrator step adding `conversations: {}` + `llm: { provider:'anthropic' }`.
- **`apps/desktop/src/shared/ipc/contract.ts`** — add `llm:*` + `conversations:*` channels + the `caller` arg on `tools:call`.
- **`apps/desktop/src/renderer/src/features/chat/`** — new feature folder. `ChatView`, `ConversationList`, `Message`, `ToolCallEnvelope`, `MarkdownRenderer`, `ChatChart`, `useConversationStore`.
- **`apps/desktop/src/renderer/src/features/settings/`** — new. Small Settings view with the AI section (API key entry + provider selector for forward-compat).
- **`apps/desktop/src/renderer/src/lib/plugin-prompts.ts`** — new. `assemblePluginContributions(plugins, ctx)` + the host base system prompt.
- **`packages/plugin-api/src/index.ts`** — gains `Plugin.systemPrompt?` / `starterQuestions?` / `diagnosticFlows?` / `canHandleWrite?`; gains the `DiagnosticFlow` type.
- **`plugins/niagara/src/system-prompt.ts`**, **`plugins/niagara/src/starter-questions.ts`**, **`plugins/niagara/src/diagnostic-flows.ts`** — new.
- **`apps/desktop/electron.vite.config.ts`** — adds two new `manualChunks` entries (`anthropic`, `markdown`).
- **`tests/fixtures/llm-mock/index.mjs`** — new. Programmatic mock LLM provider with the four canned programs.
- **`tests/e2e/chat-{rooftop,write,cancel}.spec.ts`** — new specs.
- **`apps/desktop/src/shared/domain/tool-history.ts`** — gains optional `actor?: 'human' | {type:'ai',conversationId}`.
- No new runtime deps beyond `@anthropic-ai/sdk` + `react-markdown` + `remark-gfm` (+ `highlight.js` lazy inside the chat chunk if syntax highlighting lands; review at C71 time).

## Adjustments during the M5 build

What actually changed vs. the plan above (so the doc reflects the shipped state
without spelunking commit messages). Full deferred-items list: [`docs/m5-followups.md`](m5-followups.md).

**Phase A (C70–C72) — provider + chat foundation.** Landed as planned.
- C70 — `@mcp-studio/llm-provider` shipped with `LlmProvider` / `LlmEvent` /
  `AnthropicStreamMapper` / `runReAct` / `FakeLlmProvider` / `MockLlmProvider`.
  26 unit tests against four JSONL stream fixtures (one canonical interleaved
  text+tool_use from Anthropic's public docs verbatim; one text-only verbatim;
  two synthesised edge cases — tool-only + multi-tool). Real-capture is a
  file swap via `scripts/capture-fixture.mjs` when an `ANTHROPIC_API_KEY` is
  in env.
- C71 — chat foundation. The host-base system prompt + the four canned
  mock programs landed here so the chat is exerciseable without an API
  key from day one.
- **C71 D4 deviation — API key reaches the renderer via `llm:getKey` IPC.**
  Originally aspirational ("key never leaves main"); shipped as renderer-
  side per the M5 D1 ESM-only Anthropic SDK + Electron-33 CJS main
  decision. Compensating control: the key is fetched on-demand into the
  chat-runner closure for the lifetime of one ReAct iteration; no long-
  lived renderer state holding the key. Tracked in `m5-followups.md`;
  the IPC stays as the canonical setter / hint accessor when M6+ moves
  the provider into main.
- C72 — Markdown chunk landed bigger than projected (372 kB vs the
  ~80 kB estimate; remark-gfm pulls a fair micromark stack). Caches
  after the first chat open. Three optimisation paths documented in
  m5-followups; not preemptive.

**Phase B (C73–C74) — plugin contributions.** Landed as planned.
- C73 — the four-hook contract (`systemPrompt` / `starterQuestions` /
  `diagnosticFlows` / `canHandleWrite`) + the `DiagnosticFlow` shape.
  `assemblePluginContributions(plugins, ctx)` single resolution point.
  Defensive against throwing plugins.
- C74 — the Niagara plugin's three contributions covered every checklist
  item from promt13 (ORD format / knowledge layer / kitFuzzy / BQL wart /
  Russian-locale booleans / write-safety / annotation-override
  transparency). Two flows shipped: rooftop-diagnosis (the §A walk) +
  knowledge-summary.

**Phase C (C75–C77) — the M5 deliverable.**
- **C75 — three coupled landings in one commit** (per promt11): manifest-
  schema migration of `toolAnnotationOverrides` → main-side annotation
  registry → caller-attributed `ConnectionManager.callTool` interception.
  `@mcp-studio/niagara` gained a `./manifest` subpath export so main can
  import pure-data manifests without dragging in React; both
  `@mcp-studio/niagara` and `@mcp-studio/plugin-api` joined the
  `externalizeDepsPlugin` exclude list (same treatment as
  `@mcp-studio/mcp-client` — bundled into main's CJS image). The
  ToolCallOutcome shape gained `pendingEnqueued`; ToolHistoryEntry
  gained `actor` + a new `status: 'queued'`. **The M3
  niagara-write e2e passed unmodified — the C75 regression check held.**
- **Post-C75 docs-only commit — `docs: post-M5 roadmap`** — slotted at
  the C75/C76 boundary per promt14's "natural Phase C boundary"
  guidance. Doesn't interrupt mid-commit work. `docs/roadmap.md` carries
  the M6 → M7 → M8 → later shape.
- C76 — chart code-fence interception. `parseChartPayload` extracted
  into a pure `.ts` module (`chart-payload.ts`) so vitest can test it
  without dragging the renderer-side `@renderer/...` alias resolution.
  Defensive against ISO + epoch-ms timestamps; sorts out-of-order points
  + downsamples to ≤500. **JSON-parse failure falls through to a plain
  code block** — preserves the LLM's ability to *document* the chart
  syntax with a deliberately-invalid example. Schema / oversize failures
  surface as a warning chip with the payload underneath.
- C77 — the three chat e2e specs (rooftop / write / cancel). Three
  strict-mode locator collisions surfaced during the writing pass +
  fixed: "MOCK PROVIDER" in two spots (chip + hint); tool names in two
  spots (streaming Card + persisted Envelope); "queued for operator
  approval" inside the envelope's collapsed tool_result (the canonical
  signal is the LLM's follow-up assistant text). The `MockProgram` shape
  widened to `MockEvent[] = LlmEvent | MockDelay` so the cancel program
  can pace its text-deltas with `__delay` sentinels (filtered out before
  yielding, honours `signal.aborted` for clean abort propagation).

**Phase D (C78–C80) — token usage + polish + docs + tag.**
- C78 — token usage ledger. Versioned pricing table
  (`ANTHROPIC_PRICES_AS_OF` = `'2026-05-14'`) per promt15. UI marks the
  cost estimate "approximate, prices as of …" in the tooltip; warning
  chip at 80 % of the 50k soft cap; over-cap is destructive-styled but
  still soft (sending isn't blocked). Captured the `message-stop`
  event's cumulative usage onto the persisted `Message.usage` field via
  the runner-event loop in ChatView. +19 unit tests.
- C79 — chat polish per promt15:
  - **`<ord>X</ord>` markdown extension.** Pre-rewrites the tags as
    markdown links with the `mcp-studio-ord:<base64>` custom protocol;
    `components.a` decodes + renders a clickable chip; click publishes
    to the new host bus. AppShell switches to the niagara plugin's
    Explorer view; the niagara ExplorerView consumes the ord and calls
    `reveal()` + `select()` + `ctx.setCwd()`. The shared pub/sub
    primitive (`useHostBus`) landed in `@mcp-studio/plugin-api` — lives
    there so plugins subscribe via a stable workspace import (pnpm-
    hoist gives both sides the same Zustand instance). plugin-api
    gains `zustand` as a dep — small price for a stable cross-plugin
    seam. Future M6+ channels (flow-builder / RAG refs / cross-plugin
    intents) ride the same store shape.
  - **Keyboard shortcuts.** Ctrl+Enter send / Esc stop / Ctrl+Shift+N
    new conv / Ctrl+/ focus input. Mounted at chat-view scope so they
    detach on view switch. Required `<Input>` (`@mcp-studio/ui`) to
    forward refs — added.
  - **Regenerate.** Truncate the conversation back to before the last
    user message, re-send. Button in the chat header next to the
    UsageBadge, only when there's ≥1 assistant turn.
- C80 — this section + the master-spec M5 section + `m5-followups.md` +
  the tag `v0.5.0-m5`. CONTRIBUTING.md gains the e2e assertion
  discipline rule per the C77 strict-mode lessons + the m5-followups
  entry tracking the `react-hooks/exhaustive-deps` sweep as a separate
  future chore.

**Numbering — Phase D ran three commits (C78 + C79 + C80) as planned;
the polish items (C79) stayed a separate commit per promt15's "C79 chat
polish — separate commit, NOT folded into C77" guidance so the Phase C
deliverable boundary in the git log stays clean.**

## Ad-hoc check-in triggers (otherwise: note-and-continue)

1. **Anthropic SSE event-shape variant the adapter doesn't parse.** A live Messages-API stream emits a `content_block_delta` variant the adapter coerces incorrectly → record + reshape the adapter + add a fixture. Same defensive-parser pattern as M4's `readHistory` wrapper.
2. **The safety-boundary write-routing surfaces a category the M3 `isWriteCall` predicate doesn't classify correctly.** E.g. a tool with `readOnlyHint: undefined` AND `destructiveHint: undefined` is currently treated as a write (defensive); an AI flow that needs to call something the operator considers read-only would block. Reconsider: add an explicit allow-list per plugin (`Plugin.allowAiUnattended?: string[]`) or tighten the predicate.
3. **The `chart` code fence collides with the same-language fall-through** — the `components.code` interception runs on *every* code block; a non-chart code block with `language-chart` in it (e.g. a literal example in the LLM's explanation) shouldn't fall through into a real chart render. One-spot fix in the interception (the system prompt instructs the LLM to escape literal examples; the parser's "fall through on parse failure" is the safety net).
4. **The conversation message cap (200) bites mid-build** — a real diagnostic walk needs 30+ tool turns and the head-trim breaks coherence → ad-hoc to either raise the cap or to ship the auto-summarisation knob early.
5. **The bundle-split chunks misalign** — `@anthropic-ai/sdk` pulls in transient deps that grow the eager renderer (e.g. a polyfill that gets re-eagered) → revisit the manualChunks granularity.
6. **The mock LLM provider's program-match-by-substring is too brittle** — diagnostic flow prompts share words; the mock picks the wrong program → switch to exact-prompt match keyed by the diagnosticFlow's `id`.
7. **Anthropic's tool-use shape doesn't map 1:1 to MCP's `tools/call`** — input-validation differences, optional-arg semantics → record + add a small adapter in `dispatchTool`.

### M5-specific watch items (per promt11 nuance acceptance)

- **Anthropic SDK streaming API shape (interleaved text + tool_use).** The Messages SSE stream interleaves `text_delta` and `tool_use_input_delta` blocks within a single assistant turn (a tool call can appear mid-sentence in the assistant's text). The `LlmEvent` union must handle "tool_use starts before the current text block closes" cleanly; the chat UI must render text-up-to-tool-use as a partial completed message, then the tool-call envelope, then the continuation. Capture a real interleaved-shape fixture early in C70 to lock the adapter's handling.
- **Annotation-override migration coupling surprises.** C75 lands three coupled changes (manifest schema + main-side registry + renderer-side accessor refactor). A type-system surprise or an unexpected M3 destructive-confirm path that consults the renderer-side `applyAnnotationOverrides` differently could surface mid-build. Run the M3 niagara-write e2e in CI for **every** C75-intermediate commit (split if natural) to catch a regression the unit tests miss.
- **`AbortSignal` mid-tool-call race conditions.** The Stop button aborts the LLM stream + the in-flight MCP tool call. Race: the LLM stream emits a `tool_use_complete` event while the abort propagates; the runner must not double-dispatch the tool. The runner's state machine handles `aborted` as a terminal state immediately; in-flight tool-call promises check `signal.aborted` before resolving back into the loop.
- **Markdown render perf on long conversations.** A 50-turn conversation with 20 tool-call envelopes + several chart-inline renders + code-block syntax highlighting could push the renderer past frame budget on a scroll. `react-markdown`'s memo strategy + a windowed message list (`react-window` or hand-rolled) is the fallback; flag as ad-hoc if frame drops surface.

## Check-in points

- **After Phase A** (C72): chat foundation + provider + persistence + bundle splits land; the rest of the app behaves identically. (Structural milestone — gives M5 a chat surface to build on, mock-driven for now.)
- **After Phase C** (C77): chat + Niagara contributions + the AI-write safety boundary + chart-inline rendering all operator-usable end-to-end. (The M5 deliverable.)
- **Big check-in after Phase D** (C80): `git log --oneline` C69–C80 + new screenshots; coverage report; e2e green ×8; the tag `v0.5.0-m5`. Then M6 — plan-and-execute + RAG tier 1 enrichment (and the `ctx.openView` / `ctx.updateAuthSecret` / `ctx.reconnect` plugin-api seams from m2/m3-followups if the chat view surfaces a third caller).
