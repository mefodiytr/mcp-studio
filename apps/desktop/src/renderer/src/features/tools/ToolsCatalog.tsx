import { useMemo, useState } from 'react';
import { ChevronDown, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { useConnections } from '@renderer/lib/connections';
import { useTools } from '@renderer/lib/tools';
import { cn } from '@renderer/lib/utils';
import type { ToolDescriptor } from '@shared/domain/connection';

type AnnotationFilter = 'readOnlyHint' | 'destructiveHint' | 'idempotentHint';
const ANNOTATION_FILTERS: AnnotationFilter[] = ['readOnlyHint', 'destructiveHint', 'idempotentHint'];

export function ToolsCatalog() {
  const { t } = useTranslation();
  const connections = useConnections();
  const connected = connections.filter((c) => c.status === 'connected');
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const activeId = picked && connected.some((c) => c.connectionId === picked) ? picked : connected[0]?.connectionId;
  const toolsQuery = useTools(activeId);

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ReadonlySet<AnnotationFilter>>(new Set());
  const toggle = (f: AnnotationFilter): void =>
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const tools = toolsQuery.data ?? [];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((tool) => {
      if (
        q &&
        !tool.name.toLowerCase().includes(q) &&
        !(tool.title ?? '').toLowerCase().includes(q) &&
        !(tool.description ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      for (const f of filters) if (!tool.annotations?.[f]) return false;
      return true;
    });
  }, [tools, query, filters]);

  if (connected.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <Wrench className="size-10" aria-hidden />
        <p>{t('tools.noConnection')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{t('tools.title')}</h1>
        {connected.length > 1 && (
          <select
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={activeId ?? ''}
            onChange={(event) => setPicked(event.target.value)}
          >
            {connected.map((c) => (
              <option key={c.connectionId} value={c.connectionId}>
                {c.serverInfo?.name ?? c.profileId}
              </option>
            ))}
          </select>
        )}
        <Input
          className="max-w-xs"
          placeholder={t('tools.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex gap-1.5 text-xs">
          {ANNOTATION_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => toggle(f)}
              className={cn('rounded-md border px-2 py-1', filters.has(f) && 'bg-accent text-accent-foreground')}
            >
              {t(`tools.filter.${f}`)}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {visible.length} / {tools.length}
        </span>
      </div>

      {toolsQuery.isLoading && <p className="text-sm text-muted-foreground">{t('tools.loading')}</p>}
      {toolsQuery.isError && <p className="text-sm text-destructive">{t('tools.loadError')}</p>}

      <ul className="flex flex-col gap-3">
        {visible.map((tool) => (
          <ToolRow key={tool.name} tool={tool} />
        ))}
        {!toolsQuery.isLoading && visible.length === 0 && (
          <li className="text-sm text-muted-foreground">{t('tools.empty')}</li>
        )}
      </ul>
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolDescriptor }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const badges: { label: string; destructive?: boolean }[] = [];
  if (tool.annotations?.readOnlyHint) badges.push({ label: t('tools.badge.readOnly') });
  if (tool.annotations?.destructiveHint) badges.push({ label: t('tools.badge.destructive'), destructive: true });
  if (tool.annotations?.idempotentHint) badges.push({ label: t('tools.badge.idempotent') });
  if (tool.annotations?.openWorldHint) badges.push({ label: t('tools.badge.openWorld') });

  return (
    <li className="rounded-lg border bg-card p-4 text-card-foreground">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-medium">{tool.name}</p>
          {tool.title && <p className="text-sm">{tool.title}</p>}
          {tool.description && <p className="text-xs text-muted-foreground">{tool.description}</p>}
          {badges.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {badges.map((b) => (
                <span
                  key={b.label}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px]',
                    b.destructive ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {b.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
            {t('tools.schema')}
          </Button>
          <Button size="sm" disabled title={t('tools.callSoon')}>
            {t('tools.call')}
          </Button>
        </div>
      </div>
      {open && (
        <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {JSON.stringify(tool.inputSchema, null, 2)}
        </pre>
      )}
    </li>
  );
}
