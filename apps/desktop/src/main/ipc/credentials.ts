import type { CredentialVault } from '../store/credential-vault';
import type { ProfileRepository } from '../store/profile-repository';
import { handle } from './index';

/**
 * Wire the `credentials:*` IPC channels. Secrets only ever flow *in* (from the
 * renderer to the vault); the only thing that flows back is the hint. The
 * protocol tap (C9) must skip / redact these channels.
 */
export function registerCredentialHandlers(repo: ProfileRepository, vault: CredentialVault): void {
  handle('credentials:set', ({ profileId, secret }) => {
    const profile = repo.get(profileId); // throws ProfileNotFoundError if absent
    if (profile.auth.method === 'none') {
      throw new Error(`Profile ${profileId} uses no auth — there is no secret to store`);
    }
    return { hint: vault.setSecret(profileId, secret) };
  });

  handle('credentials:hint', ({ profileId }) => ({ hint: vault.getHint(profileId) ?? null }));

  handle('credentials:clear', ({ profileId }) => {
    vault.deleteSecret(profileId);
    return { profileId };
  });
}
