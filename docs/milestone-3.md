# Milestone 3 — Write & safety

> Make the Niagara plugin write-capable — safely. Add the host-side write-safety
> primitives (annotation overrides, an audit trail), a diff-and-approve write
> workflow in the Niagara plugin, property-sheet inline edit, tree create/remove,
> and the user-context Bearer bootstrap. Read = M1/M2; live monitor & history
> viewer = M4.

**Target:** `v0.3.0-m3` · ~3 weeks · commits C48 → C60 (Step 0 + 12), four phases, check-ins at phase boundaries. The plan + acceptance criteria + the decisions surfaced below are this doc; it's committed as the "Step 0" of M3 (`docs: M3 recon — write & safety plan`).

The same workflow as M1/M1.5/M2: written plan first → atomic commits, each passing `pnpm lint` + `pnpm -r --if-present typecheck` + `pnpm -r --if-present test` + `pnpm --filter @mcp-studio/desktop build` + `pnpm test:e2e`, all green; constructive deviation = labelled + rationale, never silent; the §13 coverage ratchet (run coverage before committing if a commit touches a covered package; add a test in the same commit if near the floor; no fix-forward); no progress check-ins within a phase except (a) ad-hoc on an architectural contradiction, (b) phase boundaries.

---

## What M2 already gives M3

- **`ToolInvocationDialog` destructive-confirm** — the generic Tools-catalog invocation dialog already gates a "review the args, run anyway / cancel" step on `tool.annotations?.destructiveHint` (`pendingArgs`); `removeComponent` / `unlinkSlots` already trip it (niagaramcp annotates those correctly).
- **`toolSchemaHints` + `ToolInvocationDialog.mergeSchemaHint`** — the host already merges a plugin's per-tool schema overlay onto `tool.inputSchema` before the args form (`ToolsCatalog` → `pickPlugin` → `mergeSchemaHint`). M3 extends the *same seam* with annotation overrides.
- **`tool-history-repository` + `useHistory` + `HistoryPanel`** — every tool call is already persisted (`toolHistoryEntrySchema`: connectionId / profileId / serverName / toolName / args / status / result / error / ts / durationMs) with a filterable panel. M3's "audit log" is this, extended.
- **Niagara plugin** — the Explorer / Folder / Properties / BQL views, `lib/niagara-api.ts` (the defensively-typed `listChildren`/`inspectComponent`/`getSlots`/`bqlQuery` wrappers, all throwing on transport error / `isError` per the M2 `PluginContext.callTool` unwrap), `state/explorer-store.ts`, the `niagara-mock` fixture (currently **stateless** — replays recorded envelopes).
- **`profiles:update` IPC** — a profile's auth secret can already be updated (the wizard's edit path); M3's Bearer bootstrap reuses it rather than inventing a new IPC.
- **`@mcp-studio/ui` Dialog / Command / Button / Input** — the plugin already imports these; the write dialogs (create / remove-confirm / link / bootstrap) build on them. No host `ctx.confirm` primitive is needed.

---

## Recon — decisions, with recommendations

### D1 — Write workflow: a per-plugin diff-and-approve queue, not a host-wide one

Master-spec §5.6 wants a "Hold mode" pending-changes queue with a diff view and an explicit Apply gate. **The queue lives in the Niagara plugin, not the host** — a "diff" is only meaningful for the *structured* edits the plugin understands (slot edit, create, addExtension, link, remove); a generic queue over arbitrary `tools/call`s degenerates to a list of JSON blobs. The generic Tools catalog keeps the M2 per-call destructive-confirm; it does **not** get a queue in M3.

**Niagara write engine** (Phase B): `lib/write-ops.ts` — typed ops (`SetSlot { ord, slotName, oldValue, newValue }`, `ClearSlot { ord, slotName }`, `CreateComponent { parentOrd, type, name, nameStrategy }`, `RemoveComponent { ord, force, dryRunPreview? }`, `AddExtension { parentOrd, extensionType, name }`, `LinkSlots { sourceOrd, sourceSlot, sinkOrd, sinkSlot, converterType? }`), each with `describe()` (the diff-view label) and `toToolCall()` (`{ name, args }`). `state/pending-store.ts` — a Zustand store: the op list, `enqueue`/`dequeue`/`clear`, per-op status (`pending → running → done → error`), and `applyAll(ctx)` = run the ops sequentially via `ctx.callTool`, then one `commitStation` at the end, surfacing per-op errors and stopping or continuing per a policy (recommend: stop on first error, leave the rest pending). `removeComponent`'s native `dryRun: true` is used to fetch a preview *before* the op enters the queue (so the diff view shows "would remove X, refuses because inbound links / would also remove …").

