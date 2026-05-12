# Contributing

MCP Studio is a proprietary, single-author project for now (see [`LICENSE`](LICENSE));
community contributions aren't actively solicited until a post-1.0 license
decision. This file documents the working conventions so the codebase stays
coherent — and so a future contributor (or future me) can pick up the rhythm.

## Repo language: English only

All source, comments, identifiers, commit messages, PR/issue text, and project
docs are **English**. Two deliberate exceptions: `docs/master-spec.md` is
bilingual (English headings, mixed prose — it's the original product brief, kept
as written), and `tests/fixtures/niagara-mock/*.json` preserves real niagaramcp
wire data verbatim (Russian tool descriptions included — that's the point of a
fixture). Don't translate either.

## Running locally

Prerequisites: **Node 22+**, **pnpm 11**.

```bash
pnpm install                                   # one flat (hoisted) node_modules — see pnpm-workspace.yaml
pnpm --filter @mcp-studio/desktop dev          # launch the Electron app with hot reload
```

Repo layout (pnpm workspace):

| Path                     | What                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| `apps/desktop`           | the Electron app — main / preload / renderer + `src/shared` types, IPC      |
| `packages/plugin-api`    | the plugin contract — `Plugin` / `PluginView` / `PluginContext` / manifest |
| `packages/ui`            | vendored shadcn extracted (Button/Input/Dialog/Command) + `cn` + Tailwind  |
| `packages/mcp-client`    | typed wrapper around `@modelcontextprotocol/sdk` (connections, OAuth)       |
| `packages/schema-form`   | JSON Schema → `react-hook-form` / `zod` form generator                     |
| `plugins/niagara`        | the in-box Niagara plugin (manifest + views + lib + tool hints)            |
| `tests/e2e`              | Playwright end-to-end suite (drives the built app)                         |
| `tests/fixtures/niagara-mock` | recorded niagaramcp tool surface + a dependency-free stdio mock server |
| `docs/`                  | see [`docs/README.md`](docs/README.md)                                     |
| `prototypes/`            | archived Python PoCs — research, not product                               |

## Checks (must pass before every commit)

```bash
pnpm lint                                  # eslint
pnpm typecheck                             # tsc --noEmit, every package
pnpm test                                  # vitest, every package (with coverage gates)
pnpm --filter @mcp-studio/desktop build    # electron-vite production build
pnpm test:e2e                              # builds + runs the Playwright suite (needs a display)
```

CI (`.github/workflows/ci.yml`) runs the same set on every push / PR. There is
no fix-forward: a commit that doesn't pass all five doesn't land.

## Branching & commits

- Work on a branch; **never force-push `main`** (or rewrite shared history).
- **Atomic commits** — one logical change per commit; the tree is green at every commit.
- **Conventional-commits prefix:** `feat:` / `fix:` / `chore:` / `docs:` / `test:` / `perf:` / `refactor:`. Scope optional (`feat(niagara): …`).
- The body explains **why**, not just what — and calls out any deliberate deviation from the plan with its rationale (never silently).
- AI-assisted work carries a `Co-Authored-By:` trailer for the model.

## Build discipline (how this project has been built)

Every milestone follows the same ritual, and it's worth keeping:

1. **Recon → written plan** committed first as "Step 0" — atomic commits enumerated, with acceptance criteria, and repo-layout deltas justified.
2. **Atomic commits** through the plan, each passing the full check set.
3. **Check-ins at phase boundaries** — a text summary of what landed, deviations, bundle/test deltas, and what's next; no progress check-ins *within* a phase except an ad-hoc one on an architectural contradiction.
4. At milestone close: a `docs(...)` commit recording build-adjustments in the milestone plan + a section in `docs/master-spec.md`, deferred items in `docs/m{N}-followups.md`, and an annotated tag (`v0.x.0-mN`).

See `docs/milestone-1.md` / `milestone-2.md` for worked examples (plan + the "Adjustments during the build" sections).

## Coverage ratchet

Every package with a coverage config carries floor thresholds that **only go up**.
A commit that touches a covered package runs that package's coverage and adds a
test in the same commit if it's near the floor — no fix-forward, no lowering a
threshold. As tests accrue, raise the bar. Full policy: `docs/master-spec.md` §13.
(Current gates: `schema-form` ≥90; `mcp-client` a regression floor; the newer
packages have tests but no gate yet — adding one is itself a follow-up.)

## Packaging

`pnpm --filter @mcp-studio/desktop pack` produces an unpacked app under
`apps/desktop/release/`; `dist` produces an installer / AppImage / dmg. Builds
are currently **unsigned** — no code signing or notarization yet (a later
milestone). `package.yml` runs the unsigned matrix on `v*` tags.
