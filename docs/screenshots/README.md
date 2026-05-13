# Screenshots

Check-in / milestone-boundary snapshots of the running app. The M1 shots were
captured via the main-process `MCPSTUDIO_CAPTURE_PATH` hook (see [`../master-spec.md`](../master-spec.md) §5.12 — a single PNG once the renderer has loaded);
the M2 + M3 shots are Playwright-driven multi-state captures from the e2e
specs, gated on the `MCPSTUDIO_E2E_SCREENSHOTS=1` env var so a normal
`pnpm test:e2e` doesn't rewrite the PNGs every run:

```bash
MCPSTUDIO_E2E_SCREENSHOTS=1 pnpm test:e2e
```

| File | When |
|---|---|
| `m1-c3-app-shell.png` | M1 / C3 — design system & three-zone app chrome: left rail, tab strip with the ⌘K mount point, Welcome empty state, status bar. Light theme (the machine's system theme at capture time). |
| `m1-c7-proof-of-life.png` | M1 / C7(+C7b) — the built app auto-connecting `@modelcontextprotocol/server-everything` over stdio through the full stack (renderer → IPC → ConnectionManager → mcp-client → SDK): server info, capability counts (13 tools / 7 resources / 4 prompts), tool-name chips. Light theme. |
| `m1-final-shell.png` | M1 close — final app shell. |
| `c17-app-shell.png` | M1 / C17 — schema-form-driven invocation; design-system check-in. |
| `m2-explorer-tree-expanded.png` | M2 — the Niagara plugin's **Explorer**: station root with `Drivers` expanded, showing `NiagaraNetwork` / `ObixNetwork` / `MCP_Test` / a stack of `mcpSmoke_*` test folders; type badges (`driver:DriverContainer`, `niagaraDriver:NiagaraNetwork`, …) per row. The plugin's rail items (Explorer / Folder / Properties / BQL / Changes) are visible in the left rail. |
| `m2-bql-result.png` | M2 — the **BQL playground**: the default `select displayName, type from baja:Component` query (against the recorded ControlPoint fixture) returns the `oat` row with the TSV table + the "1 row" footer. |
| `m3-niagara-connected.png` | M3 — fresh connection to the niagaramcp mock: the connection card shows `niagaramcp 0.4.1-mock`, **Specialized by Niagara station** badge, http transport, 46 tools / 0 resources / 0 prompts (the mock advertises no resources/prompts), the Niagara plugin's rail items have appeared. |
| `m3-property-sheet.png` | M3 — the editable **Property sheet** for `Services/UserService`: identity header (ord / type / parent / children) over the slot table; the BSimple Property slots (`baja:Integer`, `baja:Boolean`, `baja:Float`, …) render as editable cells with a per-row Reset affordance. |
| `m3-changes-view-with-pending.png` | M3 — the **Changes** view (the M3 deliverable): two pending ops both badged **Reversible** — `Create baja:Folder "AuditTestFolder" under station:|slot:/Drivers` and `Set maxBadLoginsBeforeLockOut on …/UserService to 7`. The header shows the "2 pending changes" count, the (test-mode) "Bootstrap user token" button, auto-commit toggle, Discard, and the dark-styled Apply all. |
| `m3-apply-confirm-dialog.png` | M3 — the **Apply confirm** dialog for the all-reversible case: "Apply 2 operations? All ops are reversible by issuing an inverse op later. commitStation is fired at the end." The destructive-styled "Including K irreversible" callout fires when the queue holds any irreversible op (§D2). |
| `m3-history-writes-filter.png` | M3 — the **Audit trail**: the History panel with the "Writes only" filter on, showing three writes from the Apply pass — `commitStation` / `setSlot` / `createComponent`, each with an `ok` status chip, an amber `write` badge, the attributed server (`niagaramcp`), timestamp, duration, and the args JSON. The "Export audit log" button downloads the currently-visible entries. |
| `m4-usage.png` | M4 / Phase A — **Tool usage** view: most-called horizontal bar chart + per-tool latency table (avg / p50 / p95) + an error-breakdown panel — all pure derivations over the persisted `tool-history`. Connection scope picker (active / "All connections") + a "Writes only" toggle that threads the M3 audit flag. The new rail icon (`BarChart3`) is visible in the left rail. |
