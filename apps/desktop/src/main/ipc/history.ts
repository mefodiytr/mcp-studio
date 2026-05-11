import type { ToolHistoryRepository } from '../store/tool-history-repository';
import { handle } from './index';

/** Wire the `history:*` IPC channels to the tool-call history. */
export function registerHistoryHandlers(history: ToolHistoryRepository): void {
  handle('history:list', () => ({ entries: history.list() }));
  handle('history:get', ({ id }) => ({ entry: history.get(id) ?? null }));
  handle('history:clear', () => {
    history.clear();
    return {};
  });
}
