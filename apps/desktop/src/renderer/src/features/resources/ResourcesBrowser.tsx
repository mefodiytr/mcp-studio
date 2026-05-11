import { useMemo, useState, type ReactNode } from 'react';
import { SchemaForm } from '@mcp-studio/schema-form/react';
import { Download, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { useConnections } from '@renderer/lib/connections';
import { describeError } from '@renderer/lib/errors';
import { readResource, useResources, useResourceTemplates } from '@renderer/lib/resources';
import { cn } from '@renderer/lib/utils';
import type { ReadResourceResult, ResourceContent } from '@shared/domain/resource';

// Minimal RFC-6570 subset: bare `{name}` placeholders (what server-everything
// and most servers use). Richer operators are a follow-up.
function templateVars(uriTemplate: string): string[] {
  return [...new Set([...uriTemplate.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1] ?? ''))].filter(Boolean);
}
function expandUriTemplate(uriTemplate: string, vars: Record<string, string>): string {
  return uriTemplate.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => encodeURIComponent(vars[name] ?? ''));
}

type Selection =
  | { kind: 'resource'; uri: string; label: string }
  | { kind: 'template'; uriTemplate: string; label: string };

export function ResourcesBrowser() {
  const { t } = useTranslation();
  const connections = useConnections();
  const connected = connections.filter((c) => c.status === 'connected');
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const activeId = picked && connected.some((c) => c.connectionId === picked) ? picked : connected[0]?.connectionId;

  const resourcesQuery = useResources(activeId);
  const templatesQuery = useResourceTemplates(activeId);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);

  const q = query.trim().toLowerCase();
  const resources = useMemo(
    () =>
      (resourcesQuery.data ?? []).filter(
        (r) =>
          !q ||
          r.uri.toLowerCase().includes(q) ||
          (r.name ?? '').toLowerCase().includes(q) ||
          (r.description ?? '').toLowerCase().includes(q),
      ),
    [resourcesQuery.data, q],
  );
  const templates = useMemo(
    () =>
      (templatesQuery.data ?? []).filter(
        (tmpl) =>
          !q ||
          tmpl.uriTemplate.toLowerCase().includes(q) ||
          (tmpl.name ?? '').toLowerCase().includes(q) ||
          (tmpl.description ?? '').toLowerCase().includes(q),
      ),
    [templatesQuery.data, q],
  );

  if (connected.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <FileText className="size-10" aria-hidden />
        <p>{t('resources.noConnection')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{t('resources.title')}</h1>
        {connected.length > 1 && (
          <select
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={activeId ?? ''}
            onChange={(event) => {
              setPicked(event.target.value);
              setSelection(null);
            }}
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
          placeholder={t('resources.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="w-80 shrink-0 overflow-auto rounded-lg border">
          {(resourcesQuery.isLoading || templatesQuery.isLoading) && (
            <p className="p-3 text-sm text-muted-foreground">{t('resources.loading')}</p>
          )}
          {(resourcesQuery.isError || templatesQuery.isError) && (
            <p className="p-3 text-sm text-destructive">{t('resources.loadError')}</p>
          )}
          {resources.length > 0 && (
            <Section title={t('resources.static')}>
              {resources.map((r) => (
                <ListItem
                  key={r.uri}
                  active={selection?.kind === 'resource' && selection.uri === r.uri}
                  primary={r.name ?? r.uri}
                  secondary={r.uri}
                  meta={r.mimeType}
                  onClick={() => setSelection({ kind: 'resource', uri: r.uri, label: r.name ?? r.uri })}
                />
              ))}
            </Section>
          )}
          {templates.length > 0 && (
            <Section title={t('resources.templates')}>
              {templates.map((tmpl) => (
                <ListItem
                  key={tmpl.uriTemplate}
                  active={selection?.kind === 'template' && selection.uriTemplate === tmpl.uriTemplate}
                  primary={tmpl.name ?? tmpl.uriTemplate}
                  secondary={tmpl.uriTemplate}
                  meta={tmpl.mimeType}
                  onClick={() =>
                    setSelection({ kind: 'template', uriTemplate: tmpl.uriTemplate, label: tmpl.name ?? tmpl.uriTemplate })
                  }
                />
              ))}
            </Section>
          )}
          {!resourcesQuery.isLoading &&
            !templatesQuery.isLoading &&
            resources.length === 0 &&
            templates.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t('resources.empty')}</p>}
        </div>

        <div className="min-w-0 flex-1 overflow-auto rounded-lg border p-4">
          {!selection && <p className="text-sm text-muted-foreground">{t('resources.selectHint')}</p>}
          {selection && activeId && (
            <DetailPane key={`${activeId}:${selectionKey(selection)}`} connectionId={activeId} selection={selection} />
          )}
        </div>
      </div>
    </div>
  );
}

function selectionKey(s: Selection): string {
  return s.kind === 'resource' ? `r:${s.uri}` : `t:${s.uriTemplate}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b last:border-b-0">
      <p className="bg-muted/50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul>{children}</ul>
    </div>
  );
}

function ListItem({
  active,
  primary,
  secondary,
  meta,
  onClick,
}: {
  active: boolean;
  primary: string;
  secondary: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent/50',
          active && 'bg-accent text-accent-foreground',
        )}
      >
        <span className="truncate text-sm font-medium">{primary}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{secondary}</span>
        {meta && <span className="text-[10px] text-muted-foreground">{meta}</span>}
      </button>
    </li>
  );
}

function DetailPane({ connectionId, selection }: { connectionId: string; selection: Selection }) {
  if (selection.kind === 'template') {
    return <TemplateDetail connectionId={connectionId} uriTemplate={selection.uriTemplate} label={selection.label} />;
  }
  return <ResourceDetail connectionId={connectionId} uri={selection.uri} label={selection.label} />;
}

function TemplateDetail({
  connectionId,
  uriTemplate,
  label,
}: {
  connectionId: string;
  uriTemplate: string;
  label: string;
}) {
  const { t } = useTranslation();
  const vars = useMemo(() => templateVars(uriTemplate), [uriTemplate]);
  const [resolvedUri, setResolvedUri] = useState<string | null>(null);

  const schema = useMemo(
    () => ({
      type: 'object',
      properties: Object.fromEntries(vars.map((v): [string, unknown] => [v, { type: 'string', title: v }])),
      required: vars,
    }),
    [vars],
  );

  return (
    <div className="flex flex-col gap-3">
      <header>
        <h2 className="text-sm font-medium">{label}</h2>
        <p className="font-mono text-[11px] text-muted-foreground">{uriTemplate}</p>
      </header>
      {vars.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('resources.noVars')}</p>
      ) : (
        <SchemaForm
          schema={schema}
          submitLabel={t('resources.resolve')}
          onSubmit={(value) => {
            const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
            const strings = Object.fromEntries(
              Object.entries(record).map(([k, v]): [string, string] => [k, String(v ?? '')]),
            );
            setResolvedUri(expandUriTemplate(uriTemplate, strings));
          }}
        />
      )}
      {resolvedUri && <ResourceDetail connectionId={connectionId} uri={resolvedUri} label={resolvedUri} />}
    </div>
  );
}

function ResourceDetail({ connectionId, uri, label }: { connectionId: string; uri: string; label: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'ok'; result: ReadResourceResult } | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [showRaw, setShowRaw] = useState(false);

  const load = async (): Promise<void> => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ok', result: await readResource(connectionId, uri) });
    } catch (cause) {
      setState({ status: 'error', message: describeError(cause) });
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{uri}</p>
        </div>
        <div className="ml-auto flex shrink-0 gap-1">
          {state.status === 'ok' && (
            <Button size="sm" variant="ghost" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? t('resources.hideRaw') : t('resources.showRaw')}
            </Button>
          )}
          <Button size="sm" onClick={() => void load()} disabled={state.status === 'loading'}>
            {state.status === 'loading' ? t('resources.reading') : t('resources.read')}
          </Button>
        </div>
      </div>

      {state.status === 'error' && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {state.message}
        </p>
      )}
      {state.status === 'ok' && showRaw && (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {JSON.stringify({ request: { method: 'resources/read', params: { uri } }, response: { result: state.result } }, null, 2)}
        </pre>
      )}
      {state.status === 'ok' &&
        (state.result.contents.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('resources.emptyResult')}</p>
        ) : (
          state.result.contents.map((content, index) => <ContentPreview key={index} content={content} />)
        ))}
    </div>
  );
}

function decodeBase64(blob: string): Uint8Array | null {
  try {
    const bin = atob(blob);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function hexDump(bytes: Uint8Array, limit = 256): string {
  const slice = bytes.subarray(0, limit);
  const lines: string[] = [];
  for (let off = 0; off < slice.length; off += 16) {
    const row = slice.subarray(off, off + 16);
    const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...row].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex.padEnd(48)}  ${ascii}`);
  }
  if (bytes.length > limit) lines.push(`… (${bytes.length} bytes total)`);
  return lines.join('\n');
}

function ContentPreview({ content }: { content: ResourceContent }) {
  const { t } = useTranslation();
  const mime = content.mimeType ?? '';
  const text = content.text;
  const blob = content.blob;

  if (text !== undefined && (mime === 'application/json' || mime.endsWith('+json'))) {
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* leave as-is */
    }
    return <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{pretty}</pre>;
  }
  if (mime.startsWith('image/')) {
    const src = blob !== undefined ? `data:${mime};base64,${blob}` : text !== undefined ? `data:${mime},${encodeURIComponent(text)}` : null;
    return src ? <img src={src} alt={content.uri} className="max-h-[60vh] rounded-md border" /> : null;
  }
  if (text !== undefined) {
    // Includes text/markdown — rendered as monospace text for M1 (a Markdown
    // renderer is a follow-up; see docs/m1-followups.md).
    return (
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
        {text}
      </pre>
    );
  }
  if (blob !== undefined) {
    const bytes = decodeBase64(blob);
    return (
      <div className="flex flex-col gap-2">
        <a
          href={`data:${mime || 'application/octet-stream'};base64,${blob}`}
          download={content.uri.split('/').pop() || 'resource'}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Download className="size-4" /> {t('resources.download')}
        </a>
        {bytes && <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted p-3 font-mono text-[11px]">{hexDump(bytes)}</pre>}
      </div>
    );
  }
  return <p className="text-xs text-muted-foreground">{t('resources.emptyResult')}</p>;
}
