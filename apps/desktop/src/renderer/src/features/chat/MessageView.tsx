import { useTranslation } from 'react-i18next';

import type { Message } from '../../../../shared/domain/conversations';

import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolCallEnvelope } from './ToolCallEnvelope';

/**
 * Render one persisted message. User messages display as right-aligned text
 * bubbles; assistant messages stack their content blocks vertically (text via
 * markdown; tool_use blocks as collapsible envelopes; tool_result is shown
 * inline within its corresponding tool_use envelope, looked up by tool_use_id
 * from the *next* user message). Synthetic markers (aborted / max-turns) show
 * as a small inline tag.
 *
 * For C71, tool_result lookup is simplified — the renderer pairs `tool_use`
 * with the matching `tool_result` block from `nextUserMessage` if provided.
 * A richer pair-and-collapse interaction is C77 polish.
 */
export interface InlineToolResult {
  tool_use_id: string;
  content: unknown;
  isError?: boolean;
}

export function MessageView({
  message,
  toolResults,
}: {
  message: Message;
  /** Tool result blocks from the immediately-following user message (which
   *  carries the tool_result blocks per Anthropic Messages API convention). */
  toolResults?: InlineToolResult[];
}) {
  const { t } = useTranslation();

  if (message.marker) {
    return (
      <div className="my-2 text-center text-xs uppercase tracking-wide text-muted-foreground">
        — {t(`chat.marker.${message.marker}`)} —
      </div>
    );
  }

  if (message.role === 'user') {
    // User message — if it carries only tool_result blocks, it's the
    // mid-loop dispatch turn; skip rendering (the results render inline with
    // their tool_use parents above).
    const onlyToolResults = message.content.every((b) => b.type === 'tool_result');
    if (onlyToolResults) return null;

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n');
    return (
      <div className="my-3 flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm">
          {text || <span className="text-muted-foreground">(empty)</span>}
        </div>
      </div>
    );
  }

  // Assistant message: stack text + tool_use envelopes.
  return (
    <div className="my-3 space-y-2 text-sm">
      {message.content.map((block, i) => {
        if (block.type === 'text') {
          return <MarkdownRenderer key={i} text={block.text} />;
        }
        if (block.type === 'tool_use') {
          const result = toolResults?.find((r) => r.tool_use_id === block.id);
          return (
            <ToolCallEnvelope
              key={block.id}
              name={block.name}
              args={block.input}
              status={result ? (result.isError ? 'error' : 'complete') : 'pending'}
              output={result?.content}
              outputSummary={result ? summarise(result.content) : undefined}
            />
          );
        }
        // tool_result inside an assistant message shouldn't happen per
        // Anthropic Messages API conventions; render a small fallback.
        return (
          <div key={i} className="text-xs text-muted-foreground">
            (unexpected tool_result in assistant message)
          </div>
        );
      })}
    </div>
  );
}

function summarise(output: unknown): string {
  if (typeof output === 'string') {
    return output.length > 60 ? output.slice(0, 57) + '…' : output;
  }
  if (output === null || output === undefined) return '(no output)';
  try {
    const j = JSON.stringify(output);
    return j.length > 60 ? j.slice(0, 57) + '…' : j;
  } catch {
    return String(output);
  }
}
