# Milestone 1.5 — OAuth

A mini-milestone between M1 (Foundation) and M2 (Niagara plugin). Adds the
third auth method MCP defines: OAuth 2.1 + PKCE, with server-metadata discovery
and dynamic client registration. Bearer/header/none (M1) stay as they are.

## What we do vs. what the SDK does

`@modelcontextprotocol/sdk` already implements — and tests — the heavy parts:
the `auth()` orchestrator, PKCE generation, all three discovery flavors
(`.well-known/oauth-protected-resource` → `.well-known/oauth-authorization-server`
(RFC 8414) → `.well-known/openid-configuration`), `startAuthorization`,
`exchangeAuthorization`, `refreshAuthorization`, `registerClient` (RFC 7591 DCR),
RFC 8707 resource indicators, and the transports' `authProvider` loop (try token →
refresh → `redirectToAuthorization` + throw `UnauthorizedError` → caller calls
`transport.finishAuth(code)` → reconnect).

**We write:** an implementation of the SDK's `OAuthClientProvider` interface
backed by our vault + a redirect-capture mechanism (storage-agnostic so it's
unit-testable), the loopback redirect listener in main, the glue in
`ConnectionManager` (catch `UnauthorizedError` → await callback → `finishAuth` →
reconnect; handle refresh/re-auth), the wizard + sign-in/out UI, and an OAuth e2e.
We do **not** reimplement discovery/PKCE/DCR/exchange/refresh.

## Decisions resolved at kickoff (2026-05-11)

- **Flow:** OAuth 2.1 authorization-code + PKCE (S256) only. No implicit, no
  password grant, no `client_credentials`/non-interactive flows (not an MCP-server-
  auth scenario for a desktop client). Public client (`token_endpoint_auth_method:
  'none'`). Confidential clients (`client_secret`) accepted if a server hands one
  out via DCR or pre-registration, but not a design target.
- **Discovery + DCR:** use DCR when the server's authorization-server metadata
  advertises a `registration_endpoint`; otherwise fall back to a manually-entered
  pre-registered `client_id` (`auth: { method: 'oauth', scope?, clientId? }`). The
  wizard's `clientId` field is hidden until a first-connect discovery shows the
  server has no `registration_endpoint`, then it surfaces with an inline "this
  server requires a pre-registered client ID — paste it here" hint + an open-edit
  action. [C29]
- **Redirect mechanism: loopback** `http://127.0.0.1:<ephemeral>/callback` — a
  one-shot HTTP server per flow, bound to `127.0.0.1`, serves a "you can close
  this tab" page, auto-closes after the callback or a timeout. RFC 8252 §7.3;
  works in dev and packaged; what the SDK example uses. A random port (RFC 8252
  says auth servers must ignore the port on a loopback redirect URI). Authorize URL
  opened in the **system browser** (`shell.openExternal`), never an in-app
  `BrowserWindow`. (Custom URL scheme `mcpstudio://` is a possible follow-up for
  environments that block loopback listeners — see `docs/m1-followups.md`.)
- **Token storage: all OAuth artifacts in one credential-vault entry per profile**
  — access token, refresh token, DCR client info (`client_id`/`client_secret?`/
  `registration_access_token?`), and the discovered-metadata cache. `safeStorage`-
  encrypted, in main, never sent to the renderer (the renderer sees only a
  redacted status). One thing to wipe on "Sign out". `JsonStore` `schemaVersion`
  bump + `migrate()`. The PKCE code verifier stays in-memory in main, scoped to
  one pending flow, never persisted.
- **Refresh / re-auth UX:** proactive silent refresh at ~80% of token lifetime
  (if `expires_in=3600`, refresh ≈ 2880 s in) — a timer in `ConnectionManager` if
  the SDK doesn't do it itself. A mid-session 401 surfaces as an error with **no
  auto-retry**: the connection card / a toast says "Session expired — sign in
  again" with a re-auth action. No magic in-flight re-issue. [C30]
- **Refresh-then-reject guard:** if a refresh succeeds but the new access token is
  immediately rejected, do **not** loop refresh→reject→refresh — after one failed
  use-after-refresh, fall through to `redirectToAuthorization` (full re-auth). Max
  1 retry. [C28]
