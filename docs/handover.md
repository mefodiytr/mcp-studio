# MCP Studio — Context & Forward Vision

A handover document. Two parts: where the project is today, and where the AI co-pilot direction would take it next. For a developer (or future-self) picking this up cold.

---

## Part 1 — Current state

### What MCP Studio is

A universal Model Context Protocol desktop client with a plugin host architecture. Electron + React + TypeScript on a pnpm monorepo. Connects to any spec-compliant MCP server over HTTP or stdio with Bearer / custom-header / OAuth 2.1+PKCE auth. The first specialized plugin is a Niagara station browser; the architecture is built to support more.

Status: **M3 (write workflow) shipping**. Latest tagged release `v0.2.0-m2`.

### Repo layout

```
mcp-studio/
├── apps/desktop/                # the Electron app
│   ├── src/main/                # ConnectionManager, vault, IPC handlers
│   ├── src/preload/             # contextBridge
│   ├── src/renderer/            # React UI, features/, app/, lib/, stores/
│   └── src/shared/              # IPC contracts + zod validators
├── packages/
│   ├── mcp-client/              # @modelcontextprotocol/sdk wrapper, transports, OAuth provider
│   ├── schema-form/             # JSON Schema → react-hook-form + zod
│   ├── plugin-api/              # plugin contract: Plugin, PluginContext, PluginView, PluginCommand
│   └── ui/                      # vendored shadcn shared across host + plugins
├── plugins/
│   └── niagara/                 # in-box Niagara plugin (read + write)
├── tests/
│   ├── e2e/                     # Playwright specs (stdio reference / OAuth / niagara-plugin)
│   └── fixtures/                # reference-server, niagara-mock, recorded tool surfaces
└── docs/                        # master-spec, milestone-{1,1.5,2,3}.md, followups
```

### Architecture in one slide

- **Main process** is the source of truth: connection lifecycle, credentials (safeStorage-backed vault), IPC handlers, ConnectionManager with PID tracking and orphan reaper for stdio children.
- **Renderer** is React + plugin contributions. State split: React Query for server-state (tools, resources, prompts — cached per connection), Zustand for UI-state (tabs, layout, selection, pending-changes queues).
- **Plugins** are renderer-side React contributions registered in a static `IN_BOX_PLUGINS` array, activated on `serverInfo.name` regex match. Currently one plugin: `@mcp-studio/niagara`.
- **Transports**: HTTP (Streamable + SSE fallback) and stdio (child_process). OAuth 2.1+PKCE via @modelcontextprotocol/sdk's auth orchestrator; loopback redirect listener on 127.0.0.1 ephemeral port.
- **SDK boundary**: we wrap `@modelcontextprotocol/sdk` in `packages/mcp-client`; we do not reimplement JSON-RPC, discovery, PKCE, DCR, or token exchange. The SDK does that work.

### Milestones

