import { useTranslation } from 'react-i18next';

/**
 * Chat-inline chart renderer (M5 D8).
 *
 * **STUB — C71 placeholder.** Full implementation lands in C76:
 *   - zod-validate the payload against `chartPayloadSchema`
 *   - render `<TimeSeriesChart>` from `@mcp-studio/charts`
 *   - "Show payload" toggle for debugging
 *   - oversized-payload guard at 256 kB
 *
 * For C71 the chart code-fence interception in `MarkdownRenderer.components.code`
 * routes the payload here; this stub renders a "Chart rendering arrives in
 * C76" placeholder with the payload visible in a `<pre>`. The interception
 * point is in place; the rendering body is a one-spot wire-up in C76.
 */
export function ChatChart({ payloadText }: { payloadText: string }) {
  const { t } = useTranslation();
  return (
    <div className="not-prose my-2 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 p-3 text-xs">
      <div className="mb-2 font-medium text-muted-foreground">{t('chat.chartStub')}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
        {payloadText}
      </pre>
    </div>
  );
}
