import { useMemo } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Loader2,
  MinusCircle,
  Play,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { PlanStep } from '@mcp-studio/plugin-api';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';

/**
 * Inline collapsible card the chat view renders between the launching user
 * message + the plan execution (M6 D3). Two states:
 *
 *   - **Preview** (no `executionState`): shows the plan's steps + the
 *     collected `params`; the "Run plan" button kicks off execution.
 *   - **Running / Done** (`executionState` present): each step shows its
 *     status (pending / running / done / skipped / error) with a per-step
 *     icon. The card collapses to a one-line summary post-completion.
 *
 * **What's intentionally NOT in C83b** (deferred to m6-followups):
 *   - Per-step edit form for `args` / `prompt` / `runIf` — preview is
 *     read-only in v1. Operators can cancel + relaunch a flow with
 *     different `params` instead.
 *   - Per-step "Run / Skip" toggle (disabling individual steps before run).
 *
 * The two read-only constraints keep this commit focused on the plan-
 * execute path; the M6 deliverable (Phase C) doesn't require the editor
 * surface beyond preview + run + status visualisation.
 */

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface PlanStepExecutionState {
  status: StepStatus;
  /** Error message — only present on `'error'`. */
  errorMessage?: string;
  /** Skip reason — only present on `'skipped'`. */
  skipReason?: string;
}

export interface PlanEditorProps {
  flowTitle: string;
  flowDescription: string;
  plan: readonly PlanStep[];
  params: Record<string, unknown>;
  /** Per-step status map. Absent → the card renders in preview state with
   *  the Run button. Present → the card renders in running / done state. */
  executionState?: Record<string, PlanStepExecutionState>;
  /** True while runPlan is actively yielding events; disables the Run
   *  button + flips the cancel control to "Stop". */
  running: boolean;
  /** Whether the card body is expanded. Pre-execution: defaults open;
   *  post-completion: defaults collapsed so the chat log stays readable. */
  expanded: boolean;
  onToggleExpanded: () => void;
  onRun: () => void;
  onCancel: () => void;
}

