import { useMemo, useState } from 'react';
import { Activity, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BarChart, type BarChartItem } from '@mcp-studio/charts';

import { useConnections } from '@renderer/lib/connections';
import { useHistory } from '@renderer/lib/history';
import { latencyHistogram, p95DeltaOverWindows, slowestN } from '@renderer/lib/perf-stats';
import { cn } from '@renderer/lib/utils';

/**
 * The M4 Performance view — pure derivations over the persisted tool-history
 * (see milestone-4 §D5). Three sections:
 *   - latency histogram (log-ish buckets, BarChart),
 *   - slowest-N table (top 10, click to "show args" — no actual click yet,
 *     just the args column with a truncate),
 *   - regression callout (p95 over the last `windowMs` window vs the
 *     previous-of-equal-length; ≥ 25 % p95 increase = "regression detected").
 *
 * Scope picker — active connection / all connections — same shape as the
 * Tool-usage view (M4 C63). Window selector — 1 h / 6 h / 1 d / 7 d — for
 * the regression callout.
 */

const WINDOWS_MS: { id: string; label: string; ms: number }[] = [
  { id: '1h', label: '1 h', ms: 3_600_000 },
  { id: '6h', label: '6 h', ms: 6 * 3_600_000 },
  { id: '1d', label: '24 h', ms: 24 * 3_600_000 },
  { id: '7d', label: '7 d', ms: 7 * 24 * 3_600_000 },
];

export function PerfView() {
  const { t } = useTranslation();
  const connections = useConnections();
  const connected = connections.filter((c) => c.status === 'connected');
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [windowId, setWindowId] = useState<string>('1h');

  const activeId = connected[0]?.connectionId;
  const activeName = connected[0]?.serverInfo?.name ?? connected[0]?.profileId ?? '';

  const historyQuery = useHistory();
  const entries = useMemo(() => {
    const all = historyQuery.data ?? [];
    return scope === 'active' && activeId ? all.filter((e) => e.connectionId === activeId) : all;
  }, [historyQuery.data, scope, activeId]);

  const histogram = useMemo(() => latencyHistogram(entries), [entries]);
  const slowest = useMemo(() => slowestN(entries, 10), [entries]);
  const windowMs = WINDOWS_MS.find((w) => w.id === windowId)?.ms ?? 3_600_000;
  const regression = useMemo(() => p95DeltaOverWindows(entries, windowMs), [entries, windowMs]);

  if (connected.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <Activity className="size-10" aria-hidden />
        <p>{t('perf.noConnection')}</p>
      </div>
    );
  }

  const histogramItems: BarChartItem[] = histogram.map((b) => ({ label: b.label, value: b.count }));
  const totalRows = entries.length;
  const empty = totalRows === 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{t('perf.title')}</h1>
        {connected.length > 0 && (
          <select
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'active' | 'all')}
          >
            <option value="active">{activeName}</option>
            <option value="all">{t('perf.scopeAll')}</option>
          </select>
        )}
        <select
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          value={windowId}
          onChange={(e) => setWindowId(e.target.value)}
          title={t('perf.window')}
        >
          {WINDOWS_MS.map((w) => (
            <option key={w.id} value={w.id}>
              {t('perf.window')}: {w.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {totalRows} {t('perf.calls')}
        </span>
      </div>

      {empty ? (
        <p className="text-sm text-muted-foreground">{t('perf.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title={t('perf.histogram')}>
            <BarChart items={histogramItems} height={220} />
          </Card>

          <Card title={t('perf.regression')}>
            <RegressionPanel
              labels={{
                currLabel: t('perf.currP95'),
                prevLabel: t('perf.prevP95'),
                noPrev: t('perf.regressionNoPrev'),
                noData: t('perf.regressionNoData'),
                flag: t('perf.regressionDetected'),
                stable: t('perf.regressionStable'),
              }}
              currMs={regression.currP95Ms}
              prevMs={regression.prevP95Ms}
              deltaRatio={regression.deltaRatio}
              flagged={regression.regression}
              currCount={regression.currCount}
              prevCount={regression.prevCount}
            />
          </Card>

          <Card title={t('perf.slowest')} className="lg:col-span-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">{t('perf.tool')}</th>
                  <th className="py-1 pr-2 text-right font-medium">{t('perf.duration')} (ms)</th>
                  <th className="py-1 pr-2 font-medium">{t('perf.status')}</th>
                  <th className="py-1 pr-2 font-medium">{t('perf.server')}</th>
                  <th className="py-1 font-medium">{t('perf.when')}</th>
                </tr>
              </thead>
              <tbody>
                {slowest.map((e) => (
                  <tr key={e.id} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-mono">{e.toolName}</td>
                    <td className="py-1 pr-2 text-right">{e.durationMs}</td>
                    <td className="py-1 pr-2">{e.status}</td>
                    <td className="py-1 pr-2 font-mono text-muted-foreground">{e.serverName ?? '—'}</td>
                    <td className="py-1 font-mono text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

function Card({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('rounded-lg border bg-card p-4 text-card-foreground', className)}>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function RegressionPanel({
  labels,
  currMs,
  prevMs,
  deltaRatio,
  flagged,
  currCount,
  prevCount,
}: {
  labels: { currLabel: string; prevLabel: string; noPrev: string; noData: string; flag: string; stable: string };
  currMs: number | null;
  prevMs: number | null;
  deltaRatio: number | null;
  flagged: boolean;
  currCount: number;
  prevCount: number;
}) {
  if (currMs === null) return <p className="text-xs text-muted-foreground">{labels.noData}</p>;
  const deltaText =
    deltaRatio === null
      ? labels.noPrev
      : `${deltaRatio >= 0 ? '+' : ''}${Math.round(deltaRatio * 100)}%`;
  return (
    <div className="space-y-2">
      <p
        className={cn(
          'flex items-center gap-1.5 text-sm',
          flagged ? 'text-destructive' : deltaRatio !== null && deltaRatio < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
        )}
      >
        {flagged ? (
          <>
            <TriangleAlert className="size-3.5" aria-hidden /> {labels.flag} {deltaText}
          </>
        ) : (
          <>{labels.stable} {deltaText}</>
        )}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">{labels.currLabel}</dt>
        <dd className="font-mono">
          {currMs} ms <span className="text-muted-foreground">({currCount} samples)</span>
        </dd>
        <dt className="text-muted-foreground">{labels.prevLabel}</dt>
        <dd className="font-mono">
          {prevMs === null ? '—' : `${prevMs} ms`}{' '}
          <span className="text-muted-foreground">({prevCount} samples)</span>
        </dd>
      </dl>
    </div>
  );
}
