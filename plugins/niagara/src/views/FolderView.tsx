import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, FileInput, Folder } from 'lucide-react';
import { cn } from '@mcp-studio/ui';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { Breadcrumbs } from '../components/Breadcrumbs';
import { listChildren, type NiagaraNode } from '../lib/niagara-api';
import { ordLeaf, ROOT_ORD, slotPath } from '../lib/ord';
import { sortNodes, type SortDir, type SortKey } from '../lib/sort';
import { useExplorerStore } from '../state/explorer-store';

/**
 * A flat, sortable listing of the selected component's children — Name / Type /
 * ORD columns, sourced from `listChildren` (depth 1, the same query the tree
 * uses, so the cache is shared). Clicking a folder drills into it (it becomes
 * the selection, so this view re-lists its children, and the tree expands down
 * to it); clicking a point just selects it. The breadcrumb walks back up.
 */
export function FolderView({ ctx }: { ctx: PluginContext }) {
  const selected = useExplorerStore((s) => s.selected);
  const reveal = useExplorerStore((s) => s.reveal);
  const select = useExplorerStore((s) => s.select);
  const remember = useExplorerStore((s) => s.remember);
  const ord = selected ?? ROOT_ORD;

  const navigate = (target: string): void => {
    reveal(target);
    ctx.setCwd(target);
  };
  const onRow = (node: NiagaraNode): void => {
    if (node.isPoint) {
      select(node.ord);
      ctx.setCwd(node.ord);
    } else {
      navigate(node.ord);
    }
  };

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const cycle = (key: SortKey): void =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const query = useQuery({
    queryKey: ['niagara', ctx.connection.connectionId, 'children', ord],
    queryFn: () => listChildren(ctx, ord),
  });
  useEffect(() => {
    if (query.data) remember(query.data);
  }, [query.data, remember]);
  const rows = useMemo(() => sortNodes(query.data ?? [], sort.key, sort.dir), [query.data, sort]);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumbs ord={ord} onNavigate={navigate} />
      <div className="min-h-0 flex-1 overflow-auto">
        {query.isPending ? (
          <p className="p-3 text-xs text-muted-foreground">Loading…</p>
        ) : query.isError ? (
          <p className="p-3 text-xs text-destructive">
            Couldn’t load children{query.error instanceof Error ? ` — ${query.error.message}` : ''}
          </p>
        ) : rows.length === 0 ? (
          <p className="p-3 text-xs italic text-muted-foreground">empty</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-xs text-muted-foreground">
                <Th label="Name" col="name" sort={sort} onSort={cycle} />
                <Th label="Type" col="type" sort={sort} onSort={cycle} />
                <Th label="ORD" col="ord" sort={sort} onSort={cycle} />
              </tr>
            </thead>
            <tbody>
              {rows.map((node) => {
                const isSelected = selected === node.ord;
                const Icon = node.isPoint ? FileInput : Folder;
                return (
                  <tr
                    key={node.ord}
                    onClick={() => onRow(node)}
                    title={node.ord}
                    className={cn('cursor-pointer border-b border-border/50 hover:bg-accent', isSelected && 'bg-accent')}
                  >
                    <td className="flex items-center gap-1.5 py-1 pl-2 pr-3">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{node.displayName || ordLeaf(node.ord)}</span>
                    </td>
                    <td className="py-1 pr-3 font-mono text-xs text-muted-foreground">{node.type}</td>
                    <td className="py-1 pr-2 font-mono text-xs text-muted-foreground">{slotPath(node.ord)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Th({
  label,
  col,
  sort,
  onSort,
}: {
  label: string;
  col: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (col: SortKey) => void;
}) {
  const active = sort.key === col;
  return (
    <th className="font-medium">
      <button type="button" onClick={() => onSort(col)} className="flex items-center gap-1 px-2 py-1.5 hover:text-foreground">
        {label}
        {active && (sort.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
      </button>
    </th>
  );
}
