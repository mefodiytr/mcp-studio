import type { CredentialVault } from '../store/credential-vault';
import type { ProfileRepository } from '../store/profile-repository';
import { handle } from './index';

/** Wire the `profiles:*` IPC channels to the repository (and purge the vault
 *  when a profile loses its secret-bearing auth or is deleted). Errors
 *  (validation, ProfileNotFoundError) propagate to the renderer's rejection. */
export function registerProfileHandlers(repo: ProfileRepository, vault: CredentialVault): void {
  handle('profiles:list', () => repo.list());
  handle('profiles:get', ({ id }) => repo.get(id));
  handle('profiles:create', ({ input }) => repo.create(input));
  handle('profiles:update', ({ id, input }) => {
    const updated = repo.update(id, input);
    if (updated.auth.method === 'none') vault.deleteSecret(id);
    return updated;
  });
  handle('profiles:delete', ({ id }) => {
    repo.delete(id);
    vault.deleteSecret(id);
    return { id };
  });
}
