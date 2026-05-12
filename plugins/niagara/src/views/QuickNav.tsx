import { useEffect, useMemo, useState } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@mcp-studio/ui';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { slotPath } from '../lib/ord';
import { useExplorerStore } from '../state/explorer-store';

/**
 * The explorer's quick-navigation palette: a fuzzy picker over every component
 * the tree has loaded so far (`useExplorerStore.known`). Picking one reveals it
 * in the tree (expands its ancestors, selects it) and publishes its ORD as
 * `{{cwd}}`. Opened by Ctrl/Cmd+P while the Explorer view is mounted. Scope is
 * the local cache by design — a server-backed search (`findComponentsByType`
 * &c.) is a follow-up; so is surfacing this as a host palette command (needs a
 * host-level place to mount the dialog independent of the active view).
 */
export function QuickNav({ ctx }: { ctx: PluginContext }) {
  const [open, setOpen] = useState(false);
  const known = useExplorerStore((s) => s.known);
  const reveal = useExplorerStore((s) => s.reveal);

  // Ctrl/Cmd+P opens the palette (browsers map it to Print — swallow that).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const items = useMemo(
    () =>
      Array.from(known.values())
        .filter((n) => n.ord)
        .sort((a, b) => a.ord.localeCompare(b.ord)),
    [known],
  );

  const go = (ord: string): void => {
    reveal(ord);
    ctx.setCwd(ord);
    setOpen(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Go to component"
      description="Search the loaded station components by name or ORD."
    >
      <CommandInput placeholder="Go to component by name or ORD…" />
      <CommandList>
        <CommandEmpty>
          {items.length === 0 ? 'Expand the tree to populate the index.' : 'No matching component.'}
        </CommandEmpty>
        <CommandGroup heading="Components">
          {items.map((node) => (
            <CommandItem key={node.ord} value={`${node.displayName} ${node.ord}`} onSelect={() => go(node.ord)}>
              <span className="truncate">{node.displayName}</span>
              <span className="ml-auto truncate pl-3 font-mono text-xs text-muted-foreground">{slotPath(node.ord)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
