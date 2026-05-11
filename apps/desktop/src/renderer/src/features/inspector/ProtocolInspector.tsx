import { useMemo, useState } from 'react';
import { Download, Pause, Play, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { useConnections } from '@renderer/lib/connections';
import { useProtocolStream } from '@renderer/lib/protocol';
import { cn } from '@renderer/lib/utils';
import type { ProtocolEvent } from '@shared/domain/protocol';

type StatusFilter = 'all' | 'requests' | 'responses' | 'notifications' | 'errors';
const STATUS_FILTERS: StatusFilter[] = ['all', 'requests', 'responses', 'notifications', 'errors'];

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function matchesStatus(event: ProtocolEvent, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'requests':
      return event.kind === 'request';
    case 'responses':
      return event.kind === 'response';
    case 'notifications':
      return event.kind === 'notification';
    case 'errors':
      return event.isError === true;
  }
}

/** Find the request↔response counterpart of an event (same connection + id). */
function counterpart(event: ProtocolEvent, events: ProtocolEvent[]): ProtocolEvent | undefined {
  if (event.id === undefined || event.kind === 'notification') return undefined;
  const wantKind = event.kind === 'request' ? 'response' : 'request';
  return events.find((e) => e.connectionId === event.connectionId && e.id === event.id && e.kind === wantKind);
}

export function ProtocolInspector({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { events, paused, setPaused, clear } = useProtocolStream();
  const connections = useConnections();

  const [method, setMethod] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [connId, setConnId] = useState('');
  const [minDur, setMinDur] = useState('');
  const [selected, setSelected] = useState<ProtocolEvent | null>(null);

  const nameFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of connections) map.set(c.connectionId, c.serverInfo?.name ?? c.profileId);
    return (id: string): string => map.get(id) ?? `${id.slice(0, 8)}…`;
  }, [connections]);

  const filtered = useMemo(() => {
    const m = method.trim().toLowerCase();
    const min = minDur.trim() === '' ? null : Number(minDur);
    return events.filter((e) => {
      if (m && !(e.method ?? '').toLowerCase().includes(m)) return false;
      if (!matchesStatus(e, status)) return false;
      if (connId && e.connectionId !== connId) return false;
      if (min != null && !Number.isNaN(min) && (e.durationMs ?? -1) < min) return false;
      return true;
    });
  }, [events, method, status, connId, minDur]);

  const exportJson = (): void => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `protocol-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pair = selected ? counterpart(selected, events) : undefined;
  const detailRequest = selected?.kind === 'response' ? pair : selected ?? undefined;
  const detailResponse = selected?.kind === 'request' ? pair : selected?.kind === 'response' ? selected : undefined;

  return (
    <section className="flex h-[38vh] shrink-0 flex-col border-t bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-sm">
        <span className="font-medium">{t('inspector.title')}</span>
        <Button size="icon" variant="ghost" className="size-7" title={paused ? t('inspector.resume') : t('inspector.pause')} onClick={() => setPaused(!paused)}>
          {paused ? <Play /> : <Pause />}
        </Button>
        <Button size="icon" variant="ghost" className="size-7" title={t('inspector.clear')} onClick={clear}>
          <Trash2 />
        </Button>
        <Button size="icon" variant="ghost" className="size-7" title={t('inspector.export')} onClick={exportJson} disabled={filtered.length === 0}>
          <Download />
        </Button>
        <Input className="h-7 max-w-[12rem]" placeholder={t('inspector.methodFilter')} value={method} onChange={(e) => setMethod(e.target.value)} />
        <select className="h-7 rounded-md border bg-transparent px-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t(`inspector.status.${s}`)}
            </option>
          ))}
        </select>
        <select className="h-7 rounded-md border bg-transparent px-2 text-xs" value={connId} onChange={(e) => setConnId(e.target.value)}>
          <option value="">{t('inspector.allConnections')}</option>
          {connections.map((c) => (
            <option key={c.connectionId} value={c.connectionId}>
              {c.serverInfo?.name ?? c.profileId}
            </option>
          ))}
        </select>
        <Input className="h-7 w-24" type="number" min={0} placeholder={t('inspector.minDur')} value={minDur} onChange={(e) => setMinDur(e.target.value)} />
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} / {events.length}
          {paused && ` · ${t('inspector.paused')}`}
        </span>
        <Button size="icon" variant="ghost" className="size-7" title={t('inspector.close')} onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted/80 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-1 font-medium">{t('inspector.col.ts')}</th>
                <th className="px-2 py-1 font-medium">{t('inspector.col.conn')}</th>
                <th className="px-2 py-1 font-medium">{t('inspector.col.dir')}</th>
                <th className="px-2 py-1 font-medium">{t('inspector.col.method')}</th>
                <th className="px-2 py-1 font-medium">{t('inspector.col.status')}</th>
                <th className="px-2 py-1 text-right font-medium">{t('inspector.col.dur')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered
                .slice()
                .reverse()
                .map((e, i) => (
                  <tr
                    key={`${e.ts}-${e.connectionId}-${String(e.id ?? '')}-${e.kind}-${i}`}
                    onClick={() => setSelected(e)}
                    className={cn(
                      'cursor-pointer border-b hover:bg-accent/40',
                      selected === e && 'bg-accent text-accent-foreground',
                      e.isError && 'text-destructive',
                    )}
                  >
                    <td className="px-2 py-1 font-mono">{fmtTime(e.ts)}</td>
                    <td className="px-2 py-1">{nameFor(e.connectionId)}</td>
                    <td className="px-2 py-1">{e.direction === 'outgoing' ? '→' : '←'}</td>
                    <td className="px-2 py-1 font-mono">{e.method ?? (e.kind === 'response' ? '(response)' : '')}</td>
                    <td className="px-2 py-1">{e.isError ? t('inspector.errorLabel') : e.kind}</td>
                    <td className="px-2 py-1 text-right font-mono">{e.durationMs != null ? `${e.durationMs} ms` : ''}</td>
                  </tr>
                ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                    {events.length === 0 ? t('inspector.empty') : t('inspector.noMatch')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="flex w-1/2 min-w-0 shrink-0 flex-col gap-2 overflow-auto border-l p-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium">{selected.method ?? selected.kind}</span>
              <Button size="sm" variant="ghost" className="ml-auto h-6 px-2" onClick={() => setSelected(null)}>
                {t('inspector.close')}
              </Button>
            </div>
            {selected.kind === 'notification' ? (
              <PayloadBlock label={t('inspector.notification')} payload={selected.payload} />
            ) : (
              <div className="flex min-w-0 flex-col gap-2 md:flex-row">
                <PayloadBlock label={t('inspector.request')} payload={detailRequest?.payload} missing={t('inspector.notCaptured')} />
                <PayloadBlock label={t('inspector.response')} payload={detailResponse?.payload} missing={t('inspector.notCaptured')} />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function PayloadBlock({ label, payload, missing }: { label: string; payload?: unknown; missing?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {payload === undefined ? (
        <p className="rounded-md bg-muted p-2 text-muted-foreground">{missing ?? '—'}</p>
      ) : (
        <pre className="max-h-[24vh] overflow-auto rounded-md bg-muted p-2 font-mono">{JSON.stringify(payload, null, 2)}</pre>
      )}
    </div>
  );
}
