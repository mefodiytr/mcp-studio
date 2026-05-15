# Contributing

MCP Studio is a proprietary, single-author project for now (see [`LICENSE`](LICENSE));
community contributions aren't actively solicited until a post-1.0 license
decision. This file documents the working conventions so the codebase stays
coherent — and so a future contributor (or future me) can pick up the rhythm.

## Repo language: English only

All source, comments, identifiers, commit messages, PR/issue text, and project
docs are **English**. One deliberate exception: `tests/fixtures/niagara-mock/*.json`
preserves real niagaramcp wire data verbatim (Russian tool descriptions
included — that's the point of a fixture). Don't translate it.

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

## Canonical pitfalls (lessons surfaced during the build)

- **Zustand selectors returning a derived collection MUST stabilise the
  empty case** (M3 C55 / M4 C65). A selector like `(s) => s.queues.get(id)
  ?? []` returns a fresh `[]` per render in the no-entry case; Zustand's
  default `Object.is` equality sees a change every render → React #185
  infinite loop. Fix: a module-level `const EMPTY: readonly T[] = []`
  singleton returned by the no-entry branch.
- **React Query `useEffect` deps on the query result reference don't fire
  on flat-signal polls** (M4 C68a). `useEffect(..., [q.data])` won't
  re-run when the polled value is identical (RQ memoises the reference).
  Key on `[q.dataUpdatedAt, value]` instead — `dataUpdatedAt` bumps every
  fetch regardless of value identity.
- **e2e assertions: assert on operator-visible outcomes, not transient
  envelope text** (M5 C77). The strict-mode locator collisions during
  C77 traced back to relying on text that exists in two places (a
  transient "Calling X…" streaming card + the persisted ToolCallEnvelope)
  or in a collapsed-by-default block (tool_result inside an envelope).
  Discipline: assert on the **persisted, operator-visible** outcome —
  the queue's state in the Changes view, the audit entry in the History
  panel, the badge in the UI — never on intermediate UI text that may be
  collapsed, re-rendered, or surface in multiple spots.
- **`useQuery` inside `.map()` violates rules-of-hooks for
  dynamic-length series** (M4 C64). Use `useQueries` from React Query
  for the dynamic-length case; ordinary `useQuery` only inside fixed-
  shape components.
- **Tool-argument substitution must preserve typed values for
  whole-token args** (M6 C82 — `substituteValue` invariant). When
  substituting `${var.path}` into structured tool-call args, a
  *whole-token* input string (`"${param.limit}"` standalone) returns
  the bound typed value (e.g. `5` not `"5"`); a *mixed-form* input
  (`"ord-${param.suffix}"`) interpolates as a string. Wrong
  implementation — stringifying everything — breaks tool schemas
  that expect typed args (most niagaramcp tools take `limit:
  integer`, `force: boolean`, `points: array`, etc.) and the SDK's
  zod validator rejects the call. Future plugin authors writing
  similar substitution helpers (M8 visual flow builder editing flow
  step args interactively will be the next consumer) hit the same
  correctness requirement; the `substituteValue` helper in
  `@mcp-studio/plugin-api` is the canonical implementation.
- **Race-against-a-hard-cap: trigger background work N samples
  before the limit so latency variance is absorbed by the buffer**
  (M6 C86 — summarise-then-drop). The conversation cap is 200 messages
  (M5 D3 silent-drop safety net); the M6 summariser triggers at 180,
  not at 200. Why: an async summary call takes 1–3 seconds; if we
  fired at the hard cap, every new turn during that window would
  either block on the call or land past the cap (the silent-drop
  takes over). Triggering 20 samples before the cap gives runway —
  Haiku-fast completes seamlessly, slow falls back gracefully via the
  hard-cap silent-drop. The pattern generalises: any background async
  work that *must* complete before a hard limit (M7 RAG embedding
  generation before context-window pressure; M8 flow scheduling before
  the execution window) picks a trigger threshold that absorbs the
  call's worst-case latency without colliding with the cap.
- **Graceful degradation on background LLM-call failure: fall back
  to a deterministic baseline + surface a warning chip, never block
  the primary user interaction** (M6 C86 — summariser fallback).
  When the summariser call returns null (provider error, abort,
  whitespace-only output), the head slice is silently dropped (the
  M5 baseline behaviour) and a chip is rendered in the chat header
  ("Summary unavailable — older messages dropped"). The operator
  still sends the next turn — the failure is observable but never
  a blocker. Same shape applies to future LLM-flavoured background
  work: M7 RAG retrieval failure → fall back to no retrieval +
  surface a chip; M8 scheduled flow startup failure → fall back to
  manual launch + surface a chip. Pattern stays consistent:
  `runX → Promise<XResult | null>` (never throws); caller branches
  on null → silent baseline + chip; success → chip cleared.

## Cross-view explorer state (`useExplorerStore.known` contract)

The Niagara plugin's `useExplorerStore` (lives in
`plugins/niagara/src/state/explorer-store.ts`) is a module-global Zustand
store. Its `known: ReadonlyMap<string, NiagaraNode>` cache is consumed
by five+ surfaces and worth formalising:

**Semantics.** Every node the operator has ever loaded in the explorer
tree (via `listChildren`) lands in `known` keyed by ord. The cache is
session-scoped — never persisted, never evicted. Map grows monotonically
until the renderer reloads. Acceptable today (Niagara stations cap at
~thousands of components; tens of MB max).

**How to register a newly-encountered ord.** Call
`useExplorerStore.getState().remember([node])` from your view when you
receive a fresh `NiagaraNode` shape outside the tree-load path (e.g. a
search result, a property-sheet drill-down, a watch-list add). The
helper walks `children?` recursively, so passing the root of a fetched
sub-tree records every descendant. Don't write to `known` directly.

**Consumers (M2 → M6).** Five today; threshold reached for formalising
the contract:
1. **QuickNav (Ctrl+P fuzzy picker)** — reads every known ord for
   the fuzzy match list (M2).
2. **HistoryView overlay picker** — operator picks an ord from the
   "known components" overlay to plot history (M4).
3. **MonitorView displayName lookup** — drag-target labels resolved
   from the cache (M4).
4. **Selection-aware diagnostic flows** — Explorer publishes the
   currently-selected node's `displayName` (resolved from `known`)
   onto `useHostBus.selectedOrd` so the chat empty state + command
   palette can decorate diagnostic-flow buttons "on `AHU-1`" (M6
   C87 — this commit).
5. **Future:** M7 RAG-on-selection ("answer about THIS node"),
   M8 visual flow builder's ord-picker autocomplete — same cache.

**Cross-plugin reach.** The `known` map is plugin-local (host can't
import it without inverting the dependency direction). Cross-plugin
consumers (the chat empty state, the command palette) read selection
state via `useHostBus.selectedOrd` — the Explorer publishes
`{ord, displayName}` derived from `known` whenever its `selected`
changes (or null on unmount). State-channel shape, not event-channel:
the bus is the read-anytime source of truth, not a one-shot trigger.

**Eviction is future.** If a 50k-component station shows up that
matters, eviction is m1-followup work (an LRU cap on `known` with
explicit eviction on `forget(ord)`). Not blocking M6.

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
