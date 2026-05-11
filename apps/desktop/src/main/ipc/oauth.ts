import { oauthStatusFor } from '../oauth/status';
import type { CredentialVault } from '../store/credential-vault';
import { handle } from './index';

/** Wire the `oauth:*` IPC channels. The renderer only ever sees the redacted
 *  status — tokens stay in the (encrypted) vault, main-side. */
export function registerOAuthHandlers(vault: CredentialVault): void {
  handle('oauth:status', ({ profileId }) => oauthStatusFor(vault.getOAuthArtifacts(profileId)));
  handle('oauth:signOut', ({ profileId }) => {
    // Best effort: drop the local copy. A dynamically-registered client at the
    // server becomes orphaned (servers expire unused DCR clients); calling the
    // RFC 7592 DELETE would need a re-discovery just to clean up — not worth it.
    vault.deleteOAuthArtifacts(profileId);
    return { profileId };
  });
}
