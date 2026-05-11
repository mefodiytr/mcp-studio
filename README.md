# MCP Studio

A professional desktop application for working with MCP (Model Context Protocol) servers — a universal client plus a deep Niagara/BMS specialization. *What Workbench is to Niagara, MCP Studio aims to be to MCP servers.*

> **Status:** Milestone 1 (Foundation) in progress. Not yet usable. See [`docs/milestone-1.md`](docs/milestone-1.md) for the plan and [`docs/master-spec.md`](docs/master-spec.md) for the product vision.

## Development

Prerequisites: Node 22+, pnpm.

```bash
pnpm install
pnpm dev        # launch the Electron app with hot reload
pnpm build      # produce an unpacked desktop build
pnpm lint
pnpm typecheck
pnpm test
```

## Repository layout

Monorepo via pnpm workspaces. See [`docs/milestone-1.md`](docs/milestone-1.md) → "Repository layout" for the full structure and the deviations from the spec's §11.

```
apps/desktop/     Electron app (main / preload / renderer)
packages/         mcp-client, schema-form, plugin-api
plugins/          server-specific plugins (Niagara arrives in M2)
tests/            Playwright e2e + fixtures
docs/             master-spec.md, milestone-1.md
prototypes/       archived Flask/stdlib PoCs (research phase, not source of truth)
```

## License

Proprietary — all rights reserved. See [`LICENSE`](LICENSE).
