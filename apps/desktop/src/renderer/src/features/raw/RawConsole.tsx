import { useState } from 'react';
import { Braces, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { useConnections } from '@renderer/lib/connections';
import { describeError } from '@renderer/lib/errors';
import { sendRawRequest } from '@renderer/lib/raw';

const COMMON_METHODS = [
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'prompts/list',
  'prompts/get',
  'ping',
  'logging/setLevel',
  'completion/complete',
];

interface RawResponse {
  method: string;
  params: unknown;
  ok: boolean;
  result: unknown;
  error: unknown;
}

export function RawConsole() {
  const { t } = useTranslation();
  const connections = useConnections();
  const connected = connections.filter((c) => c.status === 'connected');
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const activeId = picked && connected.some((c) => c.connectionId === picked) ? picked : connected[0]?.connectionId;

  const [method, setMethod] = useState('tools/list');
  const [paramsText, setParamsText] = useState('{}');
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<RawResponse | null>(null);

  if (connected.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <Braces className="size-10" aria-hidden />
        <p>{t('raw.noConnection')}</p>
      </div>
    );
  }

  const send = async (): Promise<void> => {
    let params: Record<string, unknown> | undefined;
    const trimmed = paramsText.trim();
    if (trimmed !== '' && trimmed !== '{}') {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          params = parsed as Record<string, unknown>;
        } else {
          setParamsError(t('raw.paramsMustBeObject'));
          return;
        }
      } catch {
        setParamsError(t('raw.invalidJson'));
        return;
      }
    }
    setParamsError(null);
    if (!activeId) return;
    setSending(true);
    try {
      const res = await sendRawRequest(activeId, method.trim(), params);
      setResponse({ method: method.trim(), params: params ?? {}, ok: res.ok, result: res.result, error: res.error });
    } catch (cause) {
      setResponse({ method: method.trim(), params: params ?? {}, ok: false, result: null, error: { message: describeError(cause) } });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{t('raw.title')}</h1>
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
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">{t('raw.method')}</label>
        <div className="flex gap-2">
          <Input
            className="font-mono"
            list="raw-methods"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          />
          <datalist id="raw-methods">
            {COMMON_METHODS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <Button onClick={() => void send()} disabled={sending || method.trim() === ''}>
            <Send />
            {t('raw.send')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">{t('raw.params')}</label>
        <textarea
          className="h-32 w-full resize-y rounded-md border bg-transparent p-3 font-mono text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive"
          value={paramsText}
          aria-invalid={paramsError ? true : undefined}
          onChange={(event) => setParamsText(event.target.value)}
        />
        {paramsError && <span className="text-xs text-destructive">{paramsError}</span>}
      </div>

      {response && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <h3 className="text-sm font-medium">{response.ok ? t('raw.responseOk') : t('raw.responseError')}</h3>
          <pre className="max-h-[45vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
            {JSON.stringify(
              {
                request: { jsonrpc: '2.0', method: response.method, params: response.params },
                response: response.ok ? { result: response.result } : { error: response.error },
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </div>
  );
}