**Recommendation: ship it Niagara-only, queue-by-default for the structured edits, with an "auto-commit" toggle** (master-spec §5.6) that, when on, applies each op immediately (still through the same op machinery, just `applyAll` after every `enqueue`) — for fast iteration on a dev station, with a visible warning.

### D2 — Undo semantics: full undo before Apply, "issue the inverse" after — never "transactional rollback"

Niagara/BAJA is non-transactional; there is no server-side undo. The UX promises exactly:
- **Before Apply** — the Pending-changes queue *is* the undo: remove an op, reorder, discard all. It's local state; nothing has hit the station.
- **After Apply** — **no undo button.** What we offer: (a) the **audit log** (D3) — "here's what you changed"; (b) for `SetSlot` specifically, a one-click **"revert to recorded previous value"** that simply enqueues a *fresh* `SetSlot { …, newValue: oldValue }` — explicitly labelled as "issue the inverse operation", not a rollback; (c) for `CreateComponent`, an "undo by removing" affordance that enqueues `RemoveComponent { ord }`; (d) for `RemoveComponent` and `AddExtension`/`LinkSlots` — **nothing reconstructable** (a removed component's full subtree isn't captured); the queue warns at Apply time that these are not reversible.
- `Ctrl+Z` stays UI-local (selection etc.), as in M1.

**Recommendation: be loud about this in the UI.** The Apply dialog lists which queued ops are reversible-by-inverse vs. not; the property sheet's "revert" button says "re-set to <old value>", not "undo".

### D3 — Tool annotations: ship `Plugin.toolAnnotationOverrides` *and* keep the niagaramcp fix tracked

