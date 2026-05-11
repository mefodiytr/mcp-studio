import { Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';

export function WelcomeView() {
  const { t } = useTranslation();
  const versions = window.studio?.versions;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-10 text-center">
      <div className="flex size-16 select-none items-center justify-center rounded-xl bg-primary text-2xl font-bold text-primary-foreground">
        M
      </div>

      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold">{t('welcome.title')}</h1>
        <p className="max-w-md text-muted-foreground">{t('app.tagline')}</p>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-8 py-6 text-card-foreground">
        <p className="text-sm text-muted-foreground">{t('welcome.noConnection')}</p>
        <Button disabled title={t('welcome.connectSoon')}>
          <Plug />
          {t('welcome.connectCta')}
        </Button>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="font-medium uppercase tracking-wide">{t('welcome.milestone')}</p>
        <p>{t('welcome.shellReady')}</p>
        {versions && (
          <p>
            Electron {versions['electron']} · Chromium {versions['chrome']} · Node {versions['node']}
          </p>
        )}
      </div>
    </div>
  );
}
