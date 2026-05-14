import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@renderer/lib/utils';

/**
 * Inline tool-call envelope inside an assistant message. Renders the live
 * call ("Calling `findEquipment(...)`…" with a spinner) while in-flight; on
 * completion collapses to a one-line summary with a "Show details" toggle
 * revealing the raw args + result JSON (consistent with the M1
 * ToolInvocationDialog raw JSON-RPC console).
 *
 * Status precedence: `error` → red; `complete` → green check; `pending` →
 * spinner. The C75 safety boundary adds a 4th status, `queued` ("queued for
 * operator approval — AI-proposed write"), with a deep-link back to the
 * Changes view.
 */
export interface ToolCallEnvelopeProps {
  name: string;
  args: Record<string, unknown>;
  status: 'pending' | 'complete' | 'error' | 'queued';
  output?: unknown;
  outputSummary?: string;
}

export function ToolCallEnvelope(props: ToolCallEnvelopeProps) {
  const { name, args, status, output, outputSummary } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const argsPreview = renderArgsPreview(args);

  return (
    <div
      className={cn(
        'my-2 rounded-md border bg-card text-xs',
        status === 'error' && 'border-destructive/40',
        status === 'queued' && 'border-amber-500/50',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/40"
      >
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <StatusIcon status={status} />
        <span className="font-mono">{name}</span>
        <span className="truncate font-mono text-muted-foreground">{argsPreview}</span>
        {status === 'complete' && outputSummary && (
          <span className="ml-auto truncate pl-2 text-muted-foreground">→ {outputSummary}</span>
        )}
        {status === 'queued' && (
          <span className="ml-auto truncate pl-2 text-amber-600 dark:text-amber-400">
            {t('chat.toolQueued')}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t bg-muted/20 p-2 font-mono text-[11px]">
          <div className="mb-2 text-muted-foreground">{t('chat.toolArgs')}</div>
          <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(args, null, 2)}</pre>
          {output !== undefined && (
            <>
              <div className="mb-1 mt-2 text-muted-foreground">{t('chat.toolOutput')}</div>
              <pre className="overflow-x-auto whitespace-pre-wrap">
                {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: ToolCallEnvelopeProps['status'] }) {
  if (status === 'pending') return <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />;
  if (status === 'error') return <span className="size-2 shrink-0 rounded-full bg-destructive" aria-hidden />;
  if (status === 'queued') return <span className="size-2 shrink-0 rounded-full bg-amber-500" aria-hidden />;
  return <span className="size-2 shrink-0 rounded-full bg-green-600" aria-hidden />;
}

function renderArgsPreview(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '()';
  return (
    '(' +
    entries
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${shortValue(v)}`)
      .join(', ') +
    (entries.length > 3 ? ', …' : '') +
    ')'
  );
}

function shortValue(v: unknown): string {
  if (typeof v === 'string') return `"${v.length > 30 ? v.slice(0, 27) + '…' : v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null) return 'null';
  return Array.isArray(v) ? `[${v.length} items]` : '{…}';
}

