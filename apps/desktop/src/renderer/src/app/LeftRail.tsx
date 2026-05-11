import { Activity, Files, MessageSquare, Monitor, Moon, Server, Settings, Sun, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { useTheme, type Theme } from '@renderer/lib/theme';
import { cn } from '@renderer/lib/utils';

const NAV_ITEMS = [
  { key: 'servers', Icon: Server, enabled: true },
  { key: 'tools', Icon: Wrench, enabled: false },
  { key: 'resources', Icon: Files, enabled: false },
  { key: 'prompts', Icon: MessageSquare, enabled: false },
  { key: 'inspector', Icon: Activity, enabled: false },
] as const;

const THEME_ICON: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export function LeftRail() {
  const { t } = useTranslation();
  const { theme, cycleTheme } = useTheme();
  const ThemeIcon = THEME_ICON[theme];

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2 text-sidebar-foreground">
      <div className="mb-1 flex size-9 select-none items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
        M
      </div>

      {NAV_ITEMS.map(({ key, Icon, enabled }) => (
        <Button
          key={key}
          variant="ghost"
          size="icon"
          disabled={!enabled}
          title={t(`nav.${key}`)}
          aria-label={t(`nav.${key}`)}
          aria-current={enabled ? 'page' : undefined}
          className={cn(enabled && 'bg-sidebar-accent text-sidebar-accent-foreground')}
        >
          <Icon />
        </Button>
      ))}

      <div className="mt-auto flex flex-col items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={cycleTheme}
          title={`${t('theme.label')}: ${t(`theme.${theme}`)}`}
          aria-label={t('theme.label')}
        >
          <ThemeIcon />
        </Button>
        <Button variant="ghost" size="icon" disabled title={t('nav.settings')} aria-label={t('nav.settings')}>
          <Settings />
        </Button>
      </div>
    </nav>
  );
}
