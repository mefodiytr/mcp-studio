import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BarChart, type BarChartItem } from '@mcp-studio/charts';

import { useConnections } from '@renderer/lib/connections';
import { useHistory } from '@renderer/lib/history';
import { isWriteCall } from '@renderer/lib/tools';
import { errorBreakdown, latencyStats, usageByTool } from '@renderer/lib/usage-stats';
import { cn } from '@renderer/lib/utils';

/**
 * Tool-usage stats — most-called tools, per-tool latency (avg/p50/p95), and an
 * error-code breakdown. Pure derivation over the persisted tool-call history
 * (see M4 §D6); no new storage. Scopes to the active connection by default
 * with an "All connections" toggle; a "Writes only" toggle threads the M3
 * audit flag through so the operator can see "what did my write workflow
 * actually touch".
 */
export function UsageView() {
  const { t } = useTranslation();
  const connections = useConnections();
  const connected = connections.filter((c) => c.status === 'connected');
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [writesOnly, setWritesOnly] = useState(false);

  const activeId = connected[0]?.connectionId;
  const activeName = connected[0]?.serverInfo?.name ?? connected[0]?.profileId ?? '';

  const historyQuery = useHistory();
  const entries = useMemo(() => {
    const all = historyQuery.data ?? [];
    let filtered = scope === 'active' && activeId ? all.filter((e) => e.connectionId === activeId) : all;
    if (writesOnly) {
      filtered = filtered.filter((e) => {
        // The recorded `write` flag is the source of truth (M3 set it from the
        // *effective* annotations); fall back to a derivation when an old entry
        // is missing it.
        if (typeof e.write === 'boolean') return e.write;
        return isWriteCall(undefined); // ⇒ false: an absent flag = "don't claim a write"
      });
    }
    return filtered;
  }, [historyQuery.data, scope, activeId, writesOnly]);

  const usage = useMemo(() => usageByTool(entries), [entries]);
  const latency = useMemo(() => latencyStats(entries), [entries]);
  const errors = useMemo(() => errorBreakdown(entries), [entries]);

  if (connected.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <BarChart3 className="size-10" aria-hidden />
        <p>{t('usage.noConnection')}</p>
      </div>
    );
  }

  // Top 10 most-called as a horizontal bar chart (labels can be long).
  const mostCalled: BarChartItem[] = usage.slice(0, 10).map((r) => ({ label: r.name, value: r.count }));
  // Top 10 by avg latency.
  const slowest = latency.slice(0, 10);
  // Error breakdown — vertical bar; few categories.
  const errorItems: BarChartItem[] = errors.map((r) => ({ label: r.label, value: r.count }));

  const empty = entries.length === 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{t('usage.title')}</h1>
        {connected.length > 0 && (
          <select
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'active' | 'all')}
          >
            <option value="active">{activeName}</option>
            <option value="all">{t('usage.scopeAll')}</option>
          </select>
        )}
        <button
          type="button"
          onClick={() => setWritesOnly((v) => !v)}
          className={cn('h-9 rounded-md border px-3 text-sm', writesOnly && 'bg-accent text-accent-foreground')}
        >
          {t('usage.writesOnly')}
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {entries.length} {t('usage.calls')}
        </span>
      </div>

      {empty ? (
        <p className="text-sm text-muted-foreground">{t('usage.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title={t('usage.mostCalled')}>
            <BarChart items={mostCalled} orientation="horizontal" height={Math.max(160, mostCalled.length * 24 + 40)} />
          </Card>

          <Card title={t('usage.latency')}>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">{t('usage.tool')}</th>
                  <th className="py-1 pr-2 text-right font-medium">{t('usage.calls')}</th>
                  <th className="py-1 pr-2 text-right font-medium">{t('usage.avg')} (ms)</th>
                  <th className="py-1 pr-2 text-right font-medium">{t('usage.p50')}</th>
                  <th className="py-1 text-right font-medium">{t('usage.p95')}</th>
                </tr>
              </thead>
              <tbody>
                {slowest.map((r) => (
                  <tr key={r.name} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-mono">{r.name}</td>
                    <td className="py-1 pr-2 text-right">{r.count}</td>
                    <td className="py-1 pr-2 text-right">{r.avgMs.toFixed(1)}</td>
                    <td className="py-1 pr-2 text-right">{r.p50Ms}</td>
                    <td className="py-1 text-right">{r.p95Ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title={t('usage.errors')} className="lg:col-span-2">
            {errorItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('usage.noErrors')}</p>
            ) : (
              <BarChart items={errorItems} height={Math.max(160, errorItems.length * 32 + 40)} />
            )}
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
