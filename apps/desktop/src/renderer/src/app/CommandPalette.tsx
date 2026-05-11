import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@renderer/lib/theme';

interface PaletteItem {
  label: string;
  run: () => void;
}

/**
 * Command-palette mount point. C21 replaces the body with a cmdk-powered
 * fuzzy palette that aggregates view-contributed commands; for now this is a
 * minimal Ctrl/⌘+K modal with the few commands that already work, so the
 * keybinding and surface exist from day one.
 */
export function CommandPalette() {
  const { t } = useTranslation();
  const { cycleTheme } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!open) return null;

  const items: PaletteItem[] = [
    { label: t('commandPalette.toggleTheme'), run: cycleTheme },
    { label: t('commandPalette.reloadWindow'), run: () => window.location.reload() },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
      role="presentation"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
        role="dialog"
        aria-label={t('commandPalette.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          placeholder={t('commandPalette.placeholder')}
          className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <ul className="max-h-72 overflow-auto p-1">
          {items.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  item.run();
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t('commandPalette.note')}</p>
      </div>
    </div>
  );
}
