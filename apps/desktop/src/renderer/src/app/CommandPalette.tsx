import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@renderer/components/ui/command';
import type { Command } from '@renderer/lib/commands';

const RECENTS_KEY = 'mcp-studio.command-recents';
const MAX_RECENTS = 8;

function loadRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The `Ctrl/⌘+K` command palette: a cmdk-powered fuzzy list over the commands
 * the shell builds (`useAppCommands`), with a "Recent" group persisted to
 * localStorage. Escape and a second Ctrl+K close it.
 */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>(loadRecents);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const visible = useMemo(() => commands.filter((c) => c.when !== false), [commands]);

  const { recentCommands, grouped } = useMemo(() => {
    const byId = new Map(visible.map((c) => [c.id, c]));
    const recentIds = new Set(recents.filter((id) => byId.has(id)));
    const recentCmds = recents.map((id) => byId.get(id)).filter((c): c is Command => Boolean(c));
    const groups = new Map<string, Command[]>();
    for (const c of visible) {
      if (recentIds.has(c.id)) continue;
      const arr = groups.get(c.group) ?? [];
      arr.push(c);
      groups.set(c.group, arr);
    }
    return { recentCommands: recentCmds, grouped: [...groups.entries()] };
  }, [visible, recents]);

  const run = (command: Command): void => {
    setOpen(false);
    setRecents((prev) => {
      const next = [command.id, ...prev.filter((id) => id !== command.id)].slice(0, MAX_RECENTS);
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* localStorage unavailable — recents are best-effort */
      }
      return next;
    });
    void command.run();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t('commandPalette.title')}
      description={t('commandPalette.placeholder')}
    >
      <CommandInput placeholder={t('commandPalette.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('commandPalette.empty')}</CommandEmpty>
        {recentCommands.length > 0 && (
          <>
            <CommandGroup heading={t('commandPalette.recents')}>
              {recentCommands.map((c) => (
                <CommandItem key={c.id} value={`${c.title} ${c.keywords ?? ''}`} onSelect={() => run(c)}>
                  {c.title}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        {grouped.map(([group, cmds]) => (
          <CommandGroup key={group} heading={group}>
            {cmds.map((c) => (
              <CommandItem key={c.id} value={`${c.title} ${c.keywords ?? ''}`} onSelect={() => run(c)}>
                {c.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
