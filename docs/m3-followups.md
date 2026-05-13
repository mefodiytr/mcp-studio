# M3 follow-ups

Things deferred during Milestone 3 (write & safety), with a pointer to where
each fits. Nothing here blocks the M3 deliverable; this is the "we know about
it" list. See `docs/m1-followups.md` for the M1 / M1.5 lists, `docs/m2-followups.md`
for the M2 ones, and the **niagaramcp-side coordination** list (which still
applies, replicated at the bottom of this file with M3 context).

## Plugin-api seams (added when a second plugin or use-case asks)

- **A host `onBeforeDisconnect` / `ctx.confirmClose` hook.** Closing a Niagara
  connection with a non-empty pending queue today silently drops it (the
  per-`connectionId` key keeps orphan queues invisible; a fresh `connectionId`
  starts fresh, so there's no cross-bleed). The plan's D1 nuance was a
  confirm-before-disconnect dialog; doing it cleanly needs a host-level "ask
  the plugin before this connection closes → returns confirm / cancel" hook
  (`Plugin.onBeforeDisconnect?(connectionId): Promise<'allow' | 'cancel'>`),
  plus `ConnectionManager` + the disconnect button + the disconnect command
  all consulting it. M4 candidate — natural trigger is a second in-box plugin
  wanting the same affordance.
- **`ctx.openView(viewId)`** — the M2-deferred cross-view affordance (open the
  selected node in the Property sheet / Folder view from the explorer's
  context menu). C56 dropped it from the menu (Copy ORD + the four write
  actions cover M3); selecting a node + switching to Properties via the rail
  still works. Add when a plugin command genuinely benefits from triggering a
  view switch.
- **`ctx.updateAuthSecret(secret)` + `ctx.reconnect()`** — the C57 Bearer
  bootstrap reaches into `window.studio.invoke('credentials:set' / 'connections:
  reconnect')` directly (an abstraction leak — the plugin is the only caller
  in M3, so it doesn't justify the contract extension yet). Surface as
  `PluginContext` methods when another plugin needs them.

## Niagara plugin UX polish

- **"Issue the inverse" buttons.** §D2 promised a per-row affordance on
  *done* SetSlot/ClearSlot/CreateComponent/LinkSlots rows in the Changes view
  that enqueues the inverse op (re-`SetSlot` to the recorded `oldValue`;
  `RemoveComponent` for a created ord; `UnlinkSlots` for a created link).
  Deferred from C58 (folded out of the C60 docs/tag commit for atomicity).
  Small — adding to the Changes view's `OpRow` is straightforward; the op
  data already records what's needed.
- **`Delete` keyboard shortcut on tree nodes.** When a node is selected and
  the Explorer is focused, `Delete` should open the `RemoveDialog`. Same C58
  deferral — straightforward keydown handler + the existing `RemoveDialog`.
- **Visual wire-mode for `linkSlots`** (master-spec §5.5). The M3 link dialog
  is a plain form (4 fields); drag-from-source-to-sink wire drawing needs a
  canvas-level interaction system the host doesn't have. M4+ when either the
  host gains a canvas primitive or a third plugin pulls the requirement.
- **Enum slot editing.** `setSlot` accepts string/number/integer/boolean, but
  niagaramcp's `getSlots` returns the *localized display string* for the
  current enum value — not the ordinal `setSlot` would coerce against
  (m1-followups). Until niagaramcp exposes the ordinal, enum slots stay
  read-only in the M3 property sheet.
- **Complex slot editing (BAbsTime / BRelTime / BStruct / BFacets / links / extensions).**
  Out of M3 (§D5). Each is its own editor surface — separate follow-up
  per-kind, scheduled with M4/M5 as Niagara editing matures.
- **Orphaned-queue notification.** When a connection disappears with pending
  ops, the queue lingers invisibly under its (now-dead) `connectionId`. A
  one-shot toast ("N pending Niagara ops were lost — the connection closed")
  + self-clear of orphaned queues would be friendlier. Small.
- **Property-sheet refetch trigger after Apply** *(resolved in M3, noted for
  reference)* — the Changes view invalidates `['niagara', cid]` after a
  successful `applyAll`; the property sheet / explorer refetch transparently.

## Architecture / general

- **Zustand selector singleton gotcha** *(M3 lesson, doc-only)* — when a
  Zustand selector returns a *derived collection* (e.g. "the queue for this
  connection, or empty"), the empty-default case must be a module-level
  singleton (`const EMPTY: readonly T[] = [];`) and never a fresh literal
  (`?? []`). Zustand's selector compare is `Object.is`; a fresh `[]` per render
  is a "change" → React #185 ("Maximum update depth exceeded"). Caught by the
  niagara-plugin e2e in C55 — exactly the value of having an e2e against a
  built renderer. Worth surfacing in `CONTRIBUTING.md` for future plugin
  authors.
- **`PluginContext.callTool` opts shape.** M3 added `{ write?: boolean }`.
  If more attribution flags arrive (e.g. `dryRun`, `idempotent`, `source`),
  consider a typed `CallOpts` interface to keep the seam coherent.
- **Audit-log dedicated store / longer retention.** The M3 audit is just the
  `tool-history` ratchet (write-flagged, filtered, exported). Cap is 200
  entries (shared with non-write history); the export is JSON. If a real
  ops-grade audit need shows up — longer retention, signed export, per-
  station — split it out of `tool-history-repository` then.

## niagaramcp coordination items (relevant to MCP Studio M3 + M4)

Duplicated here for visibility — the canonical list lives in
`docs/m1-followups.md` ("niagaramcp-side coordination"). Each blocks or
unblocks specific M3 / M4 polish on the Studio side:

- **Write-tool annotations are wrong** (the whole `walkthrough-write` family
  + `importKnowledge` ship `readOnlyHint:true`) → MCP Studio papers over with
  `niagaraPlugin.toolAnnotationOverrides` (C50). When niagaramcp fixes its
  end, the override map becomes a no-op and gets dropped from the plugin.
- **`provisionMcpUser` / `bindMcpToken` (non-test)** + **`rotateMcpToken { username }`**
  → MCP Studio's C57 bootstrap **feature-detects** these via `tools/list`;
  when they appear in a niagaramcp release, the same dialog uses them and
  drops the "(test mode)" label — **no Studio code change**. Until then,
  bootstrap requires `BMcpPlatformService.enableTestSetup` on the station
  (test-mode only).
- **Workbench `BMcpProvisionAction`** — UI counterpart of the above
  (operator-initiated provisioning / rotation from the `BUser` Property
  Sheet). Optional; the MCP tool path already covers it.
- **Enum slot ordinal exposure in `getSlots`** — unblocks enum property-sheet
  editing in M3's D5 scope (see "Enum slot editing" above).
- **`bqlQuery` input format hostility** + **slot value localization
  (`поистине` → canonical `true`)** — UX polish, not M3 blockers; affects the
  M2 BQL playground and the M3 property-sheet boolean parser.