- **e2e: a test OAuth+MCP server + headless redirect** — stand up an
  auto-approving OAuth-protected MCP server (an SDK example if one fits, else a
  small one under `tests/fixtures/`) in Playwright global-setup; in test mode the
  app's `redirectToAuthorization` doesn't `shell.openExternal` — a single
  env-gated branch `fetch`es the authorize URL, the server auto-approves and 302s
  to our loopback, the flow completes headlessly. Exercises real discovery/DCR/
  exchange/refresh — just not the literal browser UI. Plus unit tests with a
  vault-backed provider for discovery-URL building, token-endpoint parsing, and
  refresh edge cases (new vs. unchanged `refresh_token`, error-response shapes).
  [C31]
- **Custom `fetch` for OAuth calls:** if the SDK lets a `fetchFn` be threaded
  through the provider/transport for the OAuth HTTP calls, pass ours through so
  the protocol inspector can tap them later; if not, leave it for now. [C30]
- **Version tag after C32:** `v0.1.5-m1.5` (milestone-explicit numbering until 1.0).

## Commits (C25 → C32)

Same per-commit gate as M1: `pnpm lint` + `pnpm -r typecheck` + `pnpm -r test` +
`pnpm --filter @mcp-studio/desktop build` + `pnpm test:e2e` all green. Atomic,
conventional-commits prefix, `Co-Authored-By` trailer.

> Step 0 — `docs: M1.5 plan` (this file).

### C25 — `feat(mcp-client): OAuthClientProvider over a pluggable store`

Implement the SDK's `OAuthClientProvider` against injected `load`/`save` callbacks
(storage-agnostic; the desktop app wires it to the vault, tests to an in-memory
store): `redirectUrl`, `clientMetadata` (`client_name`, `redirect_uris`,
`grant_types: ['authorization_code', 'refresh_token']`, `token_endpoint_auth_method:
'none'`, `scope`), `clientInformation()`/`saveClientInformation()`,
`tokens()`/`saveTokens()`, `redirectToAuthorization(url)` (delegates to an injected
hook), `saveCodeVerifier()`/`codeVerifier()`, `state()`, `invalidateCredentials(scope)`.
Thread `authProvider` into `Connection.create` when the transport config requests
OAuth. If `Connection.create`/the SDK exposes a `fetchFn` hook for the OAuth calls,
plumb it through.
**AC:** unit tests cover load/save round-trips per artifact, `invalidateCredentials`
clearing the right scopes (`all`/`client`/`tokens`/`verifier`/`discovery`), the
`redirectToAuthorization` hook firing with the right URL, and `clientMetadata`
shape; `Connection` accepts an `authProvider` and uses it on an OAuth transport.

### C26 — `feat: OAuth loopback redirect listener`

`apps/desktop/src/main/oauth/redirect.ts`: `startLoopbackRedirect()` →
`{ redirectUri: string, waitForCallback(): Promise<{ code: string; state?: string }>, close() }`
— a one-shot `http.createServer` on an ephemeral port bound to `127.0.0.1`,
matching `/callback`, parsing `?code=&state=` (and `?error=&error_description=`),
serving a minimal "authentication complete — you can close this tab" page,
auto-closing on the first callback or after a timeout (≈3 min). `shell.openExternal`
for the authorize URL. Single-flow at a time (queue or reject overlapping flows).
**AC:** an integration test hits the listener with a fake `?code=&state=` and gets
the resolved values; an `?error=` callback rejects with the error; the server is
closed afterward; a timeout rejects cleanly; the chosen port is free.

### C27 — `feat: OAuth token + client-registration vault`

Extend `CredentialVault` with an OAuth blob per profile (`{ tokens?, clientInfo?,
metadata? }`), `schemaVersion` bump + `migrate()`. `oauth:status` IPC →
`{ state: 'signed-out' | 'signed-in' | 'expired', expiresAt?: number, scope?: string }`
(no token material). `oauth:signOut` IPC → clears the blob (and, if there's a
`registration_access_token` and a registration endpoint, best-effort `DELETE` the
DCR client — but never block on it).
**AC:** save→load→clear round-trip; the renderer-facing status carries no token or
client-secret material; migrate handles a vault that predates the OAuth shape.

### C28 — `feat: connect-with-OAuth in the connection manager`

