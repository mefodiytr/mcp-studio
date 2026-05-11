import {
  Activity,
  Braces,
  Files,
  History,
  MessageSquare,
  Monitor,
  Moon,
  Server,
  Settings,
  Sun,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { useTheme, type Theme } from '@renderer/lib/theme';
import { cn } from '@renderer/lib/utils';

export type AppView = 'connections' | 'tools' | 'resources' | 'prompts' | 'history' | 'raw';

const NAV_ITEMS: { key: string; Icon: typeof Server; view?: AppView }[] = [
  { key: 'servers', Icon: Server, view: 'connections' },
  { key: 'tools', Icon: Wrench, view: 'tools' },
  { key: 'resources', Icon: Files, view: 'resources' },
  { key: 'prompts', Icon: MessageSquare, view: 'prompts' },
  { key: 'history', Icon: History, view: 'history' },
  { key: 'raw', Icon: Braces, view: 'raw' },
];

const THEME_ICON: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

export function LeftRail({
  view,
  onSelect,
  inspectorOpen,
  onToggleInspector,
}: {
  view: AppView;
  onSelect: (view: AppView) => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}) {
  const { t } = useTranslation();
  const { theme, cycleTheme } = useTheme();
  const ThemeIcon = THEME_ICON[theme];

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2 text-sidebar-foreground">
      <div className="mb-1 flex size-9 select-none items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
        M
      </div>

      {NAV_ITEMS.map(({ key, Icon, view: itemView }) => {
        const active = itemView === view;
        return (
          <Button
            key={key}
            variant="ghost"
            size="icon"
            title={t(`nav.${key}`)}
            aria-label={t(`nav.${key}`)}
            aria-current={active ? 'page' : undefined}
            onClick={itemView !== undefined ? () => onSelect(itemView) : undefined}
            className={cn(active && 'bg-sidebar-accent text-sidebar-accent-foreground')}
          >
            <Icon />
          </Button>
        );
      })}

      <Button
        variant="ghost"
        size="icon"
        title={`${t('nav.inspector')}  (Ctrl+\`)`}
        aria-label={t('nav.inspector')}
        aria-pressed={inspectorOpen}
        onClick={onToggleInspector}
        className={cn(inspectorOpen && 'bg-sidebar-accent text-sidebar-accent-foreground')}
      >
        <Activity />
      </Button>

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
