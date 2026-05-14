import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TimeSeriesChart } from '@mcp-studio/charts';

import { cn } from '@renderer/lib/utils';

import { parseChartPayload } from './chart-payload';

/**
 * Chat-inline chart renderer — M5 D8.
 *
 * The chat view's `MarkdownRenderer` intercepts ```chart ... ``` code fences
 * via `react-markdown`'s `components.code` and routes the payload string
 * here when the parse succeeds (or fails with anything except `json-error`
 * — that one falls back to a plain code block so the LLM can document the
 * chart syntax with a deliberately-invalid example).
 *
 * Pipeline (see `chart-payload.ts` for the parser):
 *   ok          → render the chart + truncation note + "Show payload" toggle
 *   oversized   → render the fallback warning chip + raw payload
 *   schema-err  → same
 *   no-points   → same
 *
 * Reuses `<TimeSeriesChart>` from `@mcp-studio/charts` — the same primitive
 * the M4 Niagara History view + the chat-inline chart use; one recharts
 * shared chunk (the C72 manualChunks split holds).
 */

const CHART_HEIGHT_PX = 240;

export { parseChartPayload } from './chart-payload';
export type {
  ChartPayload,
  ChartParseOk,
  ChartParseFailure,
  ChartParseOutcome,
} from './chart-payload';

export function ChatChart({ payloadText }: { payloadText: string }) {
  const { t } = useTranslation();
  const outcome = useMemo(() => parseChartPayload(payloadText), [payloadText]);
  const [showPayload, setShowPayload] = useState(false);

  if (outcome.kind === 'fallback') {
    return (
      <div className="not-prose my-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
          <TriangleAlert className="size-3.5" aria-hidden />
          {t(`chat.chartFallback.${outcome.reason}`)}
        </div>
        <div className="mb-2 text-muted-foreground">{outcome.message}</div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
          {payloadText}
        </pre>
      </div>
    );
  }

  const { payload, normalisedSeries, truncated } = outcome;

  return (
    <div className="not-prose my-3 rounded-md border bg-card">
      {payload.title && (
        <div className="border-b px-3 py-1.5 text-xs font-medium">{payload.title}</div>
      )}
      <div
        className="px-2 py-2"
        role="img"
        aria-label={payload.title ?? t('chat.chartAria')}
        tabIndex={0}
      >
        <TimeSeriesChart series={normalisedSeries} height={CHART_HEIGHT_PX} />
      </div>
      {truncated.length > 0 && (
        <div className="border-t px-3 py-1 text-[10px] text-muted-foreground">
          {truncated
            .map((tr) => t('chat.chartDownsampled', { name: tr.name, from: tr.from, to: tr.to }))
            .join(' · ')}
        </div>
      )}
      <div className="border-t">
        <button
          type="button"
          onClick={() => setShowPayload((v) => !v)}
          className={cn(
            'flex w-full items-center gap-1 px-3 py-1 text-left text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-muted/40',
          )}
        >
          {showPayload ? (
            <ChevronDown className="size-3" aria-hidden />
          ) : (
            <ChevronRight className="size-3" aria-hidden />
          )}
          {t('chat.chartShowPayload')}
        </button>
        {showPayload && (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all border-t px-3 py-2 text-[10px] text-muted-foreground">
            {payloadText}
          </pre>
        )}
      </div>
    </div>
  );
}
