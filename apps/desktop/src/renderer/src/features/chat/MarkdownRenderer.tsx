import { type ReactNode, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@renderer/lib/utils';

import { ChatChart } from './ChatChart';

/**
 * Assistant-message markdown renderer.
 *
 * - `react-markdown` + `remark-gfm` (tables, strikethrough, task lists).
 * - The `components.code` handler intercepts ```chart ... ``` code fences
 *   (D8 — JSON code fence with `language-chart`): it parses the body as JSON
 *   and renders a `<ChatChart>` via the M4 `@mcp-studio/charts` primitives.
 *   Parse failure or zod validation failure → falls through to the default
 *   `<code>` rendering — the user sees the payload, not a broken chart.
 *
 * The full `language-chart` zod validation + `<TimeSeriesChart>` rendering
 * lands in C76. The C71 stub renders all chart fences as plain code blocks
 * but the interception point is in place so C76 is a one-spot wire-up.
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
                return <ChatChart payloadText={codeText} />;
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
