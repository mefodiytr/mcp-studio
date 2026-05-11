import { useTranslation } from 'react-i18next';

import { useIpcHealth } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';

const APP_VERSION = '0.1.0';

export function StatusBar() {
  const { t } = useTranslation();
  const ipc = useIpcHealth();

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t bg-sidebar px-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden />
        {t('status.notConnected')}
      </div>
      <div className="flex items-center gap-3">
        <span
          className="flex items-center gap-1.5"
          title={`IPC — ping ${ipc.pingMs ?? '—'} ms · last tick #${ipc.lastTickSeq ?? '—'}`}
        >
          <span
            className={cn('size-1.5 rounded-full', ipc.ok ? 'bg-emerald-500' : 'bg-muted-foreground')}
            aria-hidden
          />
          IPC
        </span>
        <span>{t('status.capabilities', { tools: 0, resources: 0, prompts: 0 })}</span>
        <span>v{APP_VERSION}</span>
      </div>
    </footer>
  );
}
