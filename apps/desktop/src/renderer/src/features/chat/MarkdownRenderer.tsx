import { type ReactNode, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@renderer/lib/utils';

import { ChatChart, parseChartPayload } from './ChatChart';

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
 */
export function MarkdownRenderer({ text }: { text: string }): ReactNode {
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
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    ),
    [text],
  );
}
