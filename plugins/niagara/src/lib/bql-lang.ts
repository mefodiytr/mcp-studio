import { StreamLanguage } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

/**
 * A minimal CodeMirror 6 mode for Niagara BQL — keyword / string / number /
 * operator tokenisation, enough for readable highlighting in the playground.
 * (A full Lezer grammar with completion is a follow-up.)
 */
const KEYWORDS = new Set([
  'select', 'distinct', 'from', 'where', 'and', 'or', 'not', 'like', 'order',
  'by', 'asc', 'desc', 'group', 'having', 'as', 'in', 'is', 'null', 'true',
  'false', 'bql',
]);

export function bqlLanguage(): Extension {
  return StreamLanguage.define<unknown>({
    name: 'bql',
    token(stream) {
      if (stream.eatSpace()) return null;
      const ch = stream.peek();
      if (ch === undefined) return null;
      if (ch === "'" || ch === '"') {
        stream.next();
        let prev = '';
        while (!stream.eol()) {
          const c = stream.next();
          if (c === ch && prev !== '\\') break;
          prev = c ?? '';
        }
        return 'string';
      }
      if (/[0-9]/.test(ch)) {
        stream.eatWhile(/[0-9.]/);
        return 'number';
      }
      if (/[A-Za-z_$]/.test(ch)) {
        stream.eatWhile(/[\w$:.]/);
        return KEYWORDS.has(stream.current().toLowerCase()) ? 'keyword' : 'variableName';
      }
      stream.next();
      return /[=<>!*/+\-,|]/.test(ch) ? 'operator' : null;
    },
  });
}
