import { useState } from 'react';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import CodeMirror from '@uiw/react-codemirror';
import { History as HistoryIcon, Play } from 'lucide-react';
import { Button } from '@mcp-studio/ui';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { buildBqlQuery, type BqlResult } from '../lib/bql';
import { bqlLanguage } from '../lib/bql-lang';
import { bqlQuery } from '../lib/niagara-api';
import { fullOrd, ROOT_ORD } from '../lib/ord';
import { useExplorerStore } from '../state/explorer-store';

const HISTORY_KEY = 'niagara.bql.history';
const HISTORY_MAX = 25;
const DEFAULT_QUERY = 'select displayName, type from baja:Component';
/** Cell values worth turning into a navigate-here link (a `slot:`/`station:`
 *  ORD, or an absolute `/A/B` slot path). */
const ORD_RE = /^(station:\||slot:\/|\/[A-Za-z$])/;
type RunResult = BqlResult & { raw: string };

function loadHistory(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveHistory(h: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, HISTORY_MAX)));
  } catch {
    /* storage unavailable / quota — history is best-effort */
  }
}

/**
 * The BQL playground: a CodeMirror editor (minimal BQL highlighting) over a
 * sortable result table. The query text is a plain `SELECT …`; the
 * fully-qualified `<ord>|bql:` prefix niagaramcp requires is built from the Base
 * ORD field, and row-capping uses the dedicated Limit control (a stray
 * SQL-style `LIMIT n` in the text is stripped with a warning). ORD-looking
 * result cells become navigate-here links; queries are remembered in
 * localStorage.
 */
export function BqlView({ ctx }: { ctx: PluginContext }) {
  const selected = useExplorerStore((s) => s.selected);
  const reveal = useExplorerStore((s) => s.reveal);

  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [baseOrd, setBaseOrd] = useState(selected ?? ROOT_ORD);
  const [limit, setLimit] = useState(100);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);

  const built = buildBqlQuery(baseOrd, query);

  const run = useMutation<RunResult, Error, void>({
    mutationFn: () => bqlQuery(ctx, built.query, limit),
    onSuccess: () => {
      const q = query.trim();
      if (!q) return;
      setHistory((h) => {
        const next = [q, ...h.filter((x) => x !== q)];
        saveHistory(next);
        return next.slice(0, HISTORY_MAX);
      });
    },
  });

  const navigate = (ord: string): void => {
    const full = fullOrd(ord);
    reveal(full);
    ctx.setCwd(full);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-2">
        <div className="overflow-hidden rounded border text-sm">
          <CodeMirror
            value={query}
            height="120px"
            extensions={[bqlLanguage()]}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
            placeholder={DEFAULT_QUERY}
            onChange={setQuery}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Base ORD</span>
            <input
              value={baseOrd}
              onChange={(e) => setBaseOrd(e.target.value)}
              spellCheck={false}
              className="w-56 rounded border bg-background px-1.5 py-1 font-mono"
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Limit</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
              className="w-20 rounded border bg-background px-1.5 py-1"
            />
          </label>
          <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending || query.trim() === ''}>
            <Play className="size-3.5" aria-hidden />
            {run.isPending ? 'Running…' : 'Run'}
          </Button>
          {history.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>
              <HistoryIcon className="size-3.5" aria-hidden />
              History
            </Button>
          )}
        </div>
        {built.strayLimit && (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            Dropped a <code>LIMIT</code> clause — Niagara BQL has none; use the Limit control instead.
          </p>
        )}
        {showHistory && history.length > 0 && (
          <ul className="max-h-32 divide-y overflow-auto rounded border text-xs">
            {history.map((q, i) => (
              <li key={`${i}-${q}`}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(q);
                    setShowHistory(false);
                  }}
                  className="block w-full truncate px-2 py-1 text-left font-mono hover:bg-accent"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <BqlResultTable run={run} onNavigate={navigate} />
      </div>
    </div>
  );
}

function BqlResultTable({
  run,
  onNavigate,
}: {
  run: UseMutationResult<RunResult, Error, void, unknown>;
  onNavigate: (ord: string) => void;
}) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);

  if (run.isIdle) return <p className="p-3 text-xs text-muted-foreground">Enter a BQL query and press Run.</p>;
  if (run.isPending) return <p className="p-3 text-xs text-muted-foreground">Running…</p>;
  if (run.isError) {
    return (
      <p className="whitespace-pre-wrap p-3 text-xs text-destructive">
        {run.error instanceof Error ? run.error.message : 'Query failed'}
      </p>
    );
  }
  const { columns, rows, rowCount } = run.data;
  if (columns.length === 0) return <p className="p-3 text-xs italic text-muted-foreground">no rows</p>;

  const sorted = sort
    ? [...rows].sort(
        (a, b) => sort.dir * (a[sort.col] ?? '').localeCompare(b[sort.col] ?? '', undefined, { numeric: true }),
      )
    : rows;
  const toggle = (c: number): void =>
    setSort((s) => (s && s.col === c ? { col: c, dir: (s.dir * -1) as 1 | -1 } : { col: c, dir: 1 }));

  return (
    <table className="w-full border-collapse text-xs">
      <thead className="sticky top-0 bg-background">
        <tr className="border-b text-left text-muted-foreground">
          {columns.map((c, i) => (
            <th key={i} className="font-medium">
              <button type="button" onClick={() => toggle(i)} className="flex items-center gap-1 px-2 py-1.5 hover:text-foreground">
                {c}
                {sort?.col === i && <span aria-hidden>{sort.dir === 1 ? '▲' : '▼'}</span>}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, ri) => (
          <tr key={ri} className="border-b border-border/50">
            {columns.map((_, ci) => {
              const cell = row[ci] ?? '';
              return (
                <td key={ci} className="px-2 py-1 font-mono">
                  {ORD_RE.test(cell) ? (
                    <button
                      type="button"
                      onClick={() => onNavigate(cell)}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {cell}
                    </button>
                  ) : (
                    cell
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={columns.length} className="px-2 py-1 text-muted-foreground">
            {rowCount} row{rowCount === 1 ? '' : 's'}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
