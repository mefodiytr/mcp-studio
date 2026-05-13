import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import type { PluginContext } from '@mcp-studio/plugin-api';
import { cn } from '@mcp-studio/ui';

import { Breadcrumbs } from '../components/Breadcrumbs';
import { componentIcon } from '../lib/component-icon';
import { listChildren, type NiagaraNode } from '../lib/niagara-api';
import { ROOT_ORD } from '../lib/ord';
import { useExplorerStore } from '../state/explorer-store';
import {
  AddExtensionDialog,
  CreateChildDialog,
  LinkSlotsDialog,
  NodeMenu,
  RemoveDialog,
  type ActionKind,
  type MenuAnchor,
} from './NodeActions';
import { QuickNav } from './QuickNav';

const INDENT_PX = 14;

/**
 * The Niagara station explorer: a breadcrumb bar over a lazily-loaded slot tree.
 * Children are fetched per node on expand (`listChildren`, React-Query-cached);
 * selecting a node publishes its ORD as the `{{cwd}}` templating value. Property
 * sheet / folder view / quick-nav layer on in later commits.
 */
export function ExplorerView({ ctx }: { ctx: PluginContext }) {
  const selected = useExplorerStore((s) => s.selected);
  const reveal = useExplorerStore((s) => s.reveal);
  const select = useExplorerStore((s) => s.select);

  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [action, setAction] = useState<{ kind: ActionKind; node: NiagaraNode } | null>(null);

  const navigate = (ord: string): void => {
    reveal(ord);
    ctx.setCwd(ord);
  };

  return (
    <div className="flex h-full flex-col">
      <Breadcrumbs ord={selected ?? ROOT_ORD} onNavigate={navigate} />
      <div role="tree" className="min-h-0 flex-1 overflow-auto py-1 text-sm">
        <NodeChildren
          ctx={ctx}
          parentOrd={ROOT_ORD}
          depth={0}
          onSelect={(ord) => {
            select(ord);
            ctx.setCwd(ord);
          }}
          onMenu={setMenu}
        />
      </div>
      <QuickNav ctx={ctx} />
      {menu && (
        <NodeMenu
          anchor={menu}
          onClose={() => setMenu(null)}
          onPick={(kind) => setAction({ kind, node: menu.node })}
        />
      )}
      {action?.kind === 'create' && (
        <CreateChildDialog ctx={ctx} node={action.node} open onOpenChange={(o) => !o && setAction(null)} />
      )}
      {action?.kind === 'addExtension' && (
        <AddExtensionDialog ctx={ctx} node={action.node} open onOpenChange={(o) => !o && setAction(null)} />
      )}
      {action?.kind === 'linkSlots' && (
        <LinkSlotsDialog ctx={ctx} node={action.node} open onOpenChange={(o) => !o && setAction(null)} />
      )}
      {action?.kind === 'remove' && (
        <RemoveDialog ctx={ctx} node={action.node} open onOpenChange={(o) => !o && setAction(null)} />
      )}
    </div>
  );
}

function NodeChildren({
  ctx,
  parentOrd,
  depth,
  onSelect,
  onMenu,
}: {
  ctx: PluginContext;
  parentOrd: string;
  depth: number;
  onSelect: (ord: string) => void;
  onMenu: (anchor: MenuAnchor) => void;
}) {
  const remember = useExplorerStore((s) => s.remember);
  const query = useQuery({
    queryKey: ['niagara', ctx.connection.connectionId, 'children', parentOrd],
    queryFn: () => listChildren(ctx, parentOrd),
  });
  useEffect(() => {
    if (query.data) remember(query.data);
  }, [query.data, remember]);

  const pad = { paddingLeft: depth * INDENT_PX + 22 };
  if (query.isPending) return <p style={pad} className="py-0.5 text-xs text-muted-foreground">Loading…</p>;
  if (query.isError) {
    return (
      <p style={pad} className="py-0.5 text-xs text-destructive">
        Couldn’t load children {query.error instanceof Error ? `— ${query.error.message}` : ''}
      </p>
    );
  }
  const children = query.data ?? [];
  if (children.length === 0) return <p style={pad} className="py-0.5 text-xs italic text-muted-foreground">empty</p>;
  return (
    <>
      {children.map((node) => (
        <TreeNode key={node.ord} ctx={ctx} node={node} depth={depth} onSelect={onSelect} onMenu={onMenu} />
      ))}
    </>
  );
}

function TreeNode({
  ctx,
  node,
  depth,
  onSelect,
  onMenu,
}: {
  ctx: PluginContext;
  node: NiagaraNode;
  depth: number;
  onSelect: (ord: string) => void;
  onMenu: (anchor: MenuAnchor) => void;
}) {
  const expanded = useExplorerStore((s) => s.expanded.has(node.ord));
  const isSelected = useExplorerStore((s) => s.selected === node.ord);
  const toggle = useExplorerStore((s) => s.toggle);
  const canExpand = !node.isPoint;

  return (
    <div role="treeitem" aria-selected={isSelected} aria-expanded={canExpand ? expanded : undefined}>
      <div
        onClick={() => onSelect(node.ord)}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu({ node, x: e.clientX, y: e.clientY });
        }}
        // Drag-source for the M4 live monitor — drop on the Monitor view's
        // body to add the row to the watch list. The MIME mirrors the host's
        // niagara plugin scope so a future host-level drop zone (the Watch
        // app-view, if extracted) can register the same type.
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-niagara-ord', node.ord);
          e.dataTransfer.setData('text/plain', node.ord);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        title={node.ord}
        className={cn(
          'flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:bg-accent',
          isSelected && 'bg-accent',
        )}
        style={{ paddingLeft: depth * INDENT_PX + 4 }}
      >
        {canExpand ? (
          <button
            type="button"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.ord);
            }}
            className="shrink-0 rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" aria-hidden />
        )}
        <NodeIcon node={node} expanded={expanded} />
        <span className="truncate">{node.displayName}</span>
        {node.type && <span className="ml-1 truncate text-xs text-muted-foreground">{node.type}</span>}
      </div>
      {canExpand && expanded && (
        <NodeChildren ctx={ctx} parentOrd={node.ord} depth={depth + 1} onSelect={onSelect} onMenu={onMenu} />
      )}
    </div>
  );
}

function NodeIcon({ node, expanded }: { node: NiagaraNode; expanded: boolean }) {
  const Icon = componentIcon({ type: node.type, isPoint: node.isPoint, expanded });
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}