| Milestone | Tag | Scope |
|---|---|---|
| M1 | `v0.1.0-m1` | Universal MCP client foundation. Tools/Resources/Prompts UI via SchemaForm. Protocol inspector (ring-buffer event tap). Command palette (cmdk). Multi-tab workspace (Zustand). Tool call history with argument templating + raw JSON-RPC console. Playwright e2e against `@modelcontextprotocol/server-everything`. |
| M1.5 | `v0.1.5-m1.5` | OAuth 2.1 + PKCE. SDK handles discovery (.well-known/oauth-protected-resource → oauth-authorization-server), PKCE, code exchange, refresh, DCR. We wrote the `OAuthClientProvider`, loopback redirect listener, wizard UI, and `signing-in`/`auth-required` connection states. |
| M2 | `v0.2.0-m2` | Plugin architecture + read-only Niagara explorer. `packages/plugin-api`, `packages/ui` extraction, command-contribution registry, `{{cwd}}` templating token. Niagara views: tree explorer + breadcrumbs, property sheet, quick-nav (Ctrl+P fuzzy), folder view, BQL playground (CodeMirror 6). In-process niagara-mock fixture for e2e. |
| M3 | →`v0.3.0-m3` | Write workflow + safety. Per-connection pending-changes queue (Zustand, session-only, never persisted). Diff-and-approve view with per-op Reversible / ⚠ Irreversible badges. Apply runs ops sequentially + `commitStation` at end; partial-failure semantics surfaced explicitly. Tool annotation overrides at `Plugin.toolAnnotationOverrides` (fixes niagaramcp's mis-flagged walkthrough-write family). Audit trail with `write` flag on `toolHistoryEntry`. Property-sheet inline edit for BSimple slots. Tree context menu (New child / Remove with dryRun preview / Add extension / Link slots). Bearer bootstrap with feature-detected provisioning mode (`provisionMcpUser` → `rotateMcpToken` → `setupTestUser` fallback). |
| M4 | planned | History viewer with charting. `readHistory` has been a generic-catalog tool since M1; M4 builds the time-series view. |
| M5+ | planned | AI co-pilot. See Part 2. |
| M6+ | planned | Visual flow builder (agent blocks). |
| M7+ | planned | Multi-agent orchestration, RAG over unstructured documents. |
| M8+ | planned | Code signing + notarization, custom icons, marketplace foundations. |

### Working ritual

The project has been built in a consistent pattern, documented in `CONTRIBUTING.md`:

1. **Recon** — read the real APIs (no guessing), document findings.
2. **Atomic-commit plan** — break the milestone into N commits, each independently buildable + testable + green. Conventional prefixes (`feat`/`fix`/`chore`/`docs`/`test`/`perf`/`refactor`). Co-Authored-By trailers for AI-assisted work.
3. **Decisions-needed list** — surface architectural choices upfront, get them resolved before any code.
4. **Phase-boundary check-ins** — pause at logical milestones, present `git log --oneline` + screenshots + coverage + deviation list.
5. **Ad-hoc check-ins** — only when an architectural contradiction surfaces mid-flight, not for edge cases.
6. **Deviations** — flagged explicitly in commit messages + master-spec §14 "Adjustments during the M{N} build". Never silent.
7. **Coverage as ratchet** — floor at current actuals minus ~5 points headroom; raised at each milestone close. Tracked per package.

### niagaramcp counterpart

Separate repo. The Niagara N4 / BCControl MCS 4.8 module exposing MCP server via `BMcpPlatformService`.

- HTTP endpoint at the station's web port: `http://<host>:<port>/niagaramcp/mcp` (path follows Niagara's module-mount convention).
- Streamable HTTP + legacy SSE fallback (`/niagaramcp/sse` + `/niagaramcp/messages`). Health probe at `/niagaramcp/health` (no auth).
- **46 tools** across categories: `transport-test`, `read`, `walkthrough-read`, `walkthrough-write`, `management`, `search`, `history`, `alarms`, `diagnostic`, `write`. Full surface captured in `tests/fixtures/niagara-mock/tools-list.json`.
- **Auth**: Bearer with `apiToken` (service identity, all reads + some metadata) OR user-Bearer hashed against an `mcp:tokenHash` Tag on a `BUser` for writes. `UserContextGateway` resolves Bearer→BUser; writes execute under the user's Niagara permissions.
- **Knowledge layer**: structured semantic model with `spaces` / `equipment_types` / `equipment` / `standalone_points`. Equipment has `points: { role: ord }` mapping (e.g. `supply_air_temp` → `slot:/Drivers/AHU1/SAT`). Queryable via `findEquipment` / `findInSpace` / `findPoints`. Validation + export/import tools.
- **kitFuzzy module**: fuzzy logic components on the station (17+ components: membership functions, fuzzifiers, rule engines, defuzzifiers). Their outputs surface as standard slot values via `getSlots` / `readPoint` — no special exposure needed.

### Cross-repo coordination items (niagaramcp side, tracked in MCP Studio's followups)

None blocking MCP Studio progress, but improve UX:

