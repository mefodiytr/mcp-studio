import { useEffect, useState } from 'react';
import { SchemaForm } from '@mcp-studio/schema-form/react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { describeError } from '@renderer/lib/errors';
import { useHistory } from '@renderer/lib/history';
import { expandTemplates } from '@renderer/lib/templating';
import { callTool } from '@renderer/lib/tools';
import { useTemplatingStore } from '@renderer/stores/templating';
import type { ToolDescriptor } from '@shared/domain/connection';
import type { CallToolResult, ContentBlock, ToolCallError } from '@shared/domain/tool-result';

interface Outcome {
  args: unknown;
  result: CallToolResult | null;
  error: ToolCallError | string | null;
}

interface PromptRequest {
  label: string;
  resolve: (value: string) => void;
  reject: (cause: unknown) => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function ToolInvocationDialog({
  connectionId,
  tool,
  open,
  onOpenChange,
  initialArgs,
}: {
  connectionId: string;
  tool: ToolDescriptor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill the args form (e.g. "edit & re-run" from history). */
  initialArgs?: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const history = useHistory();
  const lastResult = history.data?.find((entry) => entry.result != null)?.result;
  const lastEntry = history.data?.find((entry) => entry.toolName === tool.name);
  const cwd = useTemplatingStore((s) => s.cwd);

  const [calling, setCalling] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pendingArgs, setPendingArgs] = useState<Record<string, unknown> | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [recalled, setRecalled] = useState<Record<string, unknown> | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => setPromptValue(''), [prompt]);

  const doCall = async (rawArgs: Record<string, unknown>): Promise<void> => {
    setCalling(true);
    setShowRaw(false);
    let args: Record<string, unknown>;
    try {
      const promptFor = (label: string): Promise<string> =>
        new Promise<string>((resolve, reject) => setPrompt({ label, resolve, reject }));
      args = asRecord(await expandTemplates(rawArgs, { lastResult, cwd, promptFor }));
    } catch {
      setCalling(false); // prompt cancelled
      return;
    }
    try {
      const res = await callTool(connectionId, tool.name, args);
      setOutcome({ args, result: res.result, error: res.error });
    } catch (cause) {
      setOutcome({ args, result: null, error: describeError(cause) });
    } finally {
      setCalling(false);
    }
  };

  const onSubmit = (value: unknown): void => {
    const args = asRecord(value);
    if (tool.annotations?.destructiveHint) {
      setPendingArgs(args);
      return;
    }
    void doCall(args);
  };

  const recallLastArgs = (): void => {
    if (!lastEntry) return;
    setRecalled(asRecord(lastEntry.args));
    setFormKey((k) => k + 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">{tool.name}</DialogTitle>
          {(tool.title ?? tool.description) && (
            <DialogDescription>{tool.title ?? tool.description}</DialogDescription>
          )}
        </DialogHeader>

        {pendingArgs ? (
          <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-medium text-destructive">{t('tools.destructiveWarning')}</p>
            <pre className="max-h-40 overflow-auto rounded bg-background p-2 font-mono text-xs">
              {JSON.stringify(pendingArgs, null, 2)}
            </pre>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  const args = pendingArgs;
                  setPendingArgs(null);
                  void doCall(args);
                }}
              >
                {t('tools.runAnyway')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPendingArgs(null)}>
                {t('tools.cancel')}
              </Button>
            </div>
          </div>
        ) : prompt ? (
          <form
            className="flex flex-col gap-2 rounded-md border p-3 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              prompt.resolve(promptValue);
              setPrompt(null);
            }}
          >
            <label className="font-medium">{prompt.label}</label>
            <div className="flex gap-2">
              <Input autoFocus value={promptValue} onChange={(event) => setPromptValue(event.target.value)} />
              <Button type="submit" size="sm">
                {t('tools.promptOk')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  prompt.reject(new Error('prompt cancelled'));
                  setPrompt(null);
                }}
              >
                {t('tools.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            {lastEntry && (
              <div>
                <Button size="sm" variant="ghost" onClick={recallLastArgs}>
                  {t('tools.useLastArgs')}
                </Button>
              </div>
            )}
            <SchemaForm
              key={formKey}
              schema={tool.inputSchema}
              initialValue={recalled ?? initialArgs}
              onSubmit={onSubmit}
              submitLabel={calling ? '…' : t('tools.call')}
              busy={calling}
            />
          </div>
        )}

        {outcome && (
          <ResultBlock
            outcome={outcome}
            toolName={tool.name}
            showRaw={showRaw}
            onToggleRaw={() => setShowRaw((v) => !v)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResultBlock({
  outcome,
  toolName,
  showRaw,
  onToggleRaw,
}: {
  outcome: Outcome;
  toolName: string;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  const { t } = useTranslation();
  const { args, result, error } = outcome;
  const errorLine =
    typeof error === 'string' ? error : error ? (error.code != null ? `[${error.code}] ${error.message}` : error.message) : '';

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">{t('tools.result')}</h3>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onToggleRaw}>
          {showRaw ? t('tools.hideRaw') : t('tools.showRaw')}
        </Button>
      </div>
      {showRaw && (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {JSON.stringify(
            {
              request: { method: 'tools/call', params: { name: toolName, arguments: args } },
              response: error ? { error } : { result },
            },
            null,
            2,
          )}
        </pre>
      )}
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">{errorLine}</p>
          {typeof error !== 'string' && error.data !== undefined && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">{t('tools.errorData')}</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-xs">
                {JSON.stringify(error.data, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ) : result ? (
        <CallResultContent result={result} />
      ) : null}
    </div>
  );
}

function CallResultContent({ result }: { result: CallToolResult }) {
  const { t } = useTranslation();
  const empty = result.content.length === 0 && result.structuredContent === undefined;
  return (
    <div className="flex flex-col gap-2">
      {result.isError && <p className="text-xs text-destructive">{t('tools.toolReportedError')}</p>}
      {empty && <p className="text-xs text-muted-foreground">{t('tools.emptyResult')}</p>}
      {result.content.map((block, index) => (
        <ContentBlockView key={index} block={block} />
      ))}
      {result.structuredContent !== undefined && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">{t('tools.structuredContent')}</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
            {JSON.stringify(result.structuredContent, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function ContentBlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text': {
      const text = str(block['text']);
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON — show as-is */
      }
      return (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
          {pretty}
        </pre>
      );
    }
    case 'image':
      return (
        <img
          src={`data:${str(block['mimeType'], 'image/png')};base64,${str(block['data'])}`}
          alt="tool result"
          className="max-h-80 rounded-md border"
        />
      );
    case 'audio':
      return <audio controls src={`data:${str(block['mimeType'], 'audio/wav')};base64,${str(block['data'])}`} />;
    case 'resource_link':
      return (
        <div className="rounded-md border bg-muted p-2 text-xs">
          <span className="font-mono">{str(block['uri'])}</span>
          {str(block['name']) && ` — ${str(block['name'])}`}
          {str(block['mimeType']) && ` (${str(block['mimeType'])})`}
        </div>
      );
    case 'resource': {
      const resource = block['resource'];
      const text =
        resource && typeof resource === 'object' && typeof (resource as Record<string, unknown>)['text'] === 'string'
          ? ((resource as Record<string, unknown>)['text'] as string)
          : undefined;
      return text !== undefined ? (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{text}</pre>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {JSON.stringify(resource, null, 2)}
        </pre>
      );
    }
    default:
      return (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {JSON.stringify(block, null, 2)}
        </pre>
      );
  }
}
