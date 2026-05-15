# Milestone 7 — RAG tier 2 + multi-provider

> Two parallel surfaces, both bolt-ons over the M5 abstraction. **RAG tier 2**
> brings unstructured-document retrieval (manuals, runbooks, incident reports)
> via a local vector store + chunking + embedding pipeline; the top-K
> retrieval pass injects relevant chunks into the system prompt at chat-turn
> time. **Multi-provider** lets the operator pick OpenAI or Ollama alongside
> Anthropic via the M5 `LlmProvider` interface; the ReAct + plan-and-execute
> runners don't change. Per-profile API key override closes the M5 D4 carry-
> over for the MSP / multi-customer-billing case. The M6 knowledge-layer
> enrichment (tier 1, structured queries against `getKnowledgeSummary`)
> coexists cleanly with the new tier 2 path — the system prompt now carries
> *both* the structured inventory section (M6) AND the top-K document chunks
> (M7); the LLM sees them as separate context blocks.

**Target:** `v0.7.0-m7` · ~3–4 weeks · commits C90 → C99, four phases, check-ins at phase boundaries (after A, after B, after C — the M7 deliverable; big one after D). The plan + acceptance criteria + the decisions below are this doc; it's committed as the "Step 0" of M7 (`docs: M7 recon — RAG tier 2 + multi-provider plan`).

The same workflow as M1/M1.5/M2/M3/M4/M5/M6: written plan first → atomic commits, each passing `pnpm lint` + `pnpm -r --if-present typecheck` + `pnpm -r --if-present test` + `pnpm --filter @mcp-studio/desktop build` + `pnpm test:e2e`, all green; constructive deviation = labelled + rationale, never silent; the §13 coverage ratchet (run coverage before committing if a commit touches a covered package; add a test in the same commit if near the floor; no fix-forward); no progress check-ins within a phase except (a) ad-hoc on an architectural contradiction, (b) phase boundaries. The C-numbering is a guideline — splits / re-orderings are pragmatic atomicity, not deviations.

Vision references: [`handover.md`](handover.md) Part 2 §Knowledge / RAG — the tier 1 vs tier 2 distinction motivating this milestone; [`roadmap.md`](roadmap.md) — the M7 entry (written during M5); [`m6-followups.md`](m6-followups.md) — the M6 deferrals M7 picks up; [`m5-followups.md`](m5-followups.md) — the per-profile API key override + the API-key-reaches-renderer deviation tracked here.

---

## What earlier milestones already give M7