1. **Wrong annotations on walkthrough-write tools + `importKnowledge`** — niagaramcp ships `readOnlyHint: true` on tools that mutate state. MCP Studio works around with `Plugin.toolAnnotationOverrides` (M3 C49-C50), but server-side fix is cleaner. Affects: `createSpace`, `updateSpace`, `createEquipmentType`, `updateEquipmentType`, `createEquipment`, `updateEquipment`, `bulkCreateEquipment`, `assignPointToEquipment`, `createStandalonePoint`, `importKnowledge`.
2. **Slot value localization** — `getSlots` returns Niagara's `toString()` which is locale-dependent (`"поистине"` instead of canonical `true` on Russian-locale stations). Should return canonical/locale-independent representations.
3. **`bqlQuery` input format hostile** — query string must be a full ORD with BQL part (`station:|slot:/|bql:select ...`), `LIMIT N` in query string fails silently (limit is a separate arg). Either accept plain SELECT and prepend prefix, or take `{baseOrd, query}` as separate args.
4. **Enum slot ordinals not exposed in `getSlots`** — current return is the display string. Adding the ordinal alongside unblocks enum-slot editing in MCP Studio's property sheet (currently read-only for enums).
5. **Production-mode user-Bearer provisioning** — `setupTestUser` is gated by `BMcpPlatformService.enableTestSetup`. For production stations, niagaramcp should ship `provisionMcpUser` (non-test bind) and `rotateMcpToken` (rotation). MCP Studio's Bearer bootstrap (M3 C57) already feature-detects these and adapts UI accordingly — no client-side change needed when they land.
6. **`getTrendAnalysis` / `getFuzzyAssessment` / `getDiagnosticContext`** — forward-looking tools that unlock AI co-pilot scenarios (Part 2 §6).

### Pending housekeeping

- **Packaging CI matrix verification** — `.github/workflows/package.yml` triggers on `v*` tag push, builds NSIS (Win) + dmg (Mac) + AppImage (Linux) unsigned. Was local-only repo until recently; first push to GitHub triggered the matrix. Confirm green status across all three OSes for `v0.1.0-m1`, `v0.1.5-m1.5`, `v0.2.0-m2`. Red leg → `m1-hotfix` branch + retag.
- **Screenshot regeneration** — M2 README screenshots placeholder; Playwright e2e already drives the explorer + property sheet + BQL playground flows. Add `page.screenshot()` calls at key states, commit PNGs to `docs/screenshots/`, embed in README. Tracked as standalone follow-up commit.

---

## Part 2 — AI co-pilot direction

### The idea in one paragraph

MCP Studio already brokers connections to MCP servers, catalogs their tools, and renders their JSON-Schema inputs. An LLM speaks the same tool-calling language. Composing them gives a chat-based assistant that can reason about a connected system in natural language, gathering context via the same tool calls the operator uses manually. For a Niagara station this means: ask "what's wrong with rooftop unit 5 in the north building?" and the agent does `findEquipment` + `inspectComponent` + `readHistory` + `getActiveAlarms` + reads from the knowledge layer + integrates kitFuzzy assessment outputs already exposed as point values, then summarizes with citations to the data pulled. Writes proposed by the LLM route through the M3 pending-changes queue — the operator approves, the LLM never commits directly.

### Why MCP Studio is the natural home

- **Connection brokering, auth, IPC isolation, audit trail** — already built (M1 + M1.5 + M3 audit).
- **Tool catalog + schema rendering** — LLM tool selection mirrors what the operator sees in the catalog; same overrides apply.
- **Plugin-api** — Niagara plugin can contribute system prompts, starter questions, canned diagnostic flows; future plugins do the same for their domains.
- **M3 pending-changes queue** — natural safety boundary for AI-proposed writes: LLM proposes → queue → operator approves → apply. Already audit-attributed.
- **Audit log already has write attribution (M3 C51)** — extends naturally to "actor = AI agent name + conversation ID".

The alternative — a separate chat app that calls MCP via its own client — reinvents all this and loses cross-feature continuity (linking a chat to a tool history entry, opening a referenced ORD in Explorer, proposing a write into the pending queue, etc.).

### Three concrete scenarios

#### A — Rooftop diagnosis (multi-step agent flow)

