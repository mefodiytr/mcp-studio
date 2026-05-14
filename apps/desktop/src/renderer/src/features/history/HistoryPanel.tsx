import { useMemo, useState } from 'react';
import { ChevronDown, Copy, Download, History as HistoryIcon, ListRestart, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { ToolInvocationDialog } from '@renderer/features/tools/ToolInvocationDialog';
import { useConnections } from '@renderer/lib/connections';
import { clearHistory, useHistory } from '@renderer/lib/history';
import { callTool, useTools } from '@renderer/lib/tools';
import { cn } from '@renderer/lib/utils';
import type { ToolDescriptor } from '@shared/domain/connection';
import type { ToolHistoryEntry } from '@shared/domain/tool-history';

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

type StatusFilter = 'all' | ToolHistoryEntry['status'];

export function HistoryPanel() {
  const { t } = useTranslation();
  const historyQuery = useHistory();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [writesOnly, setWritesOnly] = useState(false);
  const [editing, setEditing] = useState<{
    connectionId: string;
    tool: ToolDescriptor;
    initialArgs: Record<string, unknown>;
  } | null>(null);

  const entries = historyQuery.data ?? [];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (status !== 'all' && entry.status !== status) return false;
      if (writesOnly && !entry.write) return false;
      if (q && !entry.toolName.toLowerCase().includes(q) && !(entry.serverName ?? '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [entries, query, status, writesOnly]);

  const exportJson = (): void => {
    const blob = new Blob([JSON.stringify(visible, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mcp-studio-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{t('history.title')}</h1>
        <Input
          className="max-w-xs"
          placeholder={t('history.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
        >
          <option value="all">{t('history.allStatuses')}</option>
          <option value="ok">{t('history.status.ok')}</option>
          <option value="tool-error">{t('history.status.tool-error')}</option>
          <option value="error">{t('history.status.error')}</option>
        </select>
        <button
          type="button"
          onClick={() => setWritesOnly((v) => !v)}
          className={cn('h-9 rounded-md border px-3 text-sm', writesOnly && 'bg-accent text-accent-foreground')}
        >
          {t('history.writesOnly')}
        </button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={visible.length === 0}
          onClick={exportJson}
        >
          <Download />
          {t('history.export')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={entries.length === 0}
          onClick={() => void clearHistory()}
        >
          <Trash2 />
          {t('history.clear')}
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <HistoryIcon className="size-10" aria-hidden />
          <p>{t('history.empty')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              onEdit={(connectionId, tool) =>
                setEditing({ connectionId, tool, initialArgs: asRecord(entry.args) })
              }
            />
          ))}
          {visible.length === 0 && <li className="text-sm text-muted-foreground">{t('history.noMatch')}</li>}
        </ul>
      )}

      {editing && (
        <ToolInvocationDialog
          connectionId={editing.connectionId}
          tool={editing.tool}
          initialArgs={editing.initialArgs}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

const STATUS_CLASS: Record<ToolHistoryEntry['status'], string> = {
  ok: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  'tool-error': 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  error: 'bg-destructive/15 text-destructive',
  // M5 C75 — AI-proposed write intercepted by the safety boundary, routed to
  // the plugin pending-changes queue instead of executing. Blue to match the
  // ChangesView "AI" chip.
  queued: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
};

function HistoryRow({
  entry,
  onEdit,
}: {
  entry: ToolHistoryEntry;
  onEdit: (connectionId: string, tool: ToolDescriptor) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const connections = useConnections();
  const alive = connections.some((c) => c.connectionId === entry.connectionId && c.status === 'connected');
  const toolsQuery = useTools(alive ? entry.connectionId : undefined);
  const tool = toolsQuery.data?.find((descriptor) => descriptor.name === entry.toolName);

  const rerun = (): void => {
    if (!alive) return;
    // Preserve the original audit attribution on re-run, so a re-issued write
    // still shows up as a write in the audit trail.
    void callTool(entry.connectionId, entry.toolName, asRecord(entry.args), { write: entry.write });
    toast.info(t('history.rerunning', { tool: entry.toolName }));
  };
  const copy = (): void => {
    void navigator.clipboard.writeText(
      JSON.stringify({ method: 'tools/call', params: { name: entry.toolName, arguments: entry.args } }, null, 2),
    );
    toast.success(t('history.copied'));
  };

  return (
    <li className="rounded-lg border bg-card p-3 text-card-foreground">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono font-medium">{entry.toolName}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[10px]', STATUS_CLASS[entry.status])}>
              {t(`history.status.${entry.status}`)}
            </span>
            {entry.write && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                {t('history.writeBadge')}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {entry.serverName ?? entry.profileId} · {relativeTime(entry.ts)} · {entry.durationMs} ms
            </span>
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{JSON.stringify(entry.args)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!alive}
            title={alive ? undefined : t('history.connectionGone')}
            onClick={rerun}
          >
            <ListRestart />
            {t('history.rerun')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!tool}
            title={tool ? undefined : t('history.connectionGone')}
            onClick={() => tool && onEdit(entry.connectionId, tool)}
          >
            <Pencil />
            {t('history.editRerun')}
          </Button>
          <Button size="sm" variant="ghost" onClick={copy}>
            <Copy />
            {t('history.copy')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
        </div>
      </div>
      {open && (
        <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {JSON.stringify(entry.error ?? entry.result, null, 2)}
        </pre>
      )}
    </li>
  );
}
