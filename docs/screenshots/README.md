# Screenshots

Check-in / milestone-boundary snapshots of the running app, captured via the
main-process `MCPSTUDIO_CAPTURE_PATH` hook (see [`../master-spec.md`](../master-spec.md) §5.12).
At least one per milestone boundary; more at notable check-ins.

| File | When |
|---|---|
| `m1-c3-app-shell.png` | M1 / C3 — design system & three-zone app chrome: left rail, tab strip with the ⌘K mount point, Welcome empty state, status bar. Light theme (the machine's system theme at capture time). |
| `m1-c7-proof-of-life.png` | M1 / C7(+C7b) — the built app auto-connecting `@modelcontextprotocol/server-everything` over stdio through the full stack (renderer → IPC → ConnectionManager → mcp-client → SDK): server info, capability counts (13 tools / 7 resources / 4 prompts), tool-name chips. Light theme. |
