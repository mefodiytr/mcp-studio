import { Command, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';

export function TabBar() {
  const { t } = useTranslation();
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-background px-2">
      <div className="flex h-7 items-center gap-2 rounded-md bg-accent px-3 text-sm text-accent-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden />
        {t('tabs.welcome')}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled
        title={t('tabs.newView')}
        aria-label={t('tabs.newView')}
      >
        <Plus />
      </Button>
      <div
        className="ml-auto flex select-none items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground"
        title={t('commandPalette.title')}
      >
        <Command className="size-3" aria-hidden />
        <span>K</span>
      </div>
    </div>
  );
}