Reality (from `tests/fixtures/niagara-mock/tools-list.json`): the `write`-category tools are mostly annotated correctly — `setSlot` / `clearSlot` / `invokeAction` / `addExtension` / `linkSlots` / `createComponent` / `commitStation` are `readOnlyHint:false, destructiveHint:false` (right — they mutate but don't destroy), and `removeComponent` / `unlinkSlots` are `destructiveHint:true` (right). **The broken ones** are the entire `walkthrough-write` family (`createEquipment` / `updateEquipment` / `bulkCreateEquipment` / `assignPointToEquipment` / `createStandalonePoint` / `createSpace` / `updateSpace` / `createEquipmentType` / `updateEquipmentType`) and `importKnowledge` — all ship `readOnlyHint:true, destructiveHint:false`, so the generic Tools catalog would run them with **no confirm step and no badge**.

Two paths: (i) wait for niagaramcp to fix its annotations — blocks M3 generic-catalog safety, and we don't control that repo's timeline; (ii) plugin-side override. `toolSchemaHints` overlays the *inputSchema*, not annotations, so option (ii) needs a small contract extension: **`Plugin.toolAnnotationOverrides?: Record<string, Partial<ToolAnnotations>>`**, merged onto `tool.annotations` in the same place hints are merged (`ToolsCatalog` / `ToolRow` / `ToolInvocationDialog`).

**Recommendation: do both.** The niagaramcp annotation fix stays tracked in `m1-followups.md` (it's the right long-term home). Ship `toolAnnotationOverrides` in M3 — it's a tiny, general mechanism (any server with sloppy annotations benefits) and it makes the generic catalog safe *immediately*. The niagara override map: `{readOnlyHint: false}` on the whole `walkthrough-write` family + `importKnowledge`, plus `{destructiveHint: true}` on `bulkCreateEquipment` and `importKnowledge` (mode `replace` can wipe the model — per the m1-followups note, "especially bulkCreateEquipment"). When niagaramcp fixes its end, the overrides become no-ops and get dropped (note in `m3-followups.md`). **Out of M3 scope:** a bespoke UI for the knowledge-model tools (spaces / equipment / equipment-types operate on the knowledge YAML, not the BComponent tree) — they're invocable, with a proper confirm, from the generic Tools catalog; a "Knowledge model" view is M4+.

### D4 — BearerResolver: it's the "bootstrap-and-store" flow — renderer-side suffices in M3; no new main component

What master-spec calls "BearerResolver" is: niagaramcp authenticates write tools as a specific `BUser` whose `mcp:tokenHash` Tag matches the hash of the Bearer the client sends. The token itself is just an HTTP `Authorization: Bearer` header — **the M1 Bearer auth already sends it; the credential vault already stores it; `profiles:update` already lets us swap it.** Nothing new is needed *on the main side* in M3.

What's *new* is the **bootstrap UX**, which is renderer-side: a plugin-contributed command + dialog — given a pre-created `BUser` name, generate a random token, call `setupTestUser({ username, token })` (niagaramcp hashes it with the service's `tokenSalt` and writes the Tag), then offer to write that token into a connection profile's Bearer secret (via `profiles:update`) and reconnect. There's an inherent chicken-and-egg: calling `setupTestUser` needs *some* working auth (the admin Bearer / apiToken), so the flow is: connect with admin/apiToken → run bootstrap → get the user token → save it to a new (or the same) profile → reconnect as that user.

**Caveat — `setupTestUser` is TEST-ONLY** (gated by `BMcpPlatformService.enableTestSetup`). For production, niagaramcp needs a non-test provisioning tool and a token-rotation tool, and ideally a Workbench-side action. **Cross-repo coordination (niagaramcp, tracked in `m1-followups.md`):**
- a non-test `provisionMcpUser` / `bindMcpToken` tool (admin-auth-gated, not behind `enableTestSetup`),
- `rotateMcpToken { username }` → generate a new token, replace the `mcp:tokenHash` Tag, return the new plaintext (the client swaps it into the vault); old token invalidated immediately,
- a Workbench `BMcpProvisionAction` (operator-initiated provisioning/rotation from the Property Sheet of `BMcpPlatformService` or the `BUser`).

**Recommendation:** M3 ships the bootstrap command against the existing `setupTestUser` — it works *today* against a test-enabled service, and the command surfaces a clear "this requires `enableTestSetup` on the station; production provisioning needs niagaramcp <X>" message. The plan flags the niagaramcp work as a cross-repo dependency; M3 is **not** blocked on it. (If, during the build, it turns out no reachable test station can enable `enableTestSetup` *and* niagaramcp hasn't shipped the non-test tool — ad-hoc check-in: ship the command disabled-with-explanation, or pull it to M3.5/M4.)

### D5 — Property-sheet inline edit: BSimple Property slots only; queued, not immediate

`setSlot` "coerces the value to the slot's existing BSimple type (BString/BBoolean/BInteger/BLong/BDouble/BFloat)" and `clearSlot` "resets a Property slot to its declared default". So M3 inline-edit covers **Property slots whose declared type is a BSimple primitive** (`baja:String` / `baja:Boolean` / `baja:Integer` / `baja:Long` / `baja:Double` / `baja:Float`). Enum slots (`setSlot` takes only string/number/integer/boolean — an enum would need its ordinal) are **borderline**: support them only if `getSlots` returns the ordinal alongside the localized display value (it currently returns the display string — see the m1-followups "localized slot values" item); otherwise out of M3. `invokeAction` (Actions, not Property slots) and complex slots (BStruct / BFacets / links / extensions) are **out of M3** — the read surface barely exposes them (m2-followups note).

UX: an editable cell in `PropertySheetView` for an eligible slot → on commit, **enqueue a `SetSlot` op** (into the pending-changes queue — D1) and show the cell with the *pending* value + a "modified" badge (revertable from the queue, or via the row's revert button); a per-row "Reset to default" → enqueue `ClearSlot`; the row reflects queue state (`pending` / `applying` / `applied` / `error` — error message inline). Validation: client-side type check against the declared slot type + min/max/precision from `getSlots` facets if present; the real check is server-side (`setSlot` errors surface in the queue). Commit-to-server = Apply the queue + `commitStation`. Undo within session = the queue (D2).

**Recommendation: queued-by-default** (consistent with D1), with the auto-commit toggle for the impatient. Show the slot table's pending values optimistically; on Apply-error, roll the cell back to `oldValue` and surface the error.

### D6 — History viewer: stays strictly M4

`readHistory` exists, and master-spec slots the history viewer in M4. **Keep it out of M3.** A real viewer is a new view with a chart + range picker + multi-history overlay — a meaningful chunk (new charting dep per master-spec §4), orthogonal to write & safety. (You can already dump `readHistory` JSON via the generic Tools catalog today; no M3 work needed there. The live monitor / watch list is also M4.)

### D7 — E2e fixture: make `niagara-mock` stateful for the write flows

`tests/fixtures/niagara-mock/server.mjs` is currently stateless (replays the recorded envelopes). M3-Phase-D rewrites it around a **tiny in-memory station model** — a tree seeded from `listChildren-root-depth2.json` plus a per-component slot map (seeded from `getSlots-userservice.json` for `UserService`, synthesised elsewhere). Mutations apply to the model: `setSlot` / `clearSlot` (update the slot map), `createComponent` (add a child), `removeComponent` (dry-run = report; non-dry-run = delete the subtree; refuse if inbound links unless `force`), `addExtension` (add a child of the given type), `linkSlots` (record a link; affects `removeComponent`'s inbound-link refusal), `commitStation` (no-op ack), `unlinkSlots` / `invokeAction` (stub-ack). Reads (`listChildren` / `getSlots` / `inspectComponent`) reflect the mutated model. The recorded `bqlQuery` stays static. **Fault injection:** a magic ord prefix (e.g. `…/__fail__…`) or a `__fail` arg makes a mutation return `isError: true` — so the e2e can assert the Pending-queue surfaces the error and rolls back the optimistic display.

E2e flow (Phase D): connect → edit a BSimple slot in the Property sheet → see it pending → Apply → re-read shows it persisted → create a component via the tree context menu → dry-run-preview a removal → confirm → applied → assert the History panel (audit filter) shows the writes attributed to the profile. The M2 niagara e2e stays green (it only reads the seed state, which is unchanged). **Recommendation: keep the model deliberately minimal** — just enough for these flows; don't reimplement BAJA.

---

## Commits (C48 → C60) — four phases, check-ins at phase boundaries

> Each commit passes `pnpm lint` + `pnpm -r --if-present typecheck` + `pnpm -r --if-present test` + `pnpm --filter @mcp-studio/desktop build` + `pnpm test:e2e`, all green; a constructive deviation is labelled with its rationale.

**C48 — `docs: M3 recon — write & safety plan`** — this document. (Step 0.)

### Phase A — host write-safety primitives (C49–C51) — *check-in after*

- **C49 — `feat(plugin-api): toolAnnotationOverrides`.** Add `Plugin.toolAnnotationOverrides?: Record<string, Partial<ToolAnnotations>>` to the contract (+ a `ToolAnnotations` type if not already shared) — a plugin's per-tool overlay onto a server's (possibly wrong) tool annotations. + unit tests. **AC:** the type compiles; existing plugins unaffected; a test covers an override merging onto a base annotation set.
- **C50 — `feat(plugin-host): apply tool-annotation overrides + the niagara override map`.** `ToolsCatalog` resolves the active plugin and merges `toolAnnotationOverrides[toolName]` onto `tool.annotations`; the destructive-confirm gate (`ToolInvocationDialog`) and the badges (`ToolRow`) now reflect the merged set. Add `niagaraPlugin.toolAnnotationOverrides` — `{readOnlyHint:false}` on the `walkthrough-write` family + `importKnowledge`; `{destructiveHint:true}` on `bulkCreateEquipment` + `importKnowledge`. + a merge unit test. **AC:** invoking `createEquipment` / `importKnowledge` from the catalog now shows a destructive-confirm (where overridden); read-only servers unaffected; e2e green ×3.
- **C51 — `feat(desktop): audit log — write calls flagged & attributed`.** Extend `toolHistoryEntrySchema` with an optional `write?: boolean` (computed at call time from the merged annotations — `destructiveHint || readOnlyHint === false`) and keep the existing `profileId` as the actor key (the niagaramcp-side `BUser` name isn't always knowable client-side; record a per-profile auth fingerprint if available). `HistoryPanel` gains a "Writes only" filter + shows the attribution; add "Export audit log (JSON)". + tests; bump the `mcp-client`/relevant coverage floor if it moves. **AC:** a write call shows up flagged in the panel; the export round-trips; read-only history unchanged.
- → **Check-in after Phase A:** the host's write-safety surface is in place (annotation overrides reach the catalog; the audit trail flags writes); the app behaves identically against a read-only server.

### Phase B — Niagara write engine (C52–C53) — *no mandatory check-in*

- **C52 — `feat(niagara): write-op model + pending-changes store`.** `lib/write-ops.ts` (the typed ops + `describe()` + `toToolCall()`) and `state/pending-store.ts` (Zustand: queue, `enqueue`/`dequeue`/`clear`, per-op status, `applyAll(ctx)` → sequential `ctx.callTool` + final `commitStation`, stop-on-first-error, optimistic-value bookkeeping; an `autoCommit` flag). + unit tests for the ops and the `applyAll` loop (driven by a `fakeCtx`). **AC:** `pnpm --filter @mcp-studio/niagara test` green; the store reducer + apply loop tested.
- **C53 — `feat(niagara): write-tool wrappers in niagara-api`.** Add `setSlot` / `clearSlot` / `createComponent` / `removeComponent` (with `dryRun` + `force`) / `addExtension` / `linkSlots` / `commitStation` / `unlinkSlots` to `lib/niagara-api.ts` — defensively typed, throwing on transport error / `isError` (the M2 convention); `removeComponent({dryRun:true})` returns a structured preview the diff view can render. + unit tests against a `fakeCtx`. **AC:** wrappers covered; types align with the recorded inputSchemas.

### Phase C — Niagara write UI (C54–C57) — *check-in after (the M3 deliverable)*

- **C54 — `feat(niagara): pending-changes panel + diff view`.** A new plugin view (`changes`) — the queued ops with their `describe()`, per-op toggle/remove, "Apply all" / "Discard", live per-op status during apply, error surfacing + the optimistic-rollback path; a top-bar "N pending changes" affordance (and the auto-commit toggle); `commitStation` invoked once at the end; the Apply dialog lists which queued ops are reversible-by-inverse vs. not (D2). **AC:** queue → diff → apply works against the (Phase-D, but stub for now) wrappers; the e2e wiring lands in Phase D.
- **C55 — `feat(niagara): property-sheet inline edit (BSimple slots)`.** Editable cells in `PropertySheetView` for BSimple-typed Property slots → on commit, enqueue a `SetSlot` op + show the pending value with a "modified" badge (revertable); a per-row "Reset to default" → `ClearSlot`; client-side type/facet validation; the row reflects queue state. **AC:** editing a BSimple slot queues an op and shows it pending; ineligible slots stay read-only; the property sheet still renders for a connection with no pending edits.
- **C56 — `feat(niagara): tree create / remove / add-extension / link via context menu`.** A per-node context menu in the Explorer tree: "New child…" (`createComponent` — a small bespoke dialog or the host's SchemaForm against a minimal schema), "Remove…" (`removeComponent` — dry-run preview shown *before* queueing), "Add extension…" (`addExtension`), "Link slots…" (`linkSlots` — a form; the visual wire-mode from master-spec §5.5 is later). Each queues an op. Also wires the M2-deferred bits this needs: "Copy ORD", and (if cheap) the host `ctx.openView(viewId)` hook so "open in Property sheet / Folder" works from the menu — otherwise that stays deferred. **AC:** the menu queues each op; a removal shows its dry-run preview before it's queued; no-op when nothing's selected.
- **C57 — `feat(niagara): user-context Bearer bootstrap`.** A plugin command + dialog: given a `BUser` name, generate a token, `callTool('setupTestUser', { username, token })`, then offer to write the token into a connection profile's Bearer (`profiles:update`) and reconnect — with a clear "requires `enableTestSetup` on the station; production provisioning needs niagaramcp `provisionMcpUser`/`rotateMcpToken` (tracked)" message. + the niagaramcp-coordination note in `m1-followups.md` (the non-test provisioning tool + `rotateMcpToken` + a Workbench `BMcpProvisionAction`). **AC:** the command runs end-to-end against a test-enabled mock; degrades with a clear message otherwise.
- → **Check-in after Phase C — the M3 deliverable:** a safe write-capable Niagara editor — inline slot edit, tree create/remove/extend/link, the diff-and-approve queue + audit, the (test-gated) user-context Bearer bootstrap.

### Phase D — polish + e2e (C58–C60) — *big check-in after*

- **C58 — `feat(niagara): write-flow polish`** *(optional, fold into C59/C60 if thin)* — empty/error states for the changes panel; the "revert to recorded previous value" / "undo by removing" affordances (D2); keyboard (`Delete` on a tree node → "Remove…"); the auto-commit warning banner.
- **C59 — `test(niagara): stateful niagara-mock + write-flow e2e`.** Rewrite `tests/fixtures/niagara-mock/server.mjs` around the in-memory station model (D7) — mutations + fault injection; the M2 reads stay correct (seed state unchanged). A Playwright e2e: connect → edit a BSimple slot → pending → Apply → re-read persisted → create a component via the tree menu → dry-run-preview a removal → confirm → applied → assert the History panel's write-filter shows the writes. **AC:** e2e green ×4 (stdio / OAuth / niagara-read / niagara-write), flake-free; CI runs them.
- **C60 — `chore: M3 docs + tag`.** `docs/milestone-3.md` "Adjustments during the M3 build"; master-spec → an "M3 — Write & safety" section; `docs/m1-followups.md` → mark the toolAnnotationOverrides item resolved (or annotate it "client-side mitigated; niagaramcp fix still wanted"); `docs/m3-followups.md` → the M3-deferred items (knowledge-model UI, visual wire-mode, `invokeAction` / complex-slot edit, enum-slot edit pending the ordinal, `ctx.openView` if it didn't make C56, the auto-commit batching niceties); tag `v0.3.0-m3`. **AC:** docs reflect the shipped state; tag annotated.
- → **Big check-in after Phase D:** `git log` C48–C60; a screenshot of the diff-and-approve flow + the editable property sheet (capture script — or carry the M2 screenshot TODO forward); coverage report; e2e green ×4; the tag `v0.3.0-m3`. Then M4 — observability (live monitor + history viewer).

---

## Repo-layout deltas (vs. M2)

- `packages/plugin-api/src/index.ts` — gains `Plugin.toolAnnotationOverrides?` (+ a shared `ToolAnnotations` type if not already there).
- `plugins/niagara/src/lib/write-ops.ts`, `plugins/niagara/src/state/pending-store.ts` — new.
- `plugins/niagara/src/lib/niagara-api.ts` — gains the write wrappers.
- `plugins/niagara/src/views/` — a new `changes` view; `PropertySheetView.tsx` and `ExplorerView.tsx` gain edit/menu affordances.
- `plugins/niagara/src/index.ts` — registers the `changes` view + the Bearer-bootstrap command + `toolAnnotationOverrides`.
- `apps/desktop/src/shared/domain/tool-history.ts` — `write?: boolean` (+ optional actor fingerprint); `HistoryPanel` + the repository updated.
- `tests/fixtures/niagara-mock/server.mjs` — rewritten stateful (M2 reads unchanged); `tests/e2e/niagara-write.spec.ts` — new.
- `docs/m3-followups.md` — new.
- No new runtime deps planned (the create-component form reuses `@mcp-studio/schema-form` if it needs a generated form; charting / history-viewer deps are M4).

## Ad-hoc check-in triggers (otherwise: note-and-continue)

1. niagaramcp's `setSlot` / `clearSlot` / `removeComponent` behave differently than their descriptions imply (type-coercion surprises, `dryRun` shape, error envelopes) in a way that reshapes the op model or the diff view.
2. The user-context Bearer bootstrap can't be exercised — no reachable station can enable `enableTestSetup` *and* niagaramcp hasn't shipped the non-test provisioning tool — so C57 has nothing to test against. Reconsider: ship it disabled-with-explanation, or pull it from M3.
3. The pending-changes queue ↔ React-Query cache ↔ `explorer-store` interplay (optimistic property-sheet values, the tree reflecting a queued create/remove) turns into a state-management tangle whose fix needs reshaping the store boundaries (e.g. a host `ctx.openView` / shared-cache hook, or moving the queue into a shared store).
4. Annotation overrides surface a host architectural question — e.g. whether `mergeSchemaHint` and the annotation merge should be one "plugin tool overlay" mechanism — significant enough to want sign-off before consolidating.

## Check-in points

- **After Phase A** (C51): the host write-safety surface — annotation overrides reaching the Tools catalog (destructive-confirm + badges), the audit trail flagging & attributing writes; identical behaviour against a read-only server. (Structural milestone.)
- **After Phase C** (C57): the safe write-capable Niagara editor — inline slot edit, tree create/remove/extend/link, the diff-and-approve queue + audit, the (test-gated) Bearer bootstrap. (The M3 deliverable.)
- **Big check-in after Phase D** (C60): `git log --oneline` (C48–C60); a screenshot of the diff/approve flow + the editable property sheet; coverage report; e2e green ×4; the tag `v0.3.0-m3`. Then M4 — observability (live monitor + history viewer; the `readHistory` tool is already there).