User: "What's wrong with rooftop unit 5 in the north building?"

Agent walk:
1. `findEquipment(query: "rooftop 5 north")` → resolves equipment ID + root ord
2. `inspectComponent(equipment.ord)` → component identity, child count
3. `getActiveAlarms(sourceOrdPrefix: equipment.ord)` → currently-open alarms
4. **Branch on alarms**: present → root-cause path; absent → trend-only path
5. `readHistory(supply_air_temp.ord, from: 24h ago, aggregation: avg)` → trend data
6. Read kitFuzzy assessment slots (fuzzy controller outputs exposed as standard point values via `getSlots` / `readPoint`)
7. (Future tool) `getTrendAnalysis(...)` for statistical anomaly detection — saves the LLM doing math on large arrays
8. LLM synthesizes diagnostic summary citing specific data pulled, with confidence calibrated to data completeness

#### B — Natural-language BQL translation

User: "Show me all writable points in Drivers that haven't been written to in the last week."

Agent walk:
1. LLM translates intent → BQL query
2. `bqlQuery({query: "station:|slot:/Drivers|bql:select displayName, ord from control:Writable", limit: 100})`
3. For each result, `readHistory(ord, from: 7d ago, limit: 1)` checks last write timestamp
4. LLM filters + presents the list

The BQL syntax wart (ord+bql prefix, separate limit arg) is surfaced in the system prompt once. The LLM learns the niagaramcp-specific shape.

#### C — Proposed write (safety pattern)

User: "Raise the setpoint on AHU-2 by 2 degrees."

Agent walk:
1. `findEquipment(query: "AHU-2")` → equipment + its `setpoint` role mapping
2. `readPoint(setpoint.ord)` → current value, say 21.0°C
3. LLM composes: `setSlot(ord: setpoint.ord, slotName: "out", value: 23.0)` (or the appropriate control-point write)
4. **Instead of executing**, the agent enqueues into the M3 pending-changes queue with attribution = "AI agent (chat session #N)"
5. Operator sees the proposed change in the Changes view: Reversible badge, source attribution, before/after value side-by-side
6. Operator clicks Apply or rejects

**This safety pattern is non-negotiable.** The LLM is read+propose; the operator is approve+commit. The LLM cannot bypass this.

### Architectural options surveyed

Agent loop patterns. No preference locked in until milestone-planning time, but each has a clear fit:

- **Single-shot tool use** — one LLM turn, all tools picked at once, executed, summarized. Simplest, brittle for multi-step questions where one tool's result determines the next.
- **ReAct loop** — Reasoning + Acting interleaved. LLM picks one tool → sees result → reasons → picks next or finishes. Bounded N turns. Most natural for exploratory diagnostic questions. **Recommended for v1.**
- **Plan-and-execute** — first turn generates a plan (tool-call sequence + branch logic), subsequent turns execute, possibly revise. Better for predictable diagnostic flows the operator runs repeatedly. Layered in after ReAct is solid.
- **Multi-agent orchestration** — main agent dispatches to specialist agents (knowledge agent, math agent, summarizer), each an LLM call with a focused role. Overkill for v1; future direction once domain expertise demands it.
- **Visual flow builder ("agent blocks")** — user composes flows from nodes (trigger / condition / tool-call / LLM-step / aggregator / output) like a Niagara wire-sheet for AI workflows. Power-user feature; saved flows, scheduled execution. Separate milestone.

### Integration points with existing work

- **LLM provider abstraction** — new package `packages/llm-provider`, analogous in shape to `packages/mcp-client`. Adapters: Anthropic Messages API (primary — Claude has the most natural ergonomics for MCP-shaped tool use), OpenAI Chat Completions, local Ollama. User configures provider + API key per profile or workspace; key stored in the existing safeStorage vault same as Bearer secrets.

- **Tool exposure** — every MCP tool on the connection is auto-mapped to LLM tool-function shape; `inputSchema` translates to LLM function parameters. `tools/list` queried at chat-session start. Plugin-contributed annotation overrides (M3 C49-C50) apply transparently — the LLM sees corrected `destructiveHint` / `readOnlyHint` annotations.

