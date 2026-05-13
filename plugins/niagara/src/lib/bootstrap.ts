/**
 * Pure helpers for the user-context Bearer bootstrap (C57). See
 * `docs/milestone-3.md` §D4: at run time the plugin probes `tools/list` and
 * picks the best available provisioning path — a non-test tool when
 * niagaramcp later ships one, the existing test-gated `setupTestUser`
 * otherwise; if neither is present the command is disabled.
 */

export type BootstrapMode =
  | { kind: 'production'; toolName: 'provisionMcpUser' | 'rotateMcpToken' }
  | { kind: 'test'; toolName: 'setupTestUser' }
  | { kind: 'unavailable' };

/** Choose the bootstrap mode for a list of advertised tool names. Production
 *  paths win over the test-gated path so that a station which has *both* (a
 *  niagaramcp release with `provisionMcpUser` enabled *and* `enableTestSetup`
 *  on) picks the proper one. */
export function pickBootstrapMode(toolNames: readonly string[]): BootstrapMode {
  const has = new Set(toolNames);
  if (has.has('provisionMcpUser')) return { kind: 'production', toolName: 'provisionMcpUser' };
  if (has.has('rotateMcpToken')) return { kind: 'production', toolName: 'rotateMcpToken' };
  if (has.has('setupTestUser')) return { kind: 'test', toolName: 'setupTestUser' };
  return { kind: 'unavailable' };
}

/** Generate a 32-byte cryptographically-random token, hex-encoded (64 chars).
 *  Uses Web Crypto, available in any Electron renderer / modern Node 18+. */
export function generateBearerToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
