/**
 * Pure helpers for the BQL playground: building the `bqlQuery` `query` argument
 * (which niagaramcp insists on prefixing with a fully-qualified ORD and a
 * `|bql:` marker) and parsing the TSV body it returns. The host-side warts are
 * tracked in `docs/m1-followups.md` (niagaramcp coordination); this papers over
 * them — a plain `SELECT` gets a base-ORD prefix, and a stray SQL-style
 * `LIMIT n` (Niagara BQL has no such clause) is stripped with a warning.
 */
import { fullOrd } from './ord';

export const BQL_MARKER = '|bql:';

/** True if `text` already carries an `|bql:` ORD prefix (i.e. a full query string). */
export function hasOrdPrefix(text: string): boolean {
  return text.includes(BQL_MARKER);
}

/** A trailing SQL-style `LIMIT n` — not valid Niagara BQL; row-capping is the
 *  `bqlQuery` tool's separate `limit` arg. */
const STRAY_LIMIT = /\s+limit\s+\d+\s*;?\s*$/i;

export function stripStrayLimit(query: string): { query: string; stripped: boolean } {
  const cleaned = query.replace(STRAY_LIMIT, '');
  return { query: cleaned, stripped: cleaned !== query };
}

/** Build the `query` argument for the `bqlQuery` tool. If `text` already has an
 *  `|bql:` ORD prefix it's used verbatim (minus a stray `LIMIT`); otherwise
 *  `baseOrd` (coerced to the full `station:|slot:/…` form) is prepended. */
export function buildBqlQuery(baseOrd: string, text: string): { query: string; strayLimit: boolean } {
  const { query: body, stripped } = stripStrayLimit(text.trim());
  if (hasOrdPrefix(body)) return { query: body, strayLimit: stripped };
  return { query: `${fullOrd(baseOrd)}${BQL_MARKER}${body}`, strayLimit: stripped };
}

export interface BqlResult {
  columns: string[];
  rows: string[][];
  /** The `[rows=N]` footer count if niagaramcp included one, else `rows.length`. */
  rowCount: number;
}

/**
 * Parse the TSV body niagaramcp returns in `content[0].text`: line 0 is the
 * tab-separated column names, the data rows follow, then (optionally) a blank
 * line and a `[rows=N]` footer. Tolerant of missing footer / trailing blanks /
 * CRLF / an empty body.
 */
export function parseTsv(text: string): BqlResult {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let footer: number | undefined;
  // Peel a trailing `[rows=N]` footer and any blank lines.
  while (lines.length > 0) {
    const last = lines[lines.length - 1]!.trim();
    if (last === '') {
      lines.pop();
      continue;
    }
    const m = /^\[rows=(\d+)\]$/.exec(last);
    if (m) {
      footer = Number(m[1]);
      lines.pop();
      continue;
    }
    break;
  }
  if (lines.length === 0) return { columns: [], rows: [], rowCount: footer ?? 0 };
  const columns = lines[0]!.split('\t');
  const rows = lines
    .slice(1)
    .filter((l) => l !== '')
    .map((l) => l.split('\t'));
  return { columns, rows, rowCount: footer ?? rows.length };
}
