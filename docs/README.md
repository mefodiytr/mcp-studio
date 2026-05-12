# Docs

Navigation hub for `docs/`. (Project overview lives in the repo-root [`README.md`](../README.md).)

| File | What it is |
| --- | --- |
| [`master-spec.md`](master-spec.md) | The source of truth — product vision, scope, architecture, the milestone outline, and a per-milestone "Adjustments during the build" record. Start here for the big picture. (Bilingual: English headings, mixed prose — kept as originally written.) |
| [`milestone-1.md`](milestone-1.md) | The M1 plan (`v0.1.0-m1`) — universal client foundation: 24 atomic commits + acceptance criteria, the repo-layout deltas (Δ1–Δ8), and an "Adjustments during the M1 build" section. Frozen as a historical record. |
| [`milestone-1.5.md`](milestone-1.5.md) | The M1.5 plan (`v0.1.5-m1.5`) — OAuth 2.1 + PKCE as a third auth method: commits C25–C32 + a "Build adjustments" section. |
| [`milestone-2.md`](milestone-2.md) | The M2 plan (`v0.2.0-m2`) — plugin architecture + the read-only Niagara explorer: commits C33–C47 in four phases, kickoff decisions, check-in points, and an "Adjustments during the M2 build" section (incl. the found-while-testing fixes). |
| [`m1-followups.md`](m1-followups.md) | Things deferred from M1 / M1.5 — UI/renderer, quality/tooling, later-milestone architecture, the M1.5/OAuth follow-ups, and the **niagaramcp-side coordination list** (changes needed on niagaramcp, tracked here because they affect Studio). |
| [`m2-followups.md`](m2-followups.md) | Things deferred during M2 — tree virtualisation, the property-sheet links/extensions panel, a host `ctx.openView` hook + per-node context menu, slimming the BqlView chunk + a dark editor theme + a Lezer BQL grammar, per-connection explorer state, a deeper schema merge. |
| [`screenshots/`](screenshots/) | Check-in / milestone-boundary snapshots of the running app (captured via the `MCPSTUDIO_CAPTURE_PATH` main-process hook). `screenshots/README.md` indexes them. (M2 Explorer/BQL captures are still TODO — see the repo README.) |

Plans for M3+ don't exist yet — M3 (write & safety) gets its own `milestone-3.md` when the recon/plan ritual runs.
