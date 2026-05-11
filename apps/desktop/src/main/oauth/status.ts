import type { OAuthArtifacts } from '@mcp-studio/mcp-client';

import type { OAuthStatus } from '../../shared/domain/auth';

/** Absolute access-token expiry (epoch ms), or null if unknown / not signed in. */
export function tokenExpiresAt(artifacts: OAuthArtifacts): number | null {
  const { tokens, tokensSavedAt } = artifacts;
  if (!tokens || tokens.expires_in == null || tokensSavedAt == null) return null;
  return tokensSavedAt + tokens.expires_in * 1000;
}

/** The redacted OAuth status for the renderer — no token material. */
export function oauthStatusFor(artifacts: OAuthArtifacts): OAuthStatus {
  if (!artifacts.tokens) return { state: 'signed-out', expiresAt: null, scope: null };
  const expiresAt = tokenExpiresAt(artifacts);
  const state = expiresAt != null && expiresAt <= Date.now() ? 'expired' : 'signed-in';
  return { state, expiresAt, scope: artifacts.tokens.scope ?? null };
}