When a profile's `auth.method === 'oauth'`, build the `Connection` with the
vault-backed `OAuthClientProvider`. On `UnauthorizedError` from `connect`: the SDK
has already called `redirectToAuthorization` → `startLoopbackRedirect` is in flight
→ await its callback → `transport.finishAuth(code)` → reconnect. Surface the states
in `ConnectionSummary`: `signing-in` / `auth-required` / `connected` / `error`.
**The refresh-then-reject guard:** track one "used a freshly-refreshed token and it
401'd" flag per connect attempt; on hitting it, drop the tokens and go to full
re-auth instead of refreshing again — max 1 retry, never a loop. A mid-session 401
marks the connection errored with `auth-required` (no auto-retry — see C30).
**AC:** state machine covered — (a) provider has a valid token → connects directly;
(b) no tokens → redirect→callback→`finishAuth`→connect; (c) expired but refreshable
→ refreshes silently, connects; (d) refresh fails → redirect→callback→connect;
(e) refresh succeeds but the new token is immediately rejected → exactly one retry,
then redirect (no loop); (f) mid-session 401 → errored + `auth-required`, no retry.

### C29 — `feat: OAuth in the wizard + sign-in/out UI`

`auth: { method: 'oauth'; scope?: string; clientId?: string }` in the profile
schema. The wizard's OAuth section: an optional `scope` field, and a `clientId`
field that is **hidden by default**; after a first connect whose discovery shows no
`registration_endpoint`, the wizard (re-opened to edit) shows it with an inline
"this server doesn't support automatic registration — paste your pre-registered
client ID here" hint. A "Sign in" / "Sign out" action on the connection card + a
command-palette command ("Sign in to {server}" / "Sign out of {server}"), driven by
`oauth:status` / `oauth:signOut` and a `connections:connect` that triggers the auth
flow.
**AC:** create an OAuth profile, connect → the system browser opens (or, in test
mode, the headless hook fires) → after auth the card shows "Signed in (expires in
…)"; "Sign out" clears it and the card shows "Sign in required"; a server without
DCR shows the client-ID hint on edit.

### C30 — `feat: OAuth-aware status, proactive refresh, and re-auth UX`

Show token expiry on the connection card (countdown / "expires in 12 m"). A timer
in `ConnectionManager` refreshes at ~80 % of token lifetime (skip if the SDK
already does proactive refresh). A mid-session 401 → "Session expired — sign in
again" toast + a re-auth action (no auto-retry). The protocol inspector shows the
OAuth round-trips (discovery + token calls) — if a `fetchFn` hook was threaded
through in C25, tap it; otherwise log them via the same ring buffer with a
synthetic-event flag.
**AC:** an expired-but-refreshable token refreshes without user interaction before
it expires; a dead session shows the re-auth prompt and does not auto-retry; the
inspector (or log) shows the `.well-known` discovery requests and the token
endpoint exchange.

### C31 — `test: OAuth e2e + unit coverage; raise the mcp-client floor`

`tests/fixtures/oauth-server/` (or the SDK example, if one fits) — a tiny
auto-approving OAuth-protected MCP server. Playwright global-setup starts it; the
e2e adds an OAuth profile pointing at it → connect → the test-mode
`redirectToAuthorization` hook drives the authorize→callback hop headlessly →
asserts "Signed in", lists a tool, invokes it, asserts the inspector shows a token
exchange. Plus `mcp-client` unit tests for discovery-URL building, token-endpoint
parsing, and refresh edge cases (new vs. unchanged `refresh_token`, several
error-response shapes). Raise the `mcp-client` coverage floor now that the provider
+ auth paths are tested.
**AC:** `pnpm test:e2e` green and flake-free ×3; the e2e covers add-OAuth-profile →
sign-in → invoke → inspect-token-exchange; `mcp-client` coverage floor raised; CI
unchanged in shape (it already runs e2e).

### C32 — `feat: OAuth polish + master-spec auth section`

Tie-up: edge-case handling surfaced during C25–C31 (e.g. discovery 404 vs. malformed
metadata vs. auth-server unreachable, all distinct messages); a `master-spec.md`
§-auth subsection documenting the M1.5 auth model; `docs/m1-followups.md` updated
(custom-URL-scheme option, confidential-client polish, anything deferred).
**AC:** the suite is green; the spec has the auth section; tag `v0.1.5-m1.5`.

> Split candidates: C28 (the state machine) could become C28a "connect/refresh"
> + C28b "re-auth/finishAuth" if it grows. C29 could split wizard vs. sign-in/out
> action. C31 could split e2e vs. unit-coverage.

## Repo structure deltas (vs. M1)