- **Chat view** — new rail item "Assistant"; per-connection scope (each connection = its own conversation context, mirroring the per-connection pending-changes queue from M3). Messages stream; tool-call envelopes inline with raw JSON-RPC toggle (consistent with the existing M1 ToolInvocationDialog and Protocol Inspector).

- **Plugin contributions** — extend the `Plugin` contract:
  - `Plugin.systemPrompt?(ctx): string` — appended to the system prompt. Niagara: ORD format explanation, knowledge layer hint, kitFuzzy concept introduction, BQL syntax wart, equipment-point semantics.
  - `Plugin.starterQuestions?(ctx): string[]` — chips in the empty conversation state.
  - `Plugin.diagnosticFlows?(ctx): DiagnosticFlow[]` — canned multi-step flows surfaceable as palette commands and quick-actions ("Run rooftop diagnostic", "Equipment health overview").

- **Audit composition with M3** — every LLM-initiated tool call writes a history entry with `actor = "AI agent"` + conversation ID. Writes still get the `write` flag; the existing "Writes only" filter naturally includes AI-proposed writes. Future filter "AI-initiated" easy to add.

- **Write workflow composition with M3** — LLM never invokes write tools directly. Write-tool calls returned by the LLM are intercepted at the `ConnectionManager.callTool` layer (or one layer up, in a new agent-call dispatcher) and enqueued in the pending-changes queue. This is the architectural invariant.

- **Command palette integration** — `Ask AI about <selected component>`, `Run diagnostic flow <X>`, `Open chat for <connection>` — palette commands contributed by the AI feature and by plugins.

### Knowledge / RAG

Two-tier:

- **Tier 1 — structured knowledge already in the server.** niagaramcp's knowledge layer (`findEquipment` / `findInSpace` / `findPoints` / `validateKnowledge` / `getKnowledgeSummary` / `exportKnowledge`) is itself a queryable knowledge base. AI uses it via tool calls, no embedding store required. Sufficient for "what equipment is in this space" / "what's the semantic role of this point" / "show me equipment of type X."

- **Tier 2 — unstructured documents** (deferred). Vector store + embedding pipeline for user-uploaded manuals, station notes, historical incident reports. Probably `packages/rag` with a local vector store (sqlite-vec or similar, in-process, no external dependencies). Not first iteration.

### Cross-product dependencies on niagaramcp (forward-looking)

Tools that don't exist yet but would unlock subsequent AI scenarios:

- **`getTrendAnalysis(ord, from, to, type: 'linear'|'anomaly'|'pattern')`** — server-side statistical analysis on history time-series. Without it the LLM does math on raw `readHistory` arrays (wasteful: large payloads, weak math, token cost).

- **`getFuzzyAssessment(equipmentId)` / `getKitFuzzyOutputs(ord)`** — bulk read of all kitFuzzy module outputs for an equipment's points. Reduces round-trips and lets niagaramcp curate "what fuzzy signals matter for this equipment type."

- **`getDiagnosticContext(equipmentId)`** — pre-baked combination of "what an operator would look at first for this equipment type": recent alarms + current point values + recent history summaries + fuzzy scores + knowledge metadata, in one call. High-leverage diagnostic primitive; would significantly compress agent loops.

- (Optional) **`saveConversation` / `loadConversation`** — if multi-session conversations should persist server-side for shareability across MCP Studio instances. Local-only persistence in MCP Studio is sufficient otherwise; defer.

These are forward-looking, not blockers. AI v1 ships against the current niagaramcp tool surface; these tools unlock subsequent scenarios and reduce token cost on the LLM side.

### Open questions deferred to milestone-planning time

