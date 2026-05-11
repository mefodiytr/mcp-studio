# MCP Studio

A professional desktop application for working with MCP (Model Context Protocol) servers — a universal client plus a deep Niagara/BMS specialization. *What Workbench is to Niagara, MCP Studio aims to be to MCP servers.*

> **Status:** Milestone 1 (Foundation) complete — see the `v0.1.0-m1` tag. A universal MCP client: connect over HTTP/stdio with Bearer/header/no auth, browse and invoke tools (with argument templating), browse resources & prompts, a raw JSON-RPC console, a live protocol inspector, a command palette, and a multi-tab workspace. Not yet packaged for end users (unsigned smoke artifacts only). The Niagara/BMS specialization is M2. See [`docs/master-spec.md`](docs/master-spec.md) for the product vision, [`docs/milestone-1.md`](docs/milestone-1.md) for the M1 plan, and [`docs/m1-followups.md`](docs/m1-followups.md) for what was deferred.

## Development

Prerequisites: **Node 22+**, **pnpm 11**.

```bash
pnpm install                                  # one flat node_modules (hoisted)
pnpm dev                                       # launch the Electron app with hot reload
pnpm lint
pnpm typecheck
pnpm test                                      # unit tests, all packages (with coverage gates)
pnpm test:e2e                                  # builds + runs the Playwright suite (needs a display)
pnpm --filter @mcp-studio/desktop build        # production build → apps/desktop/out/
pnpm --filter @mcp-studio/desktop dist         # unsigned installer / AppImage / dmg → apps/desktop/release/
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for conventions.

## Repository layout

Monorepo via pnpm workspaces. See [`docs/milestone-1.md`](docs/milestone-1.md) → "Repository layout" for the full structure and the deviations from the spec's §11.

```
apps/desktop/     Electron app (main / preload / renderer + shared types)
packages/         mcp-client, schema-form
plugins/          server-specific plugins (Niagara arrives in M2)
tests/            Playwright e2e + fixtures
docs/             master-spec.md, milestone-1.md, m1-followups.md
prototypes/       archived Flask/stdlib PoCs (research phase, not source of truth)
```

## License

Proprietary — all rights reserved. See [`LICENSE`](LICENSE).
