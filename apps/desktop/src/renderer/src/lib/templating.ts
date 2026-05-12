/**
 * Argument templating for tool calls. A string value containing `{{…}}` tokens
 * is expanded before the call:
 *   {{now}}             — current ISO timestamp
 *   {{uuid}}            — a fresh random uuid
 *   {{cwd}}             — the active plugin view's "current directory" (e.g. the
 *                         Niagara explorer's selected ORD); empty if none
 *   {{lastResult}}      — the most recent successful tool result
 *   {{lastResult.a.b}}  — a dotted path into it
 *   {{prompt:Label}}    — asks the user (rejects if cancelled)
 * A lone-token string resolves to the token's value (which may be non-string);
 * otherwise tokens are interpolated into the surrounding text.
 */
export interface TemplateContext {
  lastResult?: unknown;
  /** The active plugin view's "cwd" (published via PluginContext.setCwd). */
  cwd?: string;
  promptFor: (label: string) => Promise<string>;
}

const ANY_TOKEN = /\{\{([^}]+)\}\}/g;
const WHOLE_TOKEN = /^\s*\{\{([^}]+)\}\}\s*$/;
const HAS_TOKEN = /\{\{[^}]+\}\}/;

function navigate(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const raw of path.split('.')) {
    const seg = raw.trim();
    if (seg === '') continue;
    if (current == null) return undefined;
    if (Array.isArray(current)) current = current[Number(seg)];
    else if (typeof current === 'object') current = (current as Record<string, unknown>)[seg];
    else return undefined;
  }
  return current;
}

async function resolveToken(expr: string, ctx: TemplateContext): Promise<unknown> {
  const trimmed = expr.trim();
  if (trimmed === 'now') return new Date().toISOString();
  if (trimmed === 'uuid') return crypto.randomUUID();
  if (trimmed === 'cwd') return ctx.cwd ?? '';
  if (trimmed.startsWith('prompt:')) return ctx.promptFor(trimmed.slice('prompt:'.length).trim());
  if (trimmed === 'lastResult') return ctx.lastResult;
  if (trimmed.startsWith('lastResult.')) return navigate(ctx.lastResult, trimmed.slice('lastResult.'.length));
  return `{{${expr}}}`; // unknown token — leave literal
}

async function expandString(input: string, ctx: TemplateContext): Promise<unknown> {
  const whole = WHOLE_TOKEN.exec(input);
  if (whole) return resolveToken(whole[1] ?? '', ctx);
  let result = input;
  for (const [match, expr] of input.matchAll(ANY_TOKEN)) {
    const resolved = await resolveToken(expr ?? '', ctx);
    result = result.replace(match, typeof resolved === 'string' ? resolved : JSON.stringify(resolved));
  }
  return result;
}

/** Recursively expand `{{…}}` tokens in any string the value contains. */
export async function expandTemplates(value: unknown, ctx: TemplateContext): Promise<unknown> {
  if (typeof value === 'string') return expandString(value, ctx);
  if (Array.isArray(value)) return Promise.all(value.map((item) => expandTemplates(item, ctx)));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = await expandTemplates(child, ctx);
    return out;
  }
  return value;
}

/** Cheap check: does the value contain any `{{…}}` token? */
export function hasTemplates(value: unknown): boolean {
  if (typeof value === 'string') return HAS_TOKEN.test(value);
  if (Array.isArray(value)) return value.some(hasTemplates);
  if (value && typeof value === 'object') return Object.values(value).some(hasTemplates);
  return false;
}