- **LLM provider default** — Anthropic Claude (most natural for MCP-shaped tool use) vs multi-provider from day one?
- **Agentic loop default** — ReAct vs plan-and-execute as v1?
- **Conversation scope** — per connection (recommended), per workspace, per tab?
- **LLM API key management** — per-profile in vault, or global workspace-level?
- **Token budgets** — how does MCP Studio surface usage ("you've spent $X today on Claude")?
- **Streaming vs batched rendering** of LLM responses?
- **Tool-call cancellation** — agent in long loop, user clicks Stop, what happens to in-flight tool calls (the underlying MCP request can't always be cancelled cleanly)?
- **Block-builder UI** — when does it land, what's the visual model (Niagara wire-sheet style? n8n node-based? Linear like Zapier?)?
- **RAG vector store choice** (when we get there) — sqlite-vec? LanceDB? In-memory only?
- **Safety boundary enforcement** — architectural pattern: interceptor at `ConnectionManager.callTool` that routes write tools from AI-attributed callers to the pending-changes queue instead of executing. Worth a small dedicated design pass before any AI write-tool wiring.

### Phased delivery sketch

Not a commitment — a sketch for ordering reasoning:

| Phase | Scope |
|---|---|
| M5 / M6 — chat foundation | ReAct loop, Anthropic provider, per-connection scope, plugin-contributed system prompts + starter questions, tool-call envelopes inline, audit composition with M3, write-tool interception → pending queue. |
| M6 / M7 — diagnostic flows + RAG tier 1 | Plan-and-execute layered in for repeatable flows. `Plugin.diagnosticFlows` surface. Knowledge layer enrichment in system prompt. |
| M7 / M8 — RAG tier 2 + multi-provider | `packages/rag` with local vector store, document upload. OpenAI / Ollama adapters. |
| M8 / M9 — flow builder | Visual block editor for power-user agent workflows. Saved flows, scheduled execution, run history. |
| Later — multi-agent | Specialist agents (knowledge, math, summarizer), routing, shared scratchpad. |

### For a developer reading this cold

**Where to start:**
1. Read `docs/master-spec.md` §1-3 for product context.
2. Read `docs/milestone-1.md` → `milestone-1.5.md` → `milestone-2.md` → `milestone-3.md` to understand the build trajectory.
3. Read this doc for the forward direction.
4. Skim `tests/fixtures/niagara-mock/tools-list.json` to understand the concrete tool surface AI will operate against.

**Where the seams are for adding AI:**
- Chat view: new feature folder at `apps/desktop/src/renderer/features/assistant/`.
- Rail extension: `apps/desktop/src/renderer/app/AppShell.tsx`.
- Plugin contract extensions: `packages/plugin-api/src/index.ts` (add `systemPrompt`, `starterQuestions`, `diagnosticFlows`).
- LLM provider: new `packages/llm-provider/` package, shape analogous to `packages/mcp-client/`.
- Safety boundary: write-tool interception at `apps/desktop/src/main/ConnectionManager.callTool` — when caller attribution = AI agent AND tool's effective annotations (post-overrides) include `destructiveHint`, route to pending-store instead of executing. Build this BEFORE wiring write tools into the LLM's available function set.

**Recommended v1 implementation order:**
1. `packages/llm-provider` with Anthropic Messages API + tool use adapter — standalone, unit-testable, can be exercised with a CLI before any UI.
2. Bare chat view against a single connection, no persistence, ReAct loop.
3. Plugin contract extension (`systemPrompt`, `starterQuestions`) + Niagara plugin contributions.
4. Conversation persistence (per-connection, in workspace JsonStore alongside profiles).
5. Tool-call envelope inline rendering, raw JSON-RPC toggle.
6. Audit composition with M3 (every LLM tool call → history entry with `actor: 'ai'` + conversation ID).
7. Safety boundary: write-tool interceptor at `ConnectionManager.callTool` — implement and unit-test BEFORE step 8.
8. Wire write tools into the LLM's available function set (now safe — writes route to pending queue).
9. `diagnosticFlows` plugin contribution + palette integration.
10. Polish + e2e against a mock LLM provider in `tests/fixtures/llm-mock/` (returns deterministic tool-call sequences for assertion).

Build in that order so each commit is independently safe — never have a moment where the LLM could call a write tool directly.

---

*End of handover. Last updated at M3 in progress / v0.2.0-m2 tagged. Update this doc whenever a milestone closes or the AI direction's open questions resolve.*
