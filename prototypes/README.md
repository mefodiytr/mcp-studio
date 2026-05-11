# prototypes — archived research-phase code

These are the Flask / stdlib proof-of-concept scripts that preceded MCP Studio. They are kept here as a historical reference (the evolution from a Flask PoC to a productized desktop app) and as a source of behaviour to port — **not** as source of truth. The canonical spec is [`../docs/master-spec.md`](../docs/master-spec.md).

| File | What it is |
|---|---|
| `mcp_app.py` | Single-file Flask "web explorer" for a Niagara station over MCP Streamable HTTP — breadcrumb path, table of children, per-row Inspect/Read/Write/+Ext/Delete, inline create forms, "Bootstrap user-Bearer" identity switch. The UX inspiration for the Niagara plugin (M2) and the bearer-bootstrap flow (M3). |
| `mcp_console.py` | Menu-driven stdlib console — create/remove folders, create points, set/read values, inspect components, add extensions, commit station — over the same Streamable HTTP protocol. The behaviour reference for the universal tool-invocation surface (M1). |

Original copies live in `C:\MCP\` on the author's machine and are left untouched there; these are point-in-time snapshots taken at the M1 kickoff (2026-05-11).