- **`@mcp-studio/llm-provider`** (M5 C70) — the `LlmProvider` interface + `LlmEvent` normalised union are exactly the abstraction M7's OpenAI + Ollama adapters slot into. **Zero changes to `runReAct` / `runPlan` / the chat view** when the new providers land; the M5 design payoff. `AnthropicStreamMapper` is the reference for the new mappers (`OpenAiStreamMapper` / `OllamaStreamMapper` — same stateful pure-function shape feeding their respective SSE / NDJSON streams through into the normalised event union).
- **The vault + `llm:setKey` / `llm:getKey` / `llm:hasKey` IPC** (M5 C72 + M5 D4) — keyed by `llm:anthropic:apiKey` today. M7 extends to `llm:openai:apiKey` (and skips key handling for Ollama — local server, no key). The per-profile override (M5 D4 carry-over) adds a `llm:<provider>:apiKey:<profileId>` slot.
- **`llm:config` IPC + `WorkspaceLlmSettings`** (M5 C72 + M6 C86) — already returns `provider: 'mock' | 'anthropic'` + `summariserModel`. M7 widens `provider` to `'anthropic' | 'openai' | 'ollama' | 'mock'`; the workspace LLM settings gain a `defaultProvider` field + a `perProfile?: Record<profileId, { provider, model, apiKeyRef? }>` map for the override.
- **The M5 C75 caller-attributed safety boundary at `ConnectionManager.callTool`.** Provider-agnostic — every M7 provider's tool-use calls dispatch through the same `{caller: {type:'ai', conversationId}}` path; AI-attributed writes still route to the pending-changes queue regardless of which LLM made them.
- **The M6 plan-and-execute runner + the `Plugin.systemPrompt` async assembly** — M7's RAG retrieval becomes a third concat-and-inject stage in `assemblePluginContributions` (host base + plugin contributions + retrieved chunks). The async signature + the 10 s defensive timeout pattern from C84 lifts straight onto the retrieval pass (cap retrieval at a small budget; on timeout, drop the retrieval block + log a warning chip).
- **The M6 C86 summariser substrate** — `runSummariser` is provider-agnostic by construction (uses `LlmProvider.streamResponse`). When the operator picks Ollama for the main conversation, the summary call uses Ollama too (or the workspace's `summariserModel` override picks a different provider — clean separation, m7-followup if the operator workflow needs it).
- **`Message.usage` + the UsageBadge totals** (M5 C78) — provider-agnostic shape. M7's new providers report usage via their own SSE conventions (OpenAI: `usage` in the final chunk when `stream_options: {include_usage: true}`; Ollama: `prompt_eval_count` / `eval_count` in the final NDJSON chunk); the mappers translate to the normalised `LlmUsage` shape. The cost-pricing table in `llm-pricing.ts` extends with OpenAI + Ollama rows (Ollama is free → `$0.00`).
- **The renderer-only consumption model for `LlmProvider`** (M5 D4 deviation, documented). M7 keeps providers in the renderer for the same reason: each provider's SDK or HTTP client is ESM-first and Electron-33 main is CJS. The exception is the embedding call path — M7 places **embedding requests in main** (see D2). Anthropic Messages SDK stays in renderer; OpenAI ChatCompletions stays in renderer; Ollama HTTP also in renderer (CORS works against `localhost:11434`).
- **The M2 + M4 + M6 cross-view `useExplorerStore.known` cache** + the M6 C87 `useHostBus.selectedOrd` channel — M7 RAG-on-selection ("answer about THIS equipment using the manuals tagged for this station") is m7-followup; the substrate is in place.

---

## Recon — decisions, with recommendations

### D1 — Vector store: **`sqlite-vec` via `better-sqlite3` (also closes the M1-followup sqlite migration)**

Three credible local-vector-store choices:

- (a) **`sqlite-vec`** — SQLite extension (Apache 2.0) loaded via `better-sqlite3`. ANN search (vec0 virtual table; cosine / l2 / dot-product). Tens-of-thousands-scale embeddings work well; documented at 100k-scale. SQLite ubiquity (single-file database, no service, embedded). The extension binary needs per-platform builds (Windows / macOS / Linux × x64 / arm64) — adds an electron-rebuild pass to the build, which the M1 plan already anticipated when it said "json-store now, better-sqlite3 in M4" (m1-followup that M4 didn't pick up; M7 forces the closure).
- (b) **LanceDB** — Rust-based embedded vector DB; Node bindings (`@lancedb/lancedb`); columnar Arrow storage. Faster than sqlite-vec at large scales; heavier binary footprint (~30 MB shipped). Per-platform prebuilts are clean (the package handles them); no electron-rebuild dance.
- (c) **In-memory only** — naïve cosine over an in-memory `Float32Array[]`; no persistence across app restart. Fastest dev iteration but **useless for production v1** — operators upload manuals once + expect them to survive an app restart.

**Recommendation: (a) `sqlite-vec` via `better-sqlite3`**, with the migration scope **also covering the M1-followup sqlite store migration** (workspace storage moves from `JsonStore` → `better-sqlite3` in the same milestone). Three reasons:

1. **Single native-module foothold.** Adding `better-sqlite3` is a one-time cost — once `electron-rebuild` is wired and the build pipeline produces per-arch binaries, sqlite-vec lifts in via `db.loadExtension('vec0')` with no second native module to maintain. LanceDB would be a *separate* native module on top of the existing JSON-store regime; we'd still have to move workspace storage to sqlite *eventually* (the M1-followup is still open).
2. **The "M1-followup deferred for 3 milestones" pattern** is exactly the kind of carry-over that loses correctness over time. M7's RAG forces the closure: the document repository needs sqlite anyway; the workspace store joins it; one IPC layer over both, queryable from a single DB file. The migration follows the same M1 idempotent-migrator pattern (JSON read → sqlite write → JSON file kept around for one milestone as a safety net, deleted in M8).
3. **Scale fits the use case.** A station's runbook corpus is dozens to low-hundreds of documents (manuals, incident reports, runbooks); chunked to ~500 tokens each, the embedding count tops out in the low-thousands per workspace. `sqlite-vec`'s `vec0` virtual table handles 10k+ embeddings without breaking a sweat. LanceDB's "100k scale" advantage doesn't materialise for the v1 corpus shape.

**Implementation**:

- `packages/rag/src/db.ts` — opens `<userDataDir>/rag.db` via `better-sqlite3`, loads the sqlite-vec extension via `db.loadExtension(VEC_PATH)` (path picked from `node_modules/sqlite-vec/dist/vec0.<platform>.<ext>`). Schema: `documents(id, title, path, mime_type, indexed_at, source_kind, scope_workspace, scope_profile_ids_json, chunk_count)` + `chunks(id, document_id, ord, text, page?, section?, char_start, char_end)` + `embeddings` as a `vec0` virtual table keyed on `chunk_id` with a single embedding-vector column.
- A migrator (idempotent — same pattern as the M1 JSON-store migrator) creates tables on first open; subsequent opens are no-ops. Schema version recorded in a `_meta(key, value)` row.
- The workspace-store migration (`workspace.json` → sqlite) is a separate commit (C92b) that lifts the M4-era `JsonStore<WorkspaceData>` into a `SqliteWorkspaceStore` with the same read/write/save surface. **Back-compat**: on first run with sqlite, the migrator reads `workspace.json` if present + imports it; the JSON file is renamed `workspace.json.legacy` so a downgrade isn't catastrophic. M8 deletes the legacy file once the migration is settled in operator workspaces.

**Native module build**:

- `better-sqlite3` and `sqlite-vec` get rebuilt for Electron's bundled Node version via `electron-rebuild` (run as a `postinstall` script). The build matrix already targets win-x64 + macos-x64/arm64 + linux-x64 (`electron-builder.yml`); we add `electron-rebuild` runs to each. Mac arm64 + Windows x64 are the must-haves; Linux x64 is best-effort (matches the M1 packaging plan).
- The cross-platform binaries land via `@electron/rebuild` (the actively-maintained successor; `electron-rebuild` is the legacy name). Add `@electron/rebuild` as a devDep; configure with the bundled Electron version from `apps/desktop/package.json`. The `apps/desktop/build/` directory gains a `rebuild-native.cjs` script (or a CI step) — `pnpm dist` runs it before `electron-builder`.

**Fallback path** (D1 contingency, not the primary): if sqlite-vec proves fragile on Windows (or the per-arch build pipeline blocks releases), switch to LanceDB in a single C-commit. The vector-store interface in `packages/rag` is an internal trait (`VectorStore` with `upsert / search / delete / size` methods); the sqlite-vec impl is one file; a LanceDB impl is another. Decision lever held during Phase A; locked in by C91 commit.

**D1 nuance (promt22) — platform smoke test before workspace migration.** The "single native-module foothold, used twice" plan is **double-or-nothing** if sqlite-vec fails to load on a target platform: the workspace store has already migrated to sqlite + the RAG store hasn't shipped yet → operators stuck on a broken release. To prevent that:

- **C91 acceptance criterion (hard gate)**: the sqlite-vec extension must compile + load + execute basic vector ops (`vec0` virtual table create / insert / `vec_distance_cosine` query) on **Windows + macOS + Linux** before C92 lands. A `packages/rag/smoke/platform-smoke.mjs` script does the round-trip; the `package.yml` CI workflow runs it on the existing win-x64 + macos-arm64 + linux-x64 matrix.
- **If the smoke fails on any platform at C91**: two responses, decided at smoke-fail time:
  1. **Switch the v1 vector store to LanceDB** (the contingency path above) — keep the M1-followup workspace migration as a separate later-milestone item. Phase A re-scopes to "RAG package with LanceDB" + C92 deferred.
  2. **Defer the workspace migration to a separate later milestone** even if sqlite-vec works for RAG — proceed with sqlite-vec for the rag.db only; keep `workspace.json` as-is. This is the lower-risk middle ground if sqlite-vec works *as a loadable extension* but the broader sqlite-vs-JSON migration surfaces unforeseen issues (e.g. concurrent-write semantics, lock contention).
- **Don't proceed with the combined-migration plan without verification.** The C91 commit message explicitly carries the smoke-pass / smoke-fail outcome; C92 only commits if C91's smoke passed on all three platforms.

Local-dev smoke (the C91 author's machine — Windows in the current build) runs as part of the C91 commit's gates. The cross-platform run via CI is a separate workflow trigger — manually invoked on the C91 PR, results pasted into the "Adjustments during the M7 build" section before C92 begins.

### D2 — Embedding model + where embeddings run: **OpenAI `text-embedding-3-small` by default; main-process embed calls; per-workspace override to a local Ollama model**

Three axes here:

- **(2a) Which model.** `text-embedding-3-small` (1536-dim, $0.02 / 1M tokens, ~50–100 ms over HTTP) vs OpenAI's `text-embedding-3-large` (3072-dim, $0.13 / 1M, marginally better quality) vs local Ollama models (`nomic-embed-text` 768-dim, `mxbai-embed-large` 1024-dim, ~100–300 ms locally, zero cost). The v1 corpus shape (low-thousands of chunks per workspace) costs literally cents to index with the small OpenAI model; the local-Ollama path is the air-gapped / confidentiality option.
- **(2b) Renderer or main.** The M5 D4 deviation places the LLM provider in the renderer (key fetched on-demand into the chat-runner's closure). For embeddings the calculus is different: embedding requests are batched, fire-and-forget, and not interactive; main-process placement (a) keeps the API key inside main for the embedding path (closer to the M5 D4 aspiration), (b) lets the upload pipeline use Node streams for PDF parsing without renderer-side blob shuttling, (c) survives a renderer reload mid-indexing without losing state.
- **(2c) Provider abstraction.** Embedding is a separate concern from chat completion; the M5 `LlmProvider` interface doesn't cover it. M7 adds a parallel `EmbeddingProvider` interface (`embed(texts: string[]) → Promise<Float32Array[]>`); the cloud / local variants implement it independently.

**Recommendation: (2a) OpenAI `text-embedding-3-small` default**, (2b) **main-process embedding calls**, (2c) **parallel `EmbeddingProvider` interface**. Plus a per-workspace setting `embeddingProvider: 'openai' | 'ollama'` (default `'openai'`) — operators with confidentiality constraints switch to `'ollama'`; the Ollama path looks up `embeddingModel: 'nomic-embed-text'` as the default with override.

**Operator-facing**: a "RAG configuration" subsection in workspace settings:
- Embedding provider: `openai` (default) | `ollama`.
- Cloud provider needs an API key (re-uses the OpenAI workspace key if set, or a dedicated `llm:openai-embed:apiKey` slot — same vault infra).
- Ollama needs a base URL (default `http://localhost:11434`) + model name (default `nomic-embed-text`).
- "Test embedding" button — runs a one-shot embed of a 5-word probe + reports success / latency / cost estimate.

**Implementation note**: switching the embedding provider after a workspace has indexed documents is a re-index event (different dimensions don't compose). The settings UI surfaces this clearly ("Switching embedding model re-indexes all documents on next upload"); we record the embedding-model name + dimensions on the `documents` row + refuse to add chunks with mismatched dimensions until the operator clicks "Re-index all".

**D2 nuance (promt22) — dimension-consistency UI guard.** Silent dimension mismatch (OpenAI's 1536-dim vectors stored alongside Ollama's 768-dim vectors) yields garbage search results — the cosine over a left-padded or truncated vector ranks unrelated chunks similar. The guard:

- **Workspace settings store the active embedding dimension** alongside the provider + model (`embeddingDimension: number` on `WorkspaceLlmSettings`). Set on first successful upload; read on every chat-turn retrieval.
- **Provider/model switch is a destructive action.** The settings UI presents the switch as a confirm dialog with the loud language: "Switching embedding provider will require re-indexing all N documents (current: OpenAI text-embedding-3-small, 1536 dims; new: Ollama nomic-embed-text, 768 dims). Cancel to keep current setup, or confirm to begin re-indexing." Two buttons: "Re-index all N documents" (destructive-styled) + "Cancel".
- **On confirm**: the workspace flips its embedding-dimension field, drops all `embeddings` rows (the vec0 table contents — fast), iterates `documents` + re-embeds + re-inserts. Progress UI: a per-document spinner in the library + a top-level "Re-indexing 3/12 documents" toast. Cancellation supported via AbortSignal (the in-flight embedding call aborts; the worker leaves the workspace in a partial-reindex state recorded as `dimensionMismatchPending: true`; the next upload triggers a re-index prompt).
- **Cold workspace (no documents yet)** — the switch is free; the dialog reduces to a confirm "Switch to <provider/model>?".
- **The retrieval pass refuses to run when `dimensionMismatchPending: true`**: the chat-turn injection skips with a chip ("Knowledge retrieval paused — re-index in progress / required"). Manual chat continues unaffected.

### D3 — Chunking strategy: **markdown-header-aware for `.md`; page-bounded sentence-aware for PDFs; fixed-size with overlap for plaintext**

Three credible chunking shapes:

- (a) **Fixed-size (500 tokens) with 50-token overlap** — the canonical baseline. Simple; respects no document structure. Works "fine"; loses heading context.
- (b) **Sentence-aware** — split on sentence boundaries (regex-based for v1; a sentence-tokenizer if v2 needs it). Avoids cutting mid-sentence; chunks vary in size.
- (c) **Document-structure aware** — markdown headers split markdown; PDF pages bound chunks; plaintext falls back to (a). The structure-aware chunk carries its heading / page as metadata + the LLM gets "from page 17 of RTU-Manual.pdf, §3.2 Alarm reset procedure" as a citation context.

**Recommendation: (c) with character-bounded caps (promt22 nuance).** Three concrete strategies in `packages/rag/src/chunking.ts`:

- **Markdown** (`.md` / `.mdx`): parse via `remark-gfm` (already in the workspace for the M5 chat markdown renderer — single source); each H1/H2/H3 starts a new chunk; chunks under 600 chars merge with the next; chunks over `MAX_CHARS` (1500) split on paragraphs. Metadata: `{ section: 'H1 > H2 > H3 path' }`.
- **PDF** (`.pdf`): extract text per page via `pdf-parse` (or `pdfjs-dist` if `pdf-parse` proves too lossy on niagara station manuals — judgement at C92 time). Each page is a chunk if ≤ `MAX_CHARS`; larger pages split on paragraph boundaries (double-newline) into multiple chunks. Metadata: `{ page: number }`. Whole-page chunks preserve table context (critical for the manuals scenario).
- **Plaintext** (`.txt` / `.log`): fixed 1500-char windows with 200-char overlap. Metadata: `{ char_start, char_end }`.

**Plugin-contributed chunking override** — a future seam (`Plugin.chunker?: (doc) => Chunk[]`); not M7. v1 chunks via the three built-in strategies above. The seam is sketched in `m7-followups.md` for niagara-specific runbook structure if real-world operator workflow shows the need.

**D3 nuance (promt22) — character-bounded, not token-bounded.** No client-side tokenizer dependency in v1. `MAX_CHARS = 1500` (≈ 375 tokens on English prose at the ~4-chars-per-token rule of thumb; safely under all v1 embedding-model input caps — OpenAI text-embedding-3-small is 8191 tokens, Ollama nomic-embed-text is 2048+). The 1500-char target is a soft hint for the structure-aware strategies (chunks under it are kept whole; chunks over it split at paragraph / sentence boundaries before re-checking). Plaintext: hard 1500-char windows with 200-char overlap.

If real-world embedding calls hit input-cap rejections (rare at 1500 chars; would mean ≥4 chars per token on dense input the rule-of-thumb undershoots), promoting to a `tiktoken` dependency is the m7-followup escalation — the chunker swaps the char-cap for a token-cap with the same shape. Not preempted in v1.

### D4 — Retrieval shape: **top-K chunks injected into the system prompt at chat-turn time** (v1); LLM-callable `retrieveDocs` tool deferred to m7-followups

Two credible retrieval shapes:

- (a) **Top-K injection** — at each chat-turn time, embed the latest user message + retrieve the top-K most-similar chunks from the workspace's indexed corpus + inject them as a "Relevant context from your knowledge base" section in the assembled system prompt. Invisible to the LLM (no new tool); the LLM just sees a system prompt with extra context. M7 ships this.
- (b) **LLM-callable `retrieveDocs(query, scope?)` tool** — add a host-level tool to the LLM's tool catalog; the LLM decides when retrieval helps + sends a tool call; the host responds with chunks. Integrates with M6 plan-and-execute (a plan step could be a `retrieve-step` kind); more powerful + more expensive (the LLM burns a turn deciding to retrieve).

**Recommendation: (a) top-K injection in v1, (b) explicitly deferred to m7-followups.** Why:

1. **Cost / latency**: (a) costs one embedding call per user message (~50 ms, ~$0.000001 with the small model) + one ANN query (sub-millisecond against thousands of chunks); (b) costs a full LLM round-trip per retrieval. (a) is the right default for "ask a question about your manuals" — invisibly enhanced.
2. **Simplicity**: (a) is a 3-step pipeline (embed query → ANN search → concat into prompt); (b) needs tool-catalog plumbing, a renderer-side handler, citation rendering for tool envelopes, and prompt-engineering for *when to retrieve*. The v1 corpus shape (dozens of small docs) doesn't justify the complexity.
3. **M6 plan-and-execute composition**: M7 doesn't preclude (b). A future `PlanStep` kind `retrieve-step` (analogous to `tool-call` / `llm-step` from C82) lifts cleanly when the m7-followup ships — single new step kind in the union, single new event in the runner, no breaking changes.

**Top-K parameters** (v1 defaults, configurable via workspace settings):
- **K = 4** (four chunks per turn; ~2000 tokens of injected context at 500 tokens / chunk). Enough for the operator-asks-about-a-manual case; bounded so even a 200-message conversation past the M6 summary trim doesn't blow context windows on Ollama (8 k / 32 k model windows).
- **Similarity threshold = 0.30 cosine** — chunks scoring below this are dropped from the K (so a query with no semantically-relevant context doesn't inject noise). Pulled from cosine-similarity convention; tunable.
- **Re-runs every turn** — the retrieval pass runs on each user message, not just the first. The conversation context evolves; what's relevant at turn 5 differs from turn 1.

**Scope filtering**:
- Per-document `scope.profileIds: string[]` — documents tagged for the active connection's profileId surface in retrieval; documents with `scope.profileIds.length === 0` are workspace-wide (always eligible).
- The retrieval pass filters by `(doc.scope.profileIds.includes(active.profileId) || doc.scope.profileIds.length === 0)` before ANN.
- Plugin-contributed scope override (`Plugin.retrievalScope?: (ctx) => string[]` returning extra profileIds to include — e.g. a "shared station guides" pool) is a future seam; not M7.

**Citation rendering**:
- The injected system-prompt block carries chunk markers: `[doc:RTU-Manual.pdf, page 17, §3.2 Alarm reset]` prefix on each chunk.
- The host base prompt instructs the LLM: "When you use retrieved context, cite the source verbatim using the chunk marker prefix shown."
- The chat MarkdownRenderer extension recognises `[doc:<title>, page <N>, §<section>]` markers + renders them as clickable chips (the m5 `<ord>` chip precedent). Clicking opens the document in a side panel (m7-followup) or, for v1, opens the file path via Electron's `shell.openPath` (simpler; deferring the side-panel viewer to m7-followups if operator workflow needs it).

### D5 — Multi-provider scope: **Anthropic + OpenAI + Ollama; per-provider model list scoped to "good current default + cost-conscious smaller"**

The promt21 mentioned: OpenAI `gpt-4o` / `gpt-4o-mini` / `o1`; Ollama `llama3.3` / `qwen2.5` / `deepseek-r1`. Recon's recommended scope:

**OpenAI** — adapter via Chat Completions API + tool use (`tools` + `tool_calls` in the API; the streaming-with-tool-use pattern is well-documented).
- `gpt-4o` — flagship; the "match Claude Opus" choice.
- `gpt-4o-mini` — cost-conscious; matches the M6 summariser-cost-trade pattern.
- ~~`o1`~~ deferred to m7-followups. o1's tool-use shape is different (no streaming for `o1-preview`; tool support varies by sub-model; the recon team has limited visibility into when the dust settles). When o1 stabilises, it lands as a single-commit add (the adapter is already in place; just a model-id allowlist extension).

**Ollama** — adapter via Ollama's native HTTP API (`POST /api/chat` with `stream: true`; the streaming chunks are NDJSON). Tool-use support in Ollama varies by model; we wire the tool-call passing-through layer + let the operator pick a function-calling-capable model.
- `llama3.3` (latest; function-calling capable) — the recommended default for the local path.
- `qwen2.5` — Chinese-language strong; function-calling capable; small and large variants.
- `deepseek-r1` — reasoning model; tool-use support depends on variant; experimental in v1.

**Provider catalog**: a `KNOWN_MODELS` table in `packages/llm-provider/src/models.ts` mapping `{ provider, modelId } → { displayName, contextWindow, inputPrice, outputPrice, supportsTools, supportsVision }`. The renderer's model-picker UI reads this; the pricing layer for the UsageBadge reads this. Adding a new model = one row.

**v1 ships**: Anthropic (claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5 — already in M6) + OpenAI (gpt-4o, gpt-4o-mini) + Ollama (llama3.3, qwen2.5). Adding more models is m7-followup table-edit work; doesn't need new adapter code.

**D5 nuance (promt22) — Ollama runtime-detect installed models via `GET /api/tags`.** Hardcoding `llama3.3` / `qwen2.5` as the Ollama list freezes the picker; operators pull whatever models suit their workflow + the v1 picker should reflect what's actually installed. The shape:

- The Ollama picker (in workspace settings + the profile editor's LLM override) populates from `GET <baseUrl>/api/tags` on mount + on a "Refresh" button click. The endpoint returns `{models: [{name: 'llama3.3:latest', size, modified_at, ...}, ...]}` — the model list the operator has locally pulled.
- `KNOWN_MODELS` for Ollama is now **the recommended list, not the exhaustive list**. The picker shows: a "Recommended (installed)" section (the intersection of `KNOWN_MODELS` Ollama entries and `api/tags`), an "Installed" section (everything else from `api/tags`), and a "Recommended (not installed)" section (the rest of `KNOWN_MODELS` for Ollama — grey-italic with a hint "Run `ollama pull <model>` to install").
- **Fallback when Ollama unreachable** (`api/tags` errors out — Ollama not running / wrong baseUrl / network):
  - Picker shows only the recommended list (greyed, with an icon hint "Ollama not reachable — check baseUrl + that Ollama is running"). Operator can still pick a model + save the setting (validates at first chat send instead).
  - A "Retry" button on the picker re-fires `api/tags`. Same button label / placement on the Refresh action when reachable.
- **Pricing rows for unknown models**: the `KNOWN_MODELS` catalog continues to drive UsageBadge cost estimation. Operator-installed-but-not-recommended models land with cost = $0 (Ollama is always free) but a "Model not in the local catalog — token counts shown, cost shown as $0" note in the usage tooltip (the M5 unknownModel locale string already covers this shape).

### D6 — Provider selection UI: **per-profile override stored in `workspace.json`** + workspace-default fallback

Three placements for the picker:

- (a) **Workspace-global only** (the M5 shape) — one provider for everything. Doesn't satisfy the per-customer / per-station case.
- (b) **Per-profile override** — each connection profile carries an optional `{ provider, model }` override; falls back to workspace default. The MSP-multi-customer case maps cleanly: customer A's profile picks Anthropic; customer B's profile picks Ollama-local.
- (c) **Per-conversation** — chat-header dropdown to switch model per conversation. Powerful (compare model outputs on the same data) but the M7 deliverable doesn't require it.

**Recommendation: (b) per-profile in v1; (c) per-conversation deferred to m7-followups.** UI:

- **Workspace settings** (host-level "AI" section) — workspace default provider + workspace API key per provider. Already exists for Anthropic (M5); extended for OpenAI + Ollama base URL.
- **Profile editor dialog** (the existing M1 connection-profile editor) — adds an optional "LLM override" section: "Use a different LLM for this connection" toggle → expands a `provider` + `model` picker + optional per-profile API key override (falls back to workspace key when blank).
- Both places use the same `KNOWN_MODELS` catalog from D5.

**Vault key shape**:
- Workspace default: `llm:<provider>:apiKey` (M5 shape, unchanged).
- Per-profile override: `llm:<provider>:apiKey:<profileId>` (a new slot type).
- The vault's `getLlmKey(provider, profileId?)` resolves profile-first, falls back to workspace-default if absent.

**`WorkspaceLlmSettings` extension**:
```ts
interface WorkspaceLlmSettings {
  provider: 'anthropic'; // M5 single-provider field; M7 deprecates this in favour of:
  defaultProvider?: LlmProviderId;       // M7
  defaultModel?: string;                  // M7
  summariserModel?: '...';               // M6 — unchanged
  embeddingProvider?: 'openai' | 'ollama'; // M7 D2
  embeddingModel?: string;                // M7 D2
  ollamaBaseUrl?: string;                 // M7 D5
}
interface Profile {
  // ...existing M1 fields...
  llmOverride?: { provider: LlmProviderId; model: string }; // M7 D6
}
```

Migration: M6 → M7 reads the legacy `provider: 'anthropic'` field + populates `defaultProvider: 'anthropic'` if absent. Permissive parsing; no version bump (additive — same shape as M6 C86's `summariserModel` extension).

### D7 — Document library scope: **per-workspace storage with per-document `scope.profileIds`** (default-tagged at upload to active profile; operator can untag for workspace-wide)

Three credible scopes:

- (a) **Per-workspace** — all documents in one library, shared across all connections. Simple; mixes contexts (customer A's manuals visible in customer B's chat).
- (b) **Per-profile** — each profile has its own library. Cleaner separation; duplication for cross-station runbooks ("how we handle alarms anywhere").
- (c) **Per-workspace with per-document tag**: documents stored at workspace level + each document tagged `scope.profileIds: string[]`. Empty array = workspace-wide; populated = restricted to listed profiles.

**Recommendation: (c).** Closer to the operator workflow: a generic runbook ("AHU alarm response procedure") wants workspace scope; a customer-specific station manual ("Acme Co. RTU-5 install notes") wants per-profile scope. The retrieval pass filters by `doc.scope.profileIds.includes(active.profileId) || doc.scope.profileIds.length === 0`.

**UI**:
- Upload dialog defaults `scope.profileIds = [active.profileId]` (the safe default — confidential-by-default).
- A "Scope" picker on the upload dialog: "This connection only" (default) / "All connections" (workspace-wide) / "Selected connections" (multi-select).
- The document library view shows the scope per doc + lets the operator change it post-upload.

**D7 nuance (promt22) — bulk retagging UI.** Operators discover post-upload that a manual applies to more profiles than the one active at upload time ("turns out the same Carrier RTU manual covers customers A + B + C"). Retroactive single-doc correction is tedious without bulk action:

- The library view's list rows gain checkboxes; a "Select all" / "Clear" affordance lives in the header.
- When ≥1 document is selected, a "Bulk actions" bar appears: **"Apply scope to N selected"** (the primary), **"Delete N selected"** (destructive-styled, confirm), **"Re-index N selected"** (for the dimension-mismatch case from D2's nuance).
- Bulk scope apply opens the same scope picker as upload + applies to the N selected on confirm. Existing scope tags on the targets are *replaced* (not merged) — the picker shows "Replacing scope on N documents" so the operator knows.
- The IPC: `rag:documents:bulk-update-scope({ documentIds, scope })` — one round-trip, server-side batched update inside a sqlite transaction.

**Storage**: a single `documents` table in the sqlite DB (per D1) carries `scope_workspace BOOLEAN` + `scope_profile_ids_json TEXT`; one Workspace = one library + per-document scope decisions.

### D8 — RAG knowledge tier interaction with M6 tier 1: **both layered into the system prompt, separately marked**

The M6 system prompt assembles `host base + plugin contributions (including the niagara knowledge-summary inventory)` → call this `STAGE 1`. M7 adds a `STAGE 2` retrieval pass: embed the latest user message + retrieve top-K chunks + concat them under a "## Relevant context from your knowledge base" header.

Order in the assembled prompt:
1. Host base prompt (the M5 mcp-studio-flavoured system prompt).
2. Plugin contributions (the M6 niagara `## Connected station inventory`).
3. **Retrieved chunks** (the M7 `## Relevant context from your knowledge base`).
4. (Per-conversation override if set.)

Why this order: the operator's structured knowledge (Niagara's queryable inventory — facts the model can always lean on) comes before the retrieved unstructured chunks (manuals — references to look up). The model treats (2) as ground truth + (3) as candidate evidence to cite.

**No tier-1-vs-tier-2 conflict**: tier 1 is one-shot per conversation (cached via M6 C85b's cache layer); tier 2 is per-turn (re-runs every chat message). They share the same system-prompt assembly path; the retrieval pass appends to the cached output of the plugin assembly.

**Cap accounting (v1)** — the assembled system prompt has a soft cap (already enforced by the M6 cache: each plugin section caps at ~1k tokens of injected context). M7 adds a separate cap on the retrieved-chunks block: K=4 chunks × `MAX_CHARS` (1500 chars ≈ 375 tokens) ≈ ~1500 tokens total at the retrieval stage. Combined system-prompt overhead: ~3–4 k tokens, well below all v1 provider context windows (Anthropic 200k, OpenAI 128k, Ollama 8–32k).

**D8 nuance (promt22) — explicit token-budget management deferred to m7-followups.** Per the M6 D5 / promt19 cost-transparency line: the M6 summariser already keeps long conversations from blowing the context window. The v1 retrieval cap (~1500 tokens) is small enough that even a near-50k-token conversation plus tier 1 + tier 2 stays well inside the 128k OpenAI window. Active token-budget management (recompute per-provider available room before each turn + dynamically scale K / chunk size based on `conversation.usage`) is **deferred** — surfaces as m7-followup work only if real-world operators hit the upper bound on Ollama's smaller windows (8 k / 32 k variants) or on a long M6-summarised conversation. The hook: `MAX_RETRIEVED_TOKENS` is a constant in `packages/rag/src/retrieval.ts`; promoting it to a per-turn-dynamic-budget reading is a single function-extraction follow-up.

### D9 — Citation tracking: **chunk markers in the injected prompt + chat-renderer chips that open the source**

Citations land in two places:

1. **Inside the injected system-prompt block** — each chunk's text is prefixed with `[doc:<title>, page <N>, §<section>]`. The system prompt's instruction line tells the LLM to use these markers verbatim when citing.
2. **Inside the assistant's response** — when the LLM uses retrieved context, it includes a chunk marker like `[doc:RTU-Manual.pdf, page 17]` in its prose. The chat MarkdownRenderer extension recognises this pattern + renders the marker as a clickable chip (the M5 `<ord>` chip precedent — same pre-rewrite-to-mcp-studio-doc-link approach; same `useHostBus` channel for the click action).

**Click action**:
- **v1**: `useHostBus.publishDocOpen({ docId, page? })` + an AppShell consumer that opens the file via `shell.openPath(absolutePath)` (Electron's documented file-opener). For PDFs this opens the system PDF viewer at the right page (depends on platform PDF reader; not all jump to page).
- **v2 / m7-followup**: an in-app document viewer side panel with PDF.js for PDFs + markdown rendering for `.md`. Side panel implementation is the m7-followup add-on.

**D9 nuance (promt22) — citation chip hover preview.** Clicking to verify a citation is friction; many citations the operator wants to confirm at a glance ("does that page really say what the LLM claims?"). The hover preview:

- Each rendered chip carries a tooltip (the existing M5 `<ord>` chip pattern uses radix `Tooltip` from `@mcp-studio/ui` — same primitive lifts here).
- Tooltip contents: **doc title · page (or section) · the first ~100 chars of the cited chunk's text**, ellipsised. Format: `Carrier Manual.pdf · p.23 · '…recommended setpoint range is 21–23 °C…'`.
- The chip itself stays compact (just the doc title + page). Operator hovers → tooltip surfaces; clicks → file opens via `shell.openPath`.
- Chip-data shape: when the retrieval pass injects chunks into the prompt, it also stashes the chunk previews in a renderer-side cache (keyed by chunk id; lives for the conversation). The MarkdownRenderer's chip handler reads from this cache on hover; cache miss → no tooltip body (silent — production behaviour after a renderer reload mid-conversation; the chip still works, just no preview).
- The cache lives in `useDocCitationCache` (new Zustand store), populated by the chat-runner's pre-streamResponse retrieval step.

**No citation in retrieved-but-unused scenario**: if the LLM doesn't cite a chunk in its response, the chunk's relevance was implicit. We don't post-process to extract retrieved-chunk-IDs and surface them as "we considered these" — that's noise. The operator sees only what the LLM actively cited.

### D10 — Per-profile API key UI: **profile editor dialog gains an "LLM override" section**; settings panel keeps workspace-global

Two surfaces, both ship in v1:

- **Workspace settings (host-level "AI" section)** — the M5 surface, extended:
  - Default provider picker (D6).
  - Per-provider workspace key (Anthropic / OpenAI). Ollama has no key.
  - Per-provider model picker — populates the workspace default model.
  - Ollama base URL field (default `http://localhost:11434`).
  - Embedding settings (D2): embedding provider + model + a "Test embedding" probe button.
  - Summariser model (M6 unchanged).
- **Profile editor dialog** — gains an optional "LLM override" subsection:
  - "Use a different LLM for this connection" toggle.
  - When toggled: provider picker + model picker + an optional override-key field (falls back to workspace key when blank).
  - The override key is stored at `llm:<provider>:apiKey:<profileId>`; the workspace key at `llm:<provider>:apiKey`.

Why both surfaces, not just settings: the per-profile case is rare (the MSP / multi-customer case); making the operator dig through settings → connections → profile to set it is a step too many. Inline in the profile editor is the right place. The workspace settings surface is the everyday case (one key + done).

---

## What's deferred (m7-followup)

Scope guardrails per promt21:

- **Visual flow builder (M8)** — stays deferred. M8 picks up the same `DiagnosticFlow.plan` shape M6 ships + adds a canvas editor + the trigger / condition / tool-call / llm-step / aggregator / output node palette.
- **Multi-agent orchestration** — "Later" row of the roadmap. Specialist agents per node (knowledge / math / summariser) layer on top of the existing single-agent runner.
- **Document type breadth: PDF / Markdown / plaintext only in v1.** `.docx` / `.html` / `.pptx` / images-with-OCR deferred. Adding a new document type = a new entry in the chunking strategy table (D3); the rest of the pipeline doesn't care.
- **Real-time corpus updates (file watcher, auto-reindex)** — deferred. v1 ships manual upload + manual reindex via the library view.
- **Multi-modal embedding (text + image)** — deferred. v1 is text-only.
- **`o1` / reasoning-model support in OpenAI adapter** — deferred. v1 ships `gpt-4o` + `gpt-4o-mini`.
- **Per-conversation provider selection** — chat-header dropdown to override the profile's choice for this conversation. Per-profile is the v1 shape; per-conversation is an m7-followup if operator workflow asks for it.
- **In-app PDF / Markdown viewer side panel for citations** — v1 uses `shell.openPath` to open the source in the system reader. The in-app viewer is the polish path.
- **LLM-callable `retrieveDocs(query, scope?)` tool** — the (D4) deferral. PlanStep kind `retrieve-step` lifts when the m7-followup ships.
- **Plugin-contributed chunking override (`Plugin.chunker?`)** — deferred; v1 ships the three built-in strategies. Future seam if niagara has runbook-specific chunking needs.
- **Plugin-contributed retrieval-scope override (`Plugin.retrievalScope?(ctx)`)** — deferred; v1 ships per-document `scope.profileIds`. Plugin-driven scope (e.g. "include all docs tagged 'shared-station-guides'") is the m7-followup.
- **Workspace storage migration verification across all OSes** — the C92b sqlite migration ships first on the dev platform; cross-OS rebuild verification is a Phase D / packaging concern.
- **Embedding model switch re-index UX** — v1 surfaces a clear "switching providers re-indexes" warning. A one-click "re-index all" button is the polish path.
- **Cross-workspace knowledge sharing** — workspace boundaries are the right v1 scope.

---

## Cross-product niagaramcp dependencies

**None new in M7 blocking the milestone.** The two forward-looking items below stay forward-looking:

- **Optional: `searchKnowledge(query, scope)`** — niagaramcp could expose a semantic search endpoint that combines BQL + structured-knowledge-layer matching. Would let the niagara plugin avoid duplicating its own structured knowledge in MCP Studio's vector store (the M6 D4 `getKnowledgeSummary` enrichment is the structured side; a `searchKnowledge` would be the unstructured-text side over server-side runbooks, *if* niagaramcp grew a server-side document store). **Not v1**; forward-looking only. M7 ships against the M5-era niagaramcp surface + handles document storage entirely client-side.
- **The M6 `knowledgeHash` carry-over** — still tracked in `m1-followups.md`. M7 doesn't add to it; the M6 cache layer's TTL-only invalidation continues.

M7 introduces **no new server-side coordination items**. The forward-looking niagaramcp tools (`getDiagnosticContext` / `getTrendAnalysis` / `getFuzzyAssessment` / etc. from `handover.md` §7) remain optional integration points for future flow plans; M7 doesn't need them.

---

## Scope guardrails

What M7 **does not** include, with a pointer to where it lands:

- **Visual flow builder ("agent blocks")** — its own milestone (M8). M6 ships the structured plan data model; M7 doesn't change it; M8 wraps it in a canvas editor.
- **Multi-agent orchestration** — single-agent + single-step in M6 / M7. Specialist agents per node arrive in the "Later" row.
- **Document types beyond PDF / Markdown / plaintext** — deferred; new types extend the chunking strategy table.
- **Real-time corpus updates (file watcher, auto-reindex)** — v1 ships manual upload + manual reindex.
- **Multi-modal embedding (text + image)** — deferred.
- **Reasoning models (o1)** — deferred from the OpenAI adapter scope; v1 ships `gpt-4o` + `gpt-4o-mini`.
- **Per-conversation provider override** — per-profile is the v1 shape.
- **In-app document viewer** — v1 opens citations via `shell.openPath`; in-app viewer is m7-followup.
- **LLM-callable `retrieveDocs` tool** — v1 ships top-K injection; tool-callable retrieval is m7-followup (lifts cleanly via a new M6 PlanStep kind).
- **Cross-workspace knowledge sharing** — workspace boundaries are the right v1 scope.

M7 is **packages/rag local vector store + chunking + embedding pipeline + document library UI + chat-turn top-K retrieval + OpenAI/Ollama adapters via the M5 LlmProvider interface + per-profile API key override**, exactly per the promt21 scope.

---

## Commits (C90 → C99) — four phases, check-ins at phase boundaries

> Each commit passes lint + typecheck + tests + desktop build + e2e. The C-numbering is a guideline — substantial commits splitting mid-flight is pragmatic atomicity, not a deviation.

**C90 — `docs: M7 recon — RAG tier 2 + multi-provider plan`** — this document. (Step 0.)

### Phase A — `packages/rag` substrate + sqlite-vec wiring + workspace storage migration to sqlite (C91–C92) — *check-in after*

- **C91 — `feat: packages/rag — sqlite-vec wiring + VectorStore interface + DocumentRepository scaffold`**. New workspace package `@mcp-studio/rag`:
  - `packages/rag/src/db.ts` — opens `<userDataDir>/rag.db` via `better-sqlite3` with the sqlite-vec extension loaded. Schema (`documents`, `chunks`, `embeddings` vec0 virtual table, `_meta`) created via idempotent migrator.
  - `packages/rag/src/types.ts` — `Document`, `Chunk`, `EmbeddingProvider` interface, `VectorStore` interface (internal trait; the sqlite-vec impl is the only one in v1, but the trait keeps the LanceDB fallback path open).
  - `packages/rag/src/vector-store.ts` — sqlite-vec impl: `upsert(chunkId, embedding)` / `search(embedding, k, scopeFilter)` / `delete(chunkId)` / `size()`.
  - `packages/rag/src/document-repository.ts` — list / save / delete documents + chunks, joined to embeddings via chunk_id.
  - `apps/desktop/package.json` deps: `better-sqlite3`, `sqlite-vec`, `@electron/rebuild` (devDep).
  - `apps/desktop/build/rebuild-native.cjs` — postinstall script that calls `@electron/rebuild` against the bundled Electron version. CI step in `package.yml` reused.
  - + ~20 unit tests (mock the sqlite-vec extension load; test against an in-memory `:memory:` DB; round-trip a known embedding + assert ANN returns the same row).
  - **Platform smoke (promt22 D1 nuance hard gate)**: `packages/rag/smoke/platform-smoke.mjs` — standalone script that opens an in-memory `better-sqlite3` DB, calls `db.loadExtension(VEC_PATH)`, creates a `vec0` virtual table, inserts 100 random 1536-dim vectors, queries `vec_distance_cosine` for the top-1 neighbour of one of them + asserts identity match. Exits 0 on success, non-zero with diagnostic on failure. **C91 commit message must carry the local-platform smoke result; cross-platform CI runs on the C91 PR before C92 lands.**
  - **AC**: `pnpm install` runs `electron-rebuild`; `rag.db` opens on first app launch on the C91 author's platform; the unit tests pass against the headless sqlite without the extension (extension-loading is gated behind a `loadExtension` flag the tests skip); the platform-smoke passes locally + the CI matrix run (Windows + macOS + Linux) passes before C92 begins.
  - **Smoke-fail contingency** (decided at smoke-fail time, documented in the "Adjustments during the M7 build" section): either (a) switch v1 vector store to LanceDB + defer the workspace-store migration to a later milestone (separate the two payloads — Phase A re-scopes), OR (b) ship sqlite-vec for the rag.db only + defer the workspace-store migration to a later milestone (keep `workspace.json`).
- **C92 — `feat(desktop): migrate workspace storage from JsonStore to better-sqlite3 (closes M1-followup) + workspace.json.legacy back-compat`** — **only commits if C91 platform-smoke passed on all three CI platforms**. Two-stage commit:
  - `apps/desktop/src/main/store/sqlite-workspace-store.ts` — a new store with the same `JsonStore<WorkspaceData>` surface (`data`, `save`, `migrate` callback). Persists to `<userDataDir>/workspace.db` via `better-sqlite3` — same `_meta` schema-version row pattern as `rag.db`.
  - On first launch: detects `workspace.json` (the legacy M1–M6 JSON file), reads it, imports into sqlite, renames the file to `workspace.json.legacy`. M8 deletes the legacy file after one milestone of soak.
  - `apps/desktop/src/main/index.ts` switches `createWorkspaceStore(userDataDir)` → `createSqliteWorkspaceStore(userDataDir)` (one-line wiring change; same interface).
  - **All M2–M6 IPC handlers / repositories that touch the workspace store remain unchanged** — they read/write through the same `data` field + call `save()`; the underlying storage is opaque to them. Verified via the existing test suite passing unmodified.
  - + ~15 unit tests for the sqlite store (round-trip; migration from a sample legacy JSON file; v3 / v4 schema-version handling). Existing M1 `JsonStore` tests stay green against `JsonStore` (kept in tree for the RAG package's auxiliary data — the rag-db is opened separately).
  - **AC**: a workspace.json with M1–M6 data migrates losslessly to sqlite on first launch; subsequent launches read from sqlite; deleting the .legacy file doesn't cause issues; all 11 e2e specs pass against the new storage layer.
- → **Check-in after Phase A:** sqlite native module builds on dev platforms; the workspace store migration is silent + reversible (legacy JSON file kept around); `packages/rag` skeleton in place with the document/chunk/vector-store data model + tests; no e2e changes yet. Vague at first glance, but this phase is the foundational native-module lift the rest of M7 builds on.

### Phase B — multi-provider adapters + per-profile API key override (C93–C95) — *check-in after*

- **C93 — `feat(llm-provider): OpenAI Chat Completions adapter via M5 LlmProvider interface`**. New file `packages/llm-provider/src/openai.ts`:
  - `createOpenAiProvider({apiKey, baseUrl?})` returning an `LlmProvider` impl.
  - `OpenAiStreamMapper` — stateful pure mapper consuming OpenAI's SSE chunks ([`data: {choices: [{delta: {...}}]}`](https://platform.openai.com/docs/api-reference/chat/streaming)), emitting the normalised `LlmEvent` union (text-delta / tool-use-start / tool-use-input-delta / tool-use-complete / message-stop with usage when `stream_options.include_usage: true`).
  - Tool-use serialisation: OpenAI's `tools: [{type: 'function', function: {...}}]` shape; the SDK packages this from the LlmTool array. Tool-call result handling: OpenAI expects `messages: [..., {role: 'tool', tool_call_id, content}]`; the runner already produces these shapes via `tool_result` blocks (M5 convention) — the mapper translates.
  - + ~12 unit tests with captured SSE fixtures (a few representative streams: text-only / tool-call / interleaved-tool-and-text / cancelled). **AC**: M5 `runReAct` (no code changes) drives the OpenAI provider through the canonical text-then-tool-then-text scenario with no integration test changes.
- **C94 — `feat(llm-provider): Ollama local adapter via M5 LlmProvider interface`**. New file `packages/llm-provider/src/ollama.ts`:
  - `createOllamaProvider({baseUrl, model})` — defaults `baseUrl: 'http://localhost:11434'`.
  - `OllamaStreamMapper` — consumes Ollama's NDJSON stream (`POST /api/chat` with `stream: true`); each NDJSON chunk is `{ message: { role: 'assistant', content: '...', tool_calls?: [...] }, done: boolean, ... }`. Final chunk carries `prompt_eval_count` + `eval_count` (token usage).
  - Tool-use shape: Ollama's tools API (`{tools: [{type: 'function', function: {...}}]}` — same as OpenAI). Tool results: `messages: [..., {role: 'tool', tool_call_id, content}]`. Mapper translates to/from the normalised events.
  - **No API key path** — Ollama is local; `getLlmKey(provider: 'ollama')` always returns null + the chat runner skips the key check for the Ollama provider.
  - + ~12 unit tests with captured NDJSON fixtures. **AC**: an Ollama-running e2e against a model that supports tools (operator pre-pulls; tested manually in M7 — the e2e suite doesn't require Ollama since the mock provider continues to drive automated e2e).
- **C95 — `feat(desktop): provider selection UI + per-profile LLM override + per-provider vault keys`**. Multi-part settings + vault work:
  - `apps/desktop/src/main/store/credential-vault.ts` — extends to support `llm:<provider>:apiKey:<profileId>` slots (M5 vault keyed by `llm:anthropic:apiKey`; M7 adds OpenAI + per-profile variants). `getLlmKey(provider, profileId?)` resolves profile-first, falls back to workspace-default.
  - `apps/desktop/src/shared/ipc/contract.ts` — `llm:hasKey` / `llm:getKey` / `llm:setKey` / `llm:clearKey` gain optional `profileId?: string` field. The vault routes via the per-profile slot when present.
  - `apps/desktop/src/shared/domain/profile.ts` — `Profile.llmOverride?: { provider: LlmProviderId; model: string }` field.
  - `apps/desktop/src/shared/domain/workspace.ts` — `WorkspaceLlmSettings.defaultProvider?` + `defaultModel?` + `ollamaBaseUrl?` extension.
  - `apps/desktop/src/renderer/src/features/settings/AiSettings.tsx` — new (or extension of an existing settings panel; v1 doesn't have a unified Settings view, so this lifts a settings panel for the AI section specifically; m7-followup is a unified Settings view if more sections accumulate).
  - `apps/desktop/src/renderer/src/features/connections/ConnectionForm.tsx` — extended with the "LLM override" toggle + provider/model picker.
  - `packages/llm-provider/src/models.ts` — `KNOWN_MODELS` catalog (per D5). The renderer's pickers read this.
  - `apps/desktop/src/renderer/src/lib/llm-provider-factory.ts` — extended `createProvider(mode, opts)` reads the active connection's `llmOverride` (or workspace default) + resolves the provider/model + API key (workspace or per-profile slot).
  - `apps/desktop/src/renderer/src/lib/llm-pricing.ts` — extended with OpenAI + Ollama pricing rows (Ollama free). `sumUsage` continues to credit; the cost-estimate UI works for all three providers.
  - + ~15 unit tests (vault per-profile slot resolution; provider factory model resolution; pricing rows). **AC**: an Anthropic conversation, an OpenAI conversation, and an Ollama conversation all run through the chat-runner unchanged (M5 runReAct + M6 runPlan); workspace + per-profile API key handling roundtrips through the vault.
- → **Check-in after Phase B:** three providers wire through the M5 `LlmProvider` interface without runner changes; per-profile + workspace API key plumbing roundtrips through the vault + UI; the cost estimator + UsageBadge work for all three providers.

### Phase C — document upload + library UI + chat-turn retrieval — *check-in after (the M7 deliverable)*

- **C96 — `feat(desktop): document library view + upload pipeline + embedding-in-main IPC`**. New view + IPC + main-side embedding:
  - `apps/desktop/src/main/rag/document-pipeline.ts` — `addDocument(path, scope)` → reads file → picks chunker by extension (D3) → chunks → calls `EmbeddingProvider.embed(texts)` (D2; main-process) → upserts to `documents` / `chunks` / `embeddings` tables.
  - `apps/desktop/src/main/rag/embedding-provider.ts` — `createOpenAiEmbedder({apiKey, model})` + `createOllamaEmbedder({baseUrl, model})` — implementations of the M7 `EmbeddingProvider` interface (mirrors the renderer-side `LlmProvider` but for embeddings, in main).
  - `apps/desktop/src/shared/ipc/contract.ts` — `rag:documents:list` / `rag:documents:add` / `rag:documents:delete` / `rag:documents:reindex` / `rag:config:get` / `rag:config:set` IPC channels.
  - `apps/desktop/src/main/ipc/rag.ts` — handlers; `add` accepts a file path (from a renderer-issued `dialog.showOpenDialog`), reads it, runs the pipeline.
  - `apps/desktop/src/renderer/src/features/knowledge/KnowledgeView.tsx` — new host-level rail item (`BookOpen` icon). Library list (newest indexed first), filter by scope, document detail panel with chunk count + size + scope + indexed-at, "Add document" button → file picker. Scope editor (radio: this connection / all connections / selected — multi-select profile picker).
  - + ~15 unit tests (document pipeline against a fake embedder; chunking against canned md/pdf/txt fixtures; scope filtering). **AC**: the operator uploads a small PDF + a small markdown file; both appear in the library; the chunk count is non-zero; the embeddings table has rows; the scope is honoured.
- **C97 — `feat(desktop): chat-turn top-K retrieval injection + citation marker rendering`**. The M7 chat integration:
  - `apps/desktop/src/main/rag/retrieval.ts` — `retrieveForTurn(profileId, query, k=4) → Promise<RetrievedChunk[]>` — embeds the query via the configured EmbeddingProvider (D2) + ANN-searches the vector store + filters by `(profileId match || workspace-wide)` + thresholds at 0.30 cosine + caps at K.
  - `apps/desktop/src/shared/ipc/contract.ts` — `rag:retrieve` IPC channel (request: `{profileId, query, k?}`, response: `{chunks: RetrievedChunk[]}`).
  - `apps/desktop/src/renderer/src/features/chat/ChatView.tsx` — `handleSend` calls `rag:retrieve` before `streamResponse` (rag step parallel-with the system-prompt assembly, awaited together via `Promise.all`); the retrieval result is concat'd as a `## Relevant context from your knowledge base` section after the plugin contributions (D8 ordering). Retrieval failure (timeout / disabled) — soft-fail; the chat continues without injection + a warning chip surfaces (m6 chip pattern).
  - `apps/desktop/src/renderer/src/features/chat/MarkdownRenderer.tsx` — extended `<doc>` chip handler: the M5 `<ord>` chip precedent (pre-rewrites `[doc:<title>, page <N>]` markers into `mcp-studio-doc:<base64>` link form; `components.a` decodes + renders as clickable chips). Click dispatches via `useHostBus.publishDocOpen({ docId, page? })`; the AppShell handles it via `shell.openPath`.
  - Host base prompt extended: "When you cite a chunk from the Relevant context section, use the marker verbatim, e.g. `[doc:RTU-Manual.pdf, page 17]`."
  - + ~10 unit tests (retrieve-and-inject roundtrip with a fake vector store; chip rewrite logic; click dispatch). **AC**: an operator asks "how do I reset the AHU-1 alarm?" after uploading the AHU manual; the chat-turn shows the assistant citing the manual via a clickable chip; clicking opens the source.
- → **Check-in after Phase C — the M7 deliverable:** documents upload + chunk + embed; the chat-turn pipeline injects top-K context; the LLM cites retrieved sources via the chip marker; multi-provider + per-profile API key work. **This is the M7 milestone outcome.**

### Phase D — e2e + docs + tag (C98–C99) — *big check-in after*

- **C98 — `test(e2e): m7 RAG retrieval + multi-provider switching + per-profile key override`**. New e2e specs:
  - `tests/e2e/rag-upload-and-retrieve.spec.ts` — open Knowledge view; upload a small markdown document via `dialog.showOpenDialog` (programmatically seeded in the test); assert the library shows the document; switch to Assistant; send a query referencing the document content; assert the response contains a `[doc:...]` chip; click the chip; assert `shell.openPath` was called with the document's path (mocked).
  - `tests/e2e/multi-provider-switch.spec.ts` — extend the existing mock LLM provider with an `openai-mock` program OR add a renderer-side provider-mode override that lets the e2e pick "fake-openai" / "fake-ollama" providers. Switch the active connection's profile to use the fake OpenAI; send a message; assert the FakeOpenAiProvider's program ran. Same for Ollama.
  - **AC**: e2e green ×13 (11 carry-over from M6 + 2 new M7 specs).
- **C99 — `chore: M7 docs + close the milestone + tag v0.7.0-m7`**. Final docs:
  - `docs/m7-followups.md` — the M7-deferred items (m7-followups: `o1` / reasoning model OpenAI support; per-conversation provider; in-app PDF/MD viewer; LLM-callable `retrieveDocs` tool with new PlanStep kind; plugin-contributed chunking / retrieval-scope overrides; .docx / .html / images-with-OCR document types; auto-re-index file watcher; multi-modal embeddings; embedding-model switch one-click "re-index all" UX; **promt22 deferrals**: dynamic per-turn token-budget management for retrieval cap; `tiktoken` dependency upgrade if char-cap real-world tests trigger embedding-input-cap rejections; in-app PDF viewer side panel).
  - `docs/master-spec.md` — an "M7 — RAG tier 2 + multi-provider (2026-…, `v0.7.0-m7`)" section.
  - `docs/m1-followups.md` — mark "better-sqlite3 store" item resolved (M7 C92 closes it). The niagaramcp-side `knowledgeHash` coordination item stays open.
  - `docs/m6-followups.md` — mark "knowledgeHash coordination" item still open (M7 doesn't change it).
  - `docs/m5-followups.md` — mark "per-profile LLM API key override" + "API key reaches renderer via llm:getKey" items resolved (M7 C95 closes the override; the API key now reaches renderer only when the provider is renderer-side, which all three M7 providers still are; the embedding path is main-side so the main-vs-renderer split is now a per-call decision rather than a single-position deviation).
  - `docs/milestone-7.md` "Adjustments during the M7 build" — filled in as commits land.
  - Tag `v0.7.0-m7`.
  - **AC**: docs reflect the shipped state; tag annotated; release notes for v0.7.0-m7.

- → **Big check-in after Phase D:** `git log --oneline` C90–C99 + new screenshots (`m7-knowledge-view`, `m7-chat-with-citation`, `m7-provider-picker-settings`, `m7-profile-llm-override`); coverage report; e2e green ×13; the tag `v0.7.0-m7`. Then M8 — visual flow builder per the roadmap (`packages/flow-builder` + canvas editor + the trigger/condition/tool-call/llm-step/aggregator/output node palette editing the M6 `DiagnosticFlow.plan` shape).

**Checkpoint cadence (promt22 confirmed)**: Phase A → checkpoint after C92; Phase B → checkpoint after C95; Phase C → checkpoint after C97 (the M7 deliverable); Phase D → big checkpoint after C99 + tag. C91's platform-smoke gate is enforced within Phase A (C91 commits + smoke runs; C92 only commits if smoke passed).

---

## Repo-layout deltas (vs. M6)

- **`packages/rag/`** — new workspace package. `src/types.ts`, `src/db.ts`, `src/chunking.ts`, `src/vector-store.ts`, `src/document-repository.ts`, `src/embedding-provider.ts` (interface), `src/index.ts` (exports), `package.json`, `tsconfig.json`.
- **`packages/llm-provider/src/openai.ts`** — OpenAI Chat Completions adapter.
- **`packages/llm-provider/src/openai-stream.ts`** — OpenAI SSE-to-normalised-event mapper.
- **`packages/llm-provider/src/ollama.ts`** — Ollama local adapter.
- **`packages/llm-provider/src/ollama-stream.ts`** — Ollama NDJSON-to-normalised-event mapper.
- **`packages/llm-provider/src/models.ts`** — `KNOWN_MODELS` catalog + provider/model picker substrate.
- **`packages/llm-provider/src/index.ts`** — exports the new adapters + types.
- **`apps/desktop/src/main/store/sqlite-workspace-store.ts`** — new. The sqlite-backed workspace store (replaces `json-store.ts` for the workspace data; the JsonStore remains exported for ad-hoc use).
- **`apps/desktop/src/main/rag/`** — new directory. `document-pipeline.ts`, `embedding-provider.ts` (OpenAI + Ollama embedder impls), `retrieval.ts`.
- **`apps/desktop/src/main/ipc/rag.ts`** — new. The `rag:*` IPC handlers.
- **`apps/desktop/src/shared/ipc/contract.ts`** — extended with the `rag:*` channels + the `llm:*` per-profile-key extensions.
- **`apps/desktop/src/shared/domain/profile.ts`** — `llmOverride?` field.
- **`apps/desktop/src/shared/domain/workspace.ts`** — `defaultProvider`, `defaultModel`, `embeddingProvider`, `embeddingModel`, `ollamaBaseUrl` fields.
- **`apps/desktop/src/renderer/src/features/knowledge/KnowledgeView.tsx`** — new host-level rail item (the document library).
- **`apps/desktop/src/renderer/src/features/settings/AiSettings.tsx`** — new settings panel for AI provider + embedding + summariser configuration.
- **`apps/desktop/src/renderer/src/features/connections/ConnectionForm.tsx`** — gains an "LLM override" section.
- **`apps/desktop/src/renderer/src/features/chat/MarkdownRenderer.tsx`** — extended `<doc>` chip handler.
- **`apps/desktop/src/renderer/src/features/chat/ChatView.tsx`** — the chat-turn retrieval injection step before `streamResponse`.
- **`apps/desktop/src/renderer/src/lib/llm-provider-factory.ts`** — extended for OpenAI + Ollama + per-profile override resolution.
- **`apps/desktop/src/renderer/src/lib/llm-pricing.ts`** — OpenAI + Ollama pricing rows.
- **`apps/desktop/build/rebuild-native.cjs`** — postinstall script for `@electron/rebuild`.
- **`apps/desktop/electron-builder.yml`** — `electronVersion` + `nodeGypRebuild: true` (or similar — exact knob picked at C91 time).
- **`tests/e2e/rag-upload-and-retrieve.spec.ts`**, **`tests/e2e/multi-provider-switch.spec.ts`** — new specs.
- **`docs/m7-followups.md`**, **`docs/milestone-7.md`** — new docs.

## Adjustments during the M7 build

*(Filled in as commits land, per the M1–M6 pattern. The shipped state lives here; commit messages flag deviations; `m7-followups.md` carries the deferred list.)*

## Ad-hoc check-in triggers (otherwise: note-and-continue)

The same five-trigger discipline from M6:
1. **Architectural contradiction** — the recon recommendation collides with implementation reality. Check in with the contradiction + the proposed adjustment + why.
2. **Cross-product coordination needed** — a niagaramcp side change becomes blocking (none planned for M7 — but the embedding-model behaviour on real station manuals may surface chunking-strategy adjustments that warrant a single ad-hoc check-in).
3. **Native-module build hazard** — sqlite-vec / better-sqlite3 prebuilds fail on a target platform; the LanceDB fallback path activates. The C91 commit locks in the choice; this trigger fires only on a Phase A failure.
4. **Phase-boundary check-in** — A, B, C (M7 deliverable), D.
5. **Operator-visible UX regression** — the M6 chat surface degrades under the new injection path (system prompt too long; latency spike; etc.). Bigger picture; warrants the check-in.

Default: note in commit messages + the "Adjustments during the M7 build" section. Surface to the operator at phase boundaries. Don't pre-flight every nuance — the recon already absorbed promt21's design questions.

---

## Why this plan over the alternatives

1. **Native-module foothold once, used twice (workspace store + rag store).** Adding `better-sqlite3` is unavoidable for sqlite-vec; rolling the M1-followup workspace-store migration into the same milestone amortises the native-module CI / packaging / electron-rebuild work across two payloads. M7 closes "we should move off JSON storage" + lays the substrate for "future plugin-contributed persistence wants sqlite too" in one swing.

2. **Two parallel surfaces, four phases, three check-ins.** RAG (Phases A + C) and multi-provider (Phase B) are independent enough to phase sequentially but not so independent that each warrants its own milestone. The check-in cadence — after A (foundational), after B (provider abstraction proven), after C (M7 deliverable) — matches the M6 cadence + gives the operator three explicit "what's shipped so far" beats.

3. **Top-K injection over LLM-callable retrieval in v1.** Simpler, cheaper, faster; the LLM-callable variant lifts cleanly via a M6 `PlanStep` kind extension (the M6 design payoff again — adding a new step kind is one type-union widening + one runner-event addition; no breaking changes). v1 doesn't need the power that costs the extra round-trip.

4. **Per-profile API key + LLM override in the profile editor, not buried in settings.** Matches the operator workflow ("I configure connections; my customer-specific LLM choice lives with the connection"). The settings panel handles the workspace-global case.

5. **Per-document `scope.profileIds` over per-workspace OR per-profile.** Both alternatives have failure modes the per-document scope avoids: per-workspace mixes confidential contexts; per-profile duplicates cross-station runbooks. The scope tag handles both axes with one piece of data + one filter at retrieval time.

6. **OpenAI + Ollama in v1, `o1` deferred.** The two adapters cover (a) the cost-conscious cloud path (OpenAI gpt-4o-mini), (b) the air-gapped / confidentiality path (Ollama local). `o1` is a model-id extension when its tool-use semantics stabilise; it adds nothing to the adapter shape.

7. **OpenAI `text-embedding-3-small` default; Ollama as the confidentiality path.** $0.02/1M tokens is essentially free at the v1 corpus scale; the Ollama path is the "no data leaves the operator's machine" answer. Per-workspace setting reflects the per-customer reality the MSP case maps onto.

8. **Tier 1 (M6 structured knowledge) + tier 2 (M7 unstructured docs) layered into the system prompt separately.** No interaction conflicts; each tier has its own cache + lifecycle; the LLM sees them as separate context blocks + cites tier 2 via chip markers while leaning on tier 1 as ground-truth inventory.
