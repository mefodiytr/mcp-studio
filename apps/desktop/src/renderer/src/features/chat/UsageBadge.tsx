import { useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Conversation } from '../../../../shared/domain/conversations';

import {
  ANTHROPIC_PRICES_AS_OF,
  CONVERSATION_SOFT_CAP_TOKENS,
  capStatus,
  estimateCost,
  formatTokens,
  formatUsd,
  sumUsage,
} from '@renderer/lib/llm-pricing';
import { cn } from '@renderer/lib/utils';

/**
 * Per-conversation usage chip — running total of input+output tokens with a
 * cost estimate (approximate, prices as of `ANTHROPIC_PRICES_AS_OF`). Sits in
 * the chat header; turns amber at 80 % of the soft cap and red at 100 %+
 * (still soft — sending isn't blocked).
 *
 * The cost line lives in a tooltip on hover so the chip stays compact; the
 * tooltip explicitly tags the number as approximate + carries the prices-as-of
 * date so the operator knows the recency of the table.
 */

const DEFAULT_MODEL = 'claude-opus-4-7';

export function UsageBadge({ conversation }: { conversation: Conversation }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(false);

  const { totalTokens, inputTokens, outputTokens, cost, status, modelUsed } = useMemo(() => {
    const sum = sumUsage(conversation.messages);
    const model = conversation.model ?? DEFAULT_MODEL;
    const c = estimateCost(model, sum.inputTokens, sum.outputTokens);
    return {
      totalTokens: sum.inputTokens + sum.outputTokens,
      inputTokens: sum.inputTokens,
      outputTokens: sum.outputTokens,
      cost: c,
      status: capStatus(sum.inputTokens + sum.outputTokens),
      modelUsed: model,
    };
  }, [conversation]);

  if (totalTokens === 0) return null;

  const colour =
    status === 'over'
      ? 'bg-destructive/10 text-destructive border-destructive/40'
      : status === 'warn'
        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40'
        : 'bg-muted text-muted-foreground border-transparent';

  return (
    <div className="relative inline-flex">
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]',
          colour,
        )}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        tabIndex={0}
        aria-label={t('chat.usage.aria', {
          tokens: formatTokens(totalTokens),
          cost: formatUsd(cost.usd),
        })}
      >
        {(status === 'warn' || status === 'over') && (
          <TriangleAlert className="size-3" aria-hidden />
        )}
        <span>{formatTokens(totalTokens)} {t('chat.usage.tokensSuffix')}</span>
        <span className="text-muted-foreground/70">·</span>
        <span>~{formatUsd(cost.usd)}</span>
      </span>
      {hover && (
        <div
          role="tooltip"
          className="absolute right-0 top-full z-10 mt-1 w-64 rounded-md border bg-popover p-2 text-[11px] text-popover-foreground shadow-md"
        >
          <div className="mb-1 font-medium">{t('chat.usage.tooltipTitle')}</div>
          <dl className="space-y-0.5">
            <Row label={t('chat.usage.input')} value={formatTokens(inputTokens)} />
            <Row label={t('chat.usage.output')} value={formatTokens(outputTokens)} />
            <Row label={t('chat.usage.total')} value={formatTokens(totalTokens)} />
            <Row label={t('chat.usage.model')} value={modelUsed} />
            <Row label={t('chat.usage.cost')} value={`~${formatUsd(cost.usd)}`} />
          </dl>
          {status === 'warn' && (
            <p className="mt-2 text-amber-700 dark:text-amber-300">
              {t('chat.usage.warnNearCap', {
                pct: Math.round((totalTokens / CONVERSATION_SOFT_CAP_TOKENS) * 100),
                cap: formatTokens(CONVERSATION_SOFT_CAP_TOKENS),
              })}
            </p>
          )}
          {status === 'over' && (
            <p className="mt-2 text-destructive">
              {t('chat.usage.warnOverCap', { cap: formatTokens(CONVERSATION_SOFT_CAP_TOKENS) })}
            </p>
          )}
          {cost.modelPriced === 'unknown' && (
            <p className="mt-2 text-muted-foreground italic">{t('chat.usage.unknownModel')}</p>
          )}
          <p className="mt-2 text-muted-foreground italic">
            {t('chat.usage.disclaimer', { date: ANTHROPIC_PRICES_AS_OF })}
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
