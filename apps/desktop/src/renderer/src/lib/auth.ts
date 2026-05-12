import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { OAuthStatus } from '@shared/domain/auth';

function bridge(): NonNullable<typeof window.studio> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio;
}

const STATUS_KEY = (profileId: string): [string, string] => ['oauth-status', profileId];

/** The redacted OAuth status for a profile (signed-out / signed-in / expired
 *  + expiry + scope). No token material crosses the bridge. */
export function useOAuthStatus(profileId: string, enabled = true): UseQueryResult<OAuthStatus> {
  return useQuery({
    queryKey: STATUS_KEY(profileId),
    queryFn: () => bridge().invoke('oauth:status', { profileId }),
    enabled,
  });
}

/** Drop a profile's stored OAuth tokens + DCR client info; the next connect re-auths. */
export async function signOutOAuth(profileId: string): Promise<void> {
  await bridge().invoke('oauth:signOut', { profileId });
}

/** Hook returning a `signOut` that also refreshes the status query. */
export function useSignOutOAuth(): (profileId: string) => Promise<void> {
  const qc = useQueryClient();
  return async (profileId: string) => {
    await signOutOAuth(profileId);
    await qc.invalidateQueries({ queryKey: STATUS_KEY(profileId) });
  };
}

/** Invalidate a profile's OAuth-status query (call after a connect / sign-in). */
export function invalidateOAuthStatusKey(profileId: string): [string, string] {
  return STATUS_KEY(profileId);
}
