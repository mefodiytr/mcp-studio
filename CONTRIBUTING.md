# Contributing

MCP Studio is a private project for now (see `LICENSE`). This file documents the
working conventions so the codebase stays coherent.

## Setup

Prerequisites: **Node 22+** and **pnpm 11**.

```bash
pnpm install      # one flat (hoisted) node_modules — see pnpm-workspace.yaml
pnpm dev          # launch the Electron app with hot reload
```

The repo is a pnpm workspace:

| Path                    | What                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `apps/desktop`          | the Electron app (main / preload / renderer + shared types) |
| `packages/mcp-client`   | typed wrapper around `@modelcontextprotocol/sdk`            |
| `packages/schema-form`  | JSON Schema → `react-hook-form` / `zod` form generator     |
| `tests/e2e`             | Playwright end-to-end suite (drives the built app)          |
| `docs/`                 | `master-spec.md` (vision), `milestone-1.md` (the M1 plan)  |
| `prototypes/`           | archived Python PoCs — research, not product               |

## Checks (must pass before a commit)

```bash
pnpm lint                                  # eslint
pnpm typecheck                             # tsc --noEmit, every package
pnpm test                                  # vitest, every package (with coverage gates)
pnpm --filter @mcp-studio/desktop build    # electron-vite production build
pnpm test:e2e                              # builds + runs the Playwright suite (needs a display)
```

CI runs the same set on every push / PR (`.github/workflows/ci.yml`).

## Commits

- Atomic — one logical change per commit.
- Conventional-commits prefix (`feat:`, `fix:`, `chore:`, `perf:`, `docs:`, `test:`, …).
- The body explains *why*, not just *what*.

## Packaging

`pnpm --filter @mcp-studio/desktop pack` produces an unpacked app under
`apps/desktop/release/`; `dist` produces an installer/AppImage/dmg. M1 artifacts
are **unsigned** — no code signing or notarization yet.
