import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { ToolHistoryEntry } from '@shared/domain/tool-history';

const HISTORY_KEY = ['history'] as const;

/** The recorded tool invocations (most recent first), kept fresh via the
 *  `history:changed` event. */
export function useHistory(): UseQueryResult<ToolHistoryEntry[]> {
  const qc = useQueryClient();
  useEffect(
    () => window.studio?.on('history:changed', () => void qc.invalidateQueries({ queryKey: HISTORY_KEY })),
    [qc],
  );
  return useQuery({
    queryKey: HISTORY_KEY,
    queryFn: async () => (window.studio ? (await window.studio.invoke('history:list', {})).entries : []),
  });
}

export async function clearHistory(): Promise<void> {
  await window.studio?.invoke('history:clear', {});
}
