import { useTranslation } from 'react-i18next';

const APP_VERSION = '0.1.0';

export function StatusBar() {
  const { t } = useTranslation();
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t bg-sidebar px-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden />
        {t('status.notConnected')}
      </div>
      <div className="flex items-center gap-3">
        <span>{t('status.capabilities', { tools: 0, resources: 0, prompts: 0 })}</span>
        <span>v{APP_VERSION}</span>
      </div>
    </footer>
  );
}
