import { createServer } from 'node:http';

const DEFAULT_TIMEOUT_MS = 3 * 60_000;

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}
function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>MCP Studio</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem;color:#222"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p><p style="color:#888">You can close this tab and return to MCP Studio.</p></body></html>`;
}
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', connection: 'close' };

export interface OAuthCallback {
  code: string;
  state?: string;
}

export interface LoopbackRedirect {
  /** `http://127.0.0.1:<port>/callback` — use this as the OAuth `redirect_uri`. */
  readonly redirectUri: string;
  /** Resolves with the captured `?code=&state=` once the browser hits `/callback`;
   *  rejects on an `?error=` callback, a malformed callback, the timeout, or `close()`.
   *  Must be awaited (the rejection is otherwise unhandled). */
  waitForCallback(): Promise<OAuthCallback>;
  /** Shut the listener down (idempotent). Auto-called after a callback or timeout. */
  close(): void;
}

export interface LoopbackRedirectOptions {
  /** Reject `waitForCallback()` after this long (default 3 min). */
  timeoutMs?: number;
}

/**
 * Start a one-shot loopback HTTP listener for an OAuth authorization-code
 * redirect (RFC 8252 §7.3). Bound to `127.0.0.1` on an ephemeral port; the
 * authorization server may pick any port on a registered loopback host, so the
 * port being random is fine.
 */
export async function startLoopbackRedirect(options: LoopbackRedirectOptions = {}): Promise<LoopbackRedirect> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let resolveCallback!: (value: OAuthCallback) => void;
  let rejectCallback!: (error: Error) => void;
  const callback = new Promise<OAuthCallback>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  let settled = false;
  let timer: NodeJS.Timeout | undefined = undefined;

  const server = createServer((req, res) => {
    if (settled) {
      res.writeHead(410, HTML_HEADERS).end(page('MCP Studio', 'This authentication request is no longer active.'));
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404, { connection: 'close' }).end();
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (error) {
      const description = url.searchParams.get('error_description') ?? error;
      res.writeHead(400, HTML_HEADERS).end(page('Authentication failed', description));
      settle(() => rejectCallback(new Error(`Authorization failed: ${description}`)));
    } else if (code) {
      res.writeHead(200, HTML_HEADERS).end(page('Authentication complete', 'Signed in to the MCP server.'));
      settle(() => resolveCallback({ code, state: url.searchParams.get('state') ?? undefined }));
    } else {
      res.writeHead(400, HTML_HEADERS).end(page('Authentication failed', 'The callback was missing an authorization code.'));
      settle(() => rejectCallback(new Error('Authorization callback had neither a code nor an error')));
    }
  });

  function teardown(): void {
    server.close();
    server.closeAllConnections();
  }
  function settle(act: () => void): void {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    act();
    teardown(); // in-flight responses are already written before this runs
  }
  function close(): void {
    if (!settled) {
      settled = true;
      if (timer) clearTimeout(timer);
      rejectCallback(new Error('Loopback redirect listener closed before a callback'));
    }
    teardown();
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (typeof address === 'string' || address === null) {
    teardown();
    throw new Error('Failed to bind the loopback redirect listener');
  }
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;

  timer = setTimeout(() => settle(() => rejectCallback(new Error('Timed out waiting for the OAuth callback'))), timeoutMs);
  timer.unref();

  return { redirectUri, waitForCallback: () => callback, close };
}
