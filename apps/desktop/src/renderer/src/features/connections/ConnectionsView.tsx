import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plug, Server, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { connectProfile, disconnectConnection, fetchTools, useConnections } from '@renderer/lib/connections';
import type { ConnectionSummary, ToolSummary } from '@shared/domain/connection';

const DEV_PROFILE_NAME = 'server-everything (dev)';

async function ensureDevProfileId(): Promise<string> {
  const bridge = window.studio;
  if (!bridge) throw new Error('IPC bridge unavailable');
  const existing = (await bridge.invoke('profiles:list', {})).find((p) => p.name === DEV_PROFILE_NAME);
  if (existing) return existing.id;
  const created = await bridge.invoke('profiles:create', {
    input: {
      transport: 'stdio',
      command: 'mcp-server-everything',
      args: ['stdio'],
      name: DEV_PROFILE_NAME,
      auth: { method: 'none' },
    },
  });
  return created.id;
}

export function ConnectionsView() {
  const { t } = useTranslation();
  const connections = useConnections();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoConnected = useRef(false);

  const connectDevServer = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await connectProfile(await ensureDevProfileId());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  // Dev-harness convenience: auto-connect a server-everything profile on first
  // mount if nothing is connected. Scaffolding — the real flow is the C10
  // connection wizard plus the rail (C22).
  useEffect(() => {
    if (autoConnected.current || connections.length > 0) return;
    autoConnected.current = true;
    void connectDevServer();
  }, [connections.length, connectDevServer]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{t('connections.title')}</h1>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void connectDevServer()}>
          {busy ? <Loader2 className="animate-spin" /> : <Plug />}
          {t('connections.connectDev')}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {connections.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center text-muted-foreground">
          <Server className="size-10" aria-hidden />
          <p>{t('connections.empty')}</p>
          <div className="space-y-0.5 text-xs">
            <p className="font-medium uppercase tracking-wide">{t('connections.proofOfLife')}</p>
            <p>{t('app.tagline')}</p>
            {window.studio?.versions['electron'] && (
              <p>
                Electron {window.studio.versions['electron']} · Chromium {window.studio.versions['chrome']} · Node{' '}
                {window.studio.versions['node']}
              </p>
            )}
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {connections.map((connection) => (
            <ConnectionCard key={connection.connectionId} connection={connection} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectionCard({ connection }: { connection: ConnectionSummary }) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchTools(connection.connectionId).then((list) => {
      if (!cancelled) setTools(list);
    });
    return () => {
      cancelled = true;
    };
  }, [connection.connectionId]);

  return (
    <li className="rounded-lg border bg-card p-4 text-card-foreground">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {connection.serverInfo?.name ?? t('connections.unknownServer')}{' '}
            <span className="text-muted-foreground">{connection.serverInfo?.version}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {connection.transportKind} · {connection.capabilities.tools} {t('connections.tools')} ·{' '}
            {connection.capabilities.resources} {t('connections.resources')} · {connection.capabilities.prompts}{' '}
            {t('connections.prompts')}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void disconnectConnection(connection.connectionId)}>
          <Unplug />
          {t('connections.disconnect')}
        </Button>
      </div>
      {tools.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tools.map((tool) => (
            <span
              key={tool.name}
              title={tool.description}
              className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
            >
              {tool.name}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
