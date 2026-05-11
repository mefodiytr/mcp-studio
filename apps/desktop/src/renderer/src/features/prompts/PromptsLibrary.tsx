import { useMemo, useState } from 'react';
import { SchemaForm } from '@mcp-studio/schema-form/react';
import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { useConnections } from '@renderer/lib/connections';
import { describeError } from '@renderer/lib/errors';
import { getPrompt, usePrompts } from '@renderer/lib/prompts';
import { cn } from '@renderer/lib/utils';
import type { GetPromptResult, PromptDescriptor, PromptMessage } from '@shared/domain/prompt';
import type { ContentBlock } from '@shared/domain/tool-result';

export function PromptsLibrary() {
  const { t } = useTranslation();
  const connections = useConnections();
  const connected = connections.filter((c) => c.status === 'connected');
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const activeId = picked && connected.some((c) => c.connectionId === picked) ? picked : connected[0]?.connectionId;

  const promptsQuery = usePrompts(activeId);
  const [query, setQuery] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const prompts = useMemo(
    () =>
      (promptsQuery.data ?? []).filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.title ?? '').toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q),
      ),
    [promptsQuery.data, q],
  );
  const selected = prompts.find((p) => p.name === selectedName) ?? null;

  if (connected.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <MessageSquare className="size-10" aria-hidden />
        <p>{t('prompts.noConnection')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{t('prompts.title')}</h1>
        {connected.length > 1 && (
          <select
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={activeId ?? ''}
            onChange={(event) => {
              setPicked(event.target.value);
              setSelectedName(null);
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
          placeholder={t('prompts.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="w-72 shrink-0 overflow-auto rounded-lg border">
          {promptsQuery.isLoading && <p className="p-3 text-sm text-muted-foreground">{t('prompts.loading')}</p>}
          {promptsQuery.isError && <p className="p-3 text-sm text-destructive">{t('prompts.loadError')}</p>}
          <ul>
            {prompts.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  onClick={() => setSelectedName(p.name)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent/50',
                    selectedName === p.name && 'bg-accent text-accent-foreground',
                  )}
                >
                  <span className="truncate font-mono text-sm font-medium">{p.name}</span>
                  {p.title && <span className="truncate text-xs">{p.title}</span>}
                  {p.arguments && p.arguments.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {p.arguments.length} {t('prompts.args')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {!promptsQuery.isLoading && prompts.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">{t('prompts.empty')}</p>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-auto rounded-lg border p-4">
          {!selected && <p className="text-sm text-muted-foreground">{t('prompts.selectHint')}</p>}
          {selected && activeId && <PromptDetail key={`${activeId}:${selected.name}`} connectionId={activeId} prompt={selected} />}
        </div>
      </div>
    </div>
  );
}

function PromptDetail({ connectionId, prompt }: { connectionId: string; prompt: PromptDescriptor }) {
  const { t } = useTranslation();
  const args = prompt.arguments ?? [];
  const [showRaw, setShowRaw] = useState(false);
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading'; args: Record<string, string> }
    | { status: 'ok'; args: Record<string, string>; result: GetPromptResult }
    | { status: 'error'; args: Record<string, string>; message: string }
  >({ status: 'idle' });

  const schema = useMemo(
    () => ({
      type: 'object',
      properties: Object.fromEntries(
        args.map((a): [string, unknown] => [
          a.name,
          { type: 'string', title: a.title ?? a.name, description: a.description },
        ]),
      ),
      required: args.filter((a) => a.required).map((a) => a.name),
    }),
    [args],
  );

  const runPreview = async (record: Record<string, unknown>): Promise<void> => {
    const filled: Record<string, string> = {};
    for (const [k, v] of Object.entries(record)) {
      if (v != null && String(v) !== '') filled[k] = String(v);
    }
    setState({ status: 'loading', args: filled });
    try {
      setState({ status: 'ok', args: filled, result: await getPrompt(connectionId, prompt.name, filled) });
    } catch (cause) {
      setState({ status: 'error', args: filled, message: describeError(cause) });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <header>
        <h2 className="font-mono text-sm font-medium">{prompt.name}</h2>
        {prompt.title && <p className="text-sm">{prompt.title}</p>}
        {prompt.description && <p className="text-xs text-muted-foreground">{prompt.description}</p>}
      </header>

      {args.length === 0 ? (
        <Button
          size="sm"
          className="w-fit"
          disabled={state.status === 'loading'}
          onClick={() => void runPreview({})}
        >
          {state.status === 'loading' ? t('prompts.previewing') : t('prompts.preview')}
        </Button>
      ) : (
        <SchemaForm
          schema={schema}
          submitLabel={state.status === 'loading' ? t('prompts.previewing') : t('prompts.preview')}
          busy={state.status === 'loading'}
          onSubmit={(value) => {
            void runPreview(value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
          }}
        />
      )}

      {state.status === 'error' && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {state.message}
        </p>
      )}

      {state.status === 'ok' && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{t('prompts.assembled')}</h3>
            {state.result.description && (
              <span className="text-xs text-muted-foreground">— {state.result.description}</span>
            )}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? t('prompts.hideRaw') : t('prompts.showRaw')}
            </Button>
          </div>
          {showRaw && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
              {JSON.stringify(
                {
                  request: { method: 'prompts/get', params: { name: prompt.name, arguments: state.args } },
                  response: { result: state.result },
                },
                null,
                2,
              )}
            </pre>
          )}
          {state.result.messages.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('prompts.emptyResult')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {state.result.messages.map((message, index) => (
                <MessageBubble key={index} message={message} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: PromptMessage }) {
  const isUser = message.role === 'user';
  return (
    <li
      className={cn(
        'rounded-lg border p-3 text-sm',
        isUser ? 'bg-muted/40' : 'border-primary/30 bg-primary/5',
      )}
    >
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{message.role}</p>
      <MessageContent content={message.content} />
    </li>
  );
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function MessageContent({ content }: { content: ContentBlock }) {
  switch (content.type) {
    case 'text':
      return <p className="whitespace-pre-wrap">{str(content['text'])}</p>;
    case 'image':
      return (
        <img
          src={`data:${str(content['mimeType'], 'image/png')};base64,${str(content['data'])}`}
          alt="prompt content"
          className="max-h-72 rounded-md border"
        />
      );
    case 'audio':
      return <audio controls src={`data:${str(content['mimeType'], 'audio/wav')};base64,${str(content['data'])}`} />;
    case 'resource_link':
      return (
        <div className="rounded-md border bg-muted p-2 text-xs">
          <span className="font-mono">{str(content['uri'])}</span>
          {str(content['name']) && ` — ${str(content['name'])}`}
        </div>
      );
    case 'resource': {
      const resource = content['resource'];
      const text =
        resource && typeof resource === 'object' && typeof (resource as Record<string, unknown>)['text'] === 'string'
          ? ((resource as Record<string, unknown>)['text'] as string)
          : undefined;
      return text !== undefined ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs">{text}</pre>
      ) : (
        <pre className="max-h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
          {JSON.stringify(resource, null, 2)}
        </pre>
      );
    }
    default:
      return (
        <pre className="max-h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
          {JSON.stringify(content, null, 2)}
        </pre>
      );
  }
}
