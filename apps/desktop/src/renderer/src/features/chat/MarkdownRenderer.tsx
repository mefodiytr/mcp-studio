import { type ReactNode, useMemo } from 'react';
import { Network } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useHostBus } from '@mcp-studio/plugin-api';

import { cn } from '@renderer/lib/utils';

import { ChatChart, parseChartPayload } from './ChatChart';

const ORD_LINK_PROTOCOL = 'mcp-studio-ord:';

/** Rewrite `<ord>X</ord>` into `[X](mcp-studio-ord:<base64>)` markdown links —
 *  the regular link pipeline handles them after this pass; the custom
 *  `components.a` decodes the base64 + renders a clickable ord chip.
 *
 *  Base64 keeps ord characters that markdown's link syntax doesn't like
 *  (parentheses, pipes, slashes, spaces) round-trippable through `[label](url)`. */
function rewriteOrdRefs(text: string): string {
  return text.replace(/<ord>(.*?)<\/ord>/g, (_, raw: string) => {
    const ord = raw.trim();
    if (!ord) return raw;
    const encoded = btoa(unescape(encodeURIComponent(ord)));
    return `[${ord}](${ORD_LINK_PROTOCOL}${encoded})`;
  });
}

function decodeOrdHref(href: string | undefined): string | null {
  if (!href || !href.startsWith(ORD_LINK_PROTOCOL)) return null;
  try {
    return decodeURIComponent(escape(atob(href.slice(ORD_LINK_PROTOCOL.length))));
  } catch {
    return null;
  }
}

/**
 * Assistant-message markdown renderer.
 *
 * - `react-markdown` + `remark-gfm` (tables, strikethrough, task lists).
 * - The `components.code` handler intercepts ```chart ... ``` code fences
 *   (D8 — JSON code fence with `language-chart`):
 *     - On a successful parse (or a schema/oversize failure), renders
 *       `<ChatChart>` — successful renders the chart; schema/oversize show
 *       a warning chip + the raw payload.
 *     - On a JSON parse failure, falls through to the default `<pre><code>`
 *       block. This preserves the LLM's ability to *document* the chart
 *       syntax with a deliberately-invalid example in a `chart` code block
 *       — the user sees the example as a normal code snippet, not a broken
 *       chart warning.
 * - `<ord>...</ord>` inline refs (C79) are pre-rewritten as markdown links
 *   with the `mcp-studio-ord:` protocol; `components.a` decodes the base64
 *   ord + renders a clickable chip that publishes to the plugin-api host bus.
 *   The AppShell switches to the Niagara plugin's Explorer view + the
 *   Explorer consumes the published ord and calls `select(ord)`.
 */
export function MarkdownRenderer({ text }: { text: string }): ReactNode {
  const publishOrd = useHostBus((s) => s.publishOrdNav);
  // Memo so a re-render with the same text doesn't re-parse + re-render the
  // tree. The parent (Message component) controls when this view updates.
  return useMemo(
    () => (
      <div className="markdown prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code(props) {
              const { className, children, ...rest } = props;
              const match = /language-(\w+)/.exec(className ?? '');
              const language = match?.[1];
              const codeText = String(children).replace(/\n$/, '');
              if (language === 'chart') {
                const outcome = parseChartPayload(codeText);
                // `json-error` falls through to the default code-block path
                // (the LLM is documenting syntax, not emitting a chart).
                if (outcome.kind === 'ok' || outcome.reason !== 'json-error') {
                  return <ChatChart payloadText={codeText} />;
                }
              }
              return (
                <code className={cn(className, 'rounded bg-muted px-1 py-0.5')} {...rest}>
                  {children}
                </code>
              );
            },
            pre(props) {
              // Default `<pre>` styling — react-markdown nests `<code>` inside.
              return (
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {props.children}
                </pre>
              );
            },
            a(props) {
              const { href, children } = props;
              const ord = decodeOrdHref(href);
              if (ord !== null) {
                return (
                  <button
                    type="button"
                    className="not-prose mx-0.5 inline-flex items-center gap-1 rounded border bg-muted/50 px-1.5 py-0.5 align-baseline text-[12px] font-mono text-foreground hover:bg-muted"
                    onClick={() => publishOrd(ord)}
                    title={`Open ${ord} in the Niagara Explorer`}
                  >
                    <Network className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    {ord}
                  </button>
                );
              }
              return (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              );
            },
          }}
        >
          {rewriteOrdRefs(text)}
        </ReactMarkdown>
      </div>
    ),
    [text, publishOrd],
  );
}
