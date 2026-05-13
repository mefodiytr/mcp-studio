import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Loader2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@mcp-studio/ui';
import type { PluginContext } from '@mcp-studio/plugin-api';

import { generateBearerToken, pickBootstrapMode, type BootstrapMode } from '../lib/bootstrap';

/**
 * User-context Bearer bootstrap (C57) — given a pre-created `BUser` name on
 * the station, generate a random token, ask niagaramcp to bind it (via the
 * detected provisioning tool — see `pickBootstrapMode`), write it into the
 * connection's Bearer secret via the host's `credentials:set` IPC, and
 * reconnect. Feature-detects so the same UI works against a test-enabled
 * station today and against a future niagaramcp `provisionMcpUser` /
 * `rotateMcpToken` with no plugin change.
 *
 * The trigger button is mounted in `ChangesView`'s header; clicking it opens
 * this dialog. When the feature-detect returns `unavailable`, the trigger
 * isn't rendered — the button only appears for stations that can actually
 * bootstrap.
 */

/** Read the connection's `tools/list` once and decide which bootstrap path is
 *  available. Cached in React Query (per connectionId). */
export function useBootstrapMode(ctx: PluginContext): { mode: BootstrapMode; loading: boolean } {
  const cid = ctx.connection.connectionId;
  const q = useQuery({
    queryKey: ['niagara', cid, 'bootstrap-mode'],
    queryFn: async (): Promise<BootstrapMode> => {
      const tools = await ctx.listTools();
      const names = tools
        .map((t) => (t && typeof t === 'object' && typeof (t as { name?: unknown }).name === 'string' ? (t as { name: string }).name : null))
        .filter((n): n is string => n !== null);
      return pickBootstrapMode(names);
    },
  });
  return { mode: q.data ?? { kind: 'unavailable' }, loading: q.isPending };
}

export function BootstrapBearerDialog({
  ctx,
  mode,
  open,
  onOpenChange,
}: {
  ctx: PluginContext;
  mode: BootstrapMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset on close so the next open starts fresh — never leak a token in state.
      setUsername('');
      setToken('');
      setError(null);
      setRunning(false);
    }
  }, [open]);

  if (mode.kind === 'unavailable') {
    return null;
  }

  const submit = async (): Promise<void> => {
    const name = username.trim();
    const tok = token.trim();
    if (!name || !tok) return;
    setRunning(true);
    setError(null);
    try {
      await ctx.callTool(mode.toolName, { username: name, token: tok }, { write: true });
      const studio = (globalThis as { studio?: { invoke: (channel: string, params: unknown) => Promise<unknown> } }).studio
        ?? (globalThis as unknown as { window: { studio?: { invoke: (c: string, p: unknown) => Promise<unknown> } } }).window?.studio;
      if (!studio) throw new Error('IPC bridge unavailable.');
      await studio.invoke('credentials:set', { profileId: ctx.connection.profileId, secret: tok });
      await studio.invoke('connections:reconnect', { connectionId: ctx.connection.connectionId });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bootstrap user-context Bearer</DialogTitle>
          <DialogDescription>
            {mode.kind === 'test' ? (
              <>
                <span className="font-medium">Test mode</span> — uses niagaramcp's <code>setupTestUser</code>
                {' '}(gated by <code>BMcpPlatformService.enableTestSetup</code>). Production stations need a
                future niagaramcp <code>provisionMcpUser</code> / <code>rotateMcpToken</code>; this same dialog
                will use it without a code change.
              </>
            ) : (
              <>
                Calls niagaramcp's <code>{mode.toolName}</code> to bind a token to the named <code>BUser</code>'s
                {' '}<code>mcp:tokenHash</code> Tag, then replaces this connection's Bearer secret and reconnects.
                The connection's profile must already be Bearer-auth.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">BUser name (pre-created via Workbench)</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            spellCheck={false}
            className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="flex items-center justify-between text-muted-foreground">
            <span>Token</span>
            <button
              type="button"
              onClick={() => setToken(generateBearerToken())}
              className="text-primary underline-offset-2 hover:underline"
            >
              Generate
            </button>
          </span>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            spellCheck={false}
            placeholder="64 hex chars (or click Generate)"
            className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          />
        </label>

        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={running || !username.trim() || !token.trim()}>
            {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <KeyRound className="size-3.5" aria-hidden />}
            Bind & save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
