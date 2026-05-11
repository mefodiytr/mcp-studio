import type { ProfileRepository } from '../store/profile-repository';
import { handle } from './index';

/** Wire the `profiles:*` IPC channels to the repository. Errors (validation,
 *  ProfileNotFoundError) propagate to the renderer's `invoke` rejection. */
export function registerProfileHandlers(repo: ProfileRepository): void {
  handle('profiles:list', () => repo.list());
  handle('profiles:get', ({ id }) => repo.get(id));
  handle('profiles:create', ({ input }) => repo.create(input));
  handle('profiles:update', ({ id, input }) => repo.update(id, input));
  handle('profiles:delete', ({ id }) => {
    repo.delete(id);
    return { id };
  });
}