export function PlanEditor(props: PlanEditorProps) {
  const { t } = useTranslation();
  const {
    flowTitle,
    flowDescription,
    plan,
    params,
    executionState,
    running,
    expanded,
    onToggleExpanded,
    onRun,
    onCancel,
  } = props;

  const summary = useMemo(() => {
    if (!executionState) return null;
    let done = 0;
    let skipped = 0;
    let errored = 0;
    for (const s of plan) {
      const st = executionState[s.id];
      if (!st) continue;
      if (st.status === 'done') done++;
      else if (st.status === 'skipped') skipped++;
      else if (st.status === 'error') errored++;
    }
    return { done, skipped, errored };
  }, [executionState, plan]);

  const paramEntries = Object.entries(params);

  return (
    <div className="not-prose my-3 rounded-md border bg-card">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-2 border-b bg-muted/30 px-3 py-2 text-left hover:bg-muted/50"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="text-sm font-medium">{flowTitle}</span>
        {summary && (
          <span className="ml-auto text-xs text-muted-foreground">
            {t('chat.plan.summary', {
              done: summary.done,
              total: plan.length,
              skipped: summary.skipped,
              errored: summary.errored,
            })}
          </span>
        )}
        {!summary && (
          <span className="ml-auto text-xs text-muted-foreground">
            {t('chat.plan.stepCount', { count: plan.length })}
          </span>
        )}
      </button>

      {expanded && (
        <div className="p-3">
          <p className="mb-3 text-xs text-muted-foreground">{flowDescription}</p>

          {paramEntries.length > 0 && (
            <div className="mb-3">
              <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('chat.plan.params')}
              </h4>
              <dl className="space-y-0.5 text-xs">
                {paramEntries.map(([name, value]) => (
                  <div key={name} className="flex gap-2">
                    <dt className="font-mono text-muted-foreground">{name}</dt>
                    <dd className="truncate font-mono">{formatParamValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <div>
            <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('chat.plan.steps')}
            </h4>
            <ol className="space-y-1">
              {plan.map((step, idx) => (
                <StepRow
                  key={step.id}
                  step={step}
                  index={idx + 1}
                  state={executionState?.[step.id]}
                />
              ))}
            </ol>
          </div>

          {!executionState && (
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={running}>
                {t('chat.plan.cancel')}
              </Button>
              <Button type="button" size="sm" onClick={onRun} disabled={running}>
                <Play className="size-3.5" aria-hidden />
                <span className="ml-1">{t('chat.plan.run')}</span>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepRow({
  step,
  index,
  state,
}: {
  step: PlanStep;
  index: number;
  state?: PlanStepExecutionState;
}) {
  const status: StepStatus = state?.status ?? 'pending';
  const labelText = step.label ?? defaultLabel(step);
  return (
    <li
      className={cn(
        'flex items-start gap-2 rounded border bg-background/50 px-2 py-1.5 text-xs',
        status === 'skipped' && 'opacity-60',
        status === 'error' && 'border-destructive/40',
      )}
    >
      <span className="mt-[2px] w-4 shrink-0 text-center text-[10px] text-muted-foreground">
        {index}.
      </span>
      <StatusIcon status={status} />
      <span
        className={cn(
          'shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px]',
          step.kind === 'tool-call' && 'text-blue-700 dark:text-blue-300',
          step.kind === 'llm-step' && 'text-purple-700 dark:text-purple-300',
        )}
      >
        {step.kind}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono">{labelText}</div>
        {step.runIf && step.runIf.kind !== 'always' && (
          <div className="truncate text-[10px] text-muted-foreground">
            if {describeRunIf(step)}
          </div>
        )}
        {state?.skipReason && status === 'skipped' && (
          <div className="truncate text-[10px] text-muted-foreground">{state.skipReason}</div>
        )}
        {state?.errorMessage && status === 'error' && (
          <div className="truncate text-[10px] text-destructive">{state.errorMessage}</div>
        )}
      </div>
    </li>
  );
}

function StatusIcon({ status }: { status: StepStatus }) {
  const base = 'size-3.5 shrink-0 mt-[1px]';
  if (status === 'pending')
    return <span className={cn(base, 'inline-block rounded-full border')} aria-hidden />;
  if (status === 'running')
    return <Loader2 className={cn(base, 'animate-spin text-muted-foreground')} aria-hidden />;
  if (status === 'done') return <Check className={cn(base, 'text-emerald-600')} aria-hidden />;
  if (status === 'skipped')
    return <MinusCircle className={cn(base, 'text-muted-foreground')} aria-hidden />;
  if (status === 'error') return <CircleAlert className={cn(base, 'text-destructive')} aria-hidden />;
  return null;
}

function defaultLabel(step: PlanStep): string {
  if (step.kind === 'tool-call') {
    const argsPreview = Object.entries(step.args)
      .map(([k, v]) => `${k}: ${shortValue(v)}`)
      .join(', ');
    return `${step.tool}(${argsPreview})`;
  }
  // llm-step
  const truncated = step.prompt.length > 80 ? step.prompt.slice(0, 77) + '…' : step.prompt;
  return truncated;
}

function shortValue(v: unknown): string {
  if (typeof v === 'string') {
    if (v.length > 30) return JSON.stringify(v.slice(0, 27) + '…');
    return JSON.stringify(v);
  }
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  return '{…}';
}

function describeRunIf(step: PlanStep): string {
  const cond = step.runIf;
  if (!cond) return '';
  switch (cond.kind) {
    case 'always':
      return 'always';
    case 'never':
      return 'never';
    case 'var-truthy':
      return `${cond.path}`;
    case 'var-defined':
      return `${cond.path} defined`;
    case 'var-compare':
      return `${cond.path} ${cond.op} ${JSON.stringify(cond.value)}`;
    case 'var-length-gt':
      return `${cond.path}.length > ${cond.value}`;
  }
}

function formatParamValue(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