- `apps/desktop/src/main/oauth/` — `redirect.ts` (loopback listener), `provider.ts`
  (the vault-backed `OAuthClientProvider`, or it lives in `mcp-client` with the
  vault wired in `main` — decide in C25/C27). New `oauth:*` IPC channels.
- `packages/mcp-client/src/oauth.ts` (or `auth.ts`) — the storage-agnostic
  `OAuthClientProvider` implementation + the `Connection` integration.
- `apps/desktop/src/shared/domain/auth.ts` — the `oauth` auth-method schema, the
  redacted-status schema.
- `tests/fixtures/oauth-server/` — the auto-approving test auth+MCP server (a
  workspace package, like the planned reference-server fixture).
- A small env-gated test hook in `redirectToAuthorization` (production code, one
  branch).

## Ad-hoc check-in triggers (otherwise continue C25 → C32 without check-ins)

Stop and check in only if:

1. The SDK's OAuth API turns out materially different from this recon (e.g. the
   transports don't take an `authProvider`, or the `OAuthClientProvider` signature
   diverged) — the recon was off `.d.ts` files, the runtime may surprise.
2. The loopback listener collides with Windows Firewall (or another OS) in a
   non-obvious way that needs a design change.
3. DCR + the pre-registered-client-ID fallback interact with the state machine
   such that a genuinely new branch appears (e.g. DCR-attempted-then-failed →
   fall back to a manual client ID *mid-flow*, not just on a fresh connect).

Otherwise: note-and-continue, surface it in the big check-in.

## Build adjustments (after kickoff)

Refinements that surfaced during C25–C32 — recorded so this plan matches what
actually shipped:

- **No `response_types` in the registration metadata** [C25]. The SDK sets
  `response_type=code` in the authorize-URL builder anyway; including it in
  `clientMetadata` only risked an excess-property type error against the SDK's
  schema. Follow the SDK, not the doc.
- **No discovered-metadata caching** [C25]. The SDK's `OAuthClientProvider` has no
  `saveMetadata`/`metadata()` hook — it re-discovers each `auth()` call (two cheap
  `GET`s, cacheable at the HTTP layer). `OAuthArtifacts = { tokens?, tokensSavedAt?,
  clientInfo? }` is the minimal sufficient shape.
- **The wizard's `clientId` field is shown whenever `oauth` is selected** [C29],
  with a hint, rather than hidden-until-a-first-connect-shows-no-`registration_
  endpoint`. Simpler, and the connect error mentions registration so the user
  knows to fill it. The hidden-then-surfaced refinement is a follow-up.
- **No dedicated proactive-refresh-at-~80%-lifetime timer** [C30]. The SDK's
  transport transparently refreshes-and-retries on a 401 (so user requests never
  fail), and the existing 15 s latency ping triggers a refresh promptly after
  expiry — OAuth connections stay alive seamlessly. A true proactive refresh would
  risk popping the browser if the refresh token's been revoked (the "surprising
  UX" we want to avoid) or need a reimplemented discovery+refresh chain with a
  no-redirect guard — out of scope; a follow-up. The displayed expiry is kept
  fresh by re-reading the vault on each poll.
- **The protocol inspector doesn't yet show the OAuth `.well-known`/token round-
  trips** [C30]. The transport *does* accept a custom `fetch` it forwards to the
  SDK's `auth()`, so it's tappable — but surfacing non-JSON-RPC HTTP events needs a
  new protocol-event variant + tap method + inspector rendering. A follow-up.
- **No new `mcp-client` unit tests in C31; the OAuth handshake is covered by the
  e2e instead** [C31]. `mcp-client` doesn't reimplement discovery / token parsing /
  refresh (the SDK does), so unit-testing those would test the SDK. The
  `mcp-client` floor was nudged to 78/60/78/80 anyway (actual ~80/87/66/80).
- **The OAuth e2e runs the SDK's own `examples/server/simpleStreamableHttp.js
  --oauth`** (its `DemoInMemory` auth provider auto-approves and supports DCR) on
  free ports, rather than a self-rolled `tests/fixtures/oauth-server/` — the SDK's
  example is exactly the test server we'd have written. A `MCPSTUDIO_OAUTH_AUTOAPPROVE`
  env hook makes `redirectToAuthorization` complete the flow headlessly.

See `docs/m1-followups.md` → "M1.5 / OAuth follow-ups" for the deferred items.
