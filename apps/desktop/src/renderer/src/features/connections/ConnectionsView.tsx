import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, RotateCw, Server, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@renderer/components/ui/button';
import { connectProfile, disconnectConnection, reconnectConnection, useConnections } from '@renderer/lib/connections';
import { describeError } from '@renderer/lib/errors';
import { getCredentialHint, useCreateProfile, useDeleteProfile, useProfiles } from '@renderer/lib/profiles';
import { fetchTools } from '@renderer/lib/tools';
import { cn } from '@renderer/lib/utils';
import type { ConnectionSummary, ToolDescriptor } from '@shared/domain/connection';
import type { Profile, ProfileInput } from '@shared/domain/profile';

import { ProfileWizard } from './ProfileWizard';

const DEV_PROFILE: ProfileInput = {
  transport: 'stdio',
  command: 'mcp-server-everything',
  args: ['stdio'],
  name: 'server-everything (dev)',
  auth: { method: 'none' },
};

function transportSummary(profile: Profile): string {
  return profile.transport === 'http'
    ? `http · ${profile.url}`
    : `stdio · ${[profile.command, ...profile.args].join(' ')}`;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 64;
  const height = 14;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="text-muted-foreground" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1} />
    </svg>
  );
}

export function ConnectionsView() {
  const { t } = useTranslation();
  const profilesQuery = useProfiles();
  const createProfile = useCreateProfile();
  const connections = useConnections();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | undefined>(undefined);

  const profiles = profilesQuery.data ?? [];
  const versions = window.studio?.versions;

  // Toast when a previously-connected session drops.
  const prevStatus = useRef<Map<string, ConnectionSummary['status']>>(new Map());
  useEffect(() => {
    for (const c of connections) {
      if (c.status === 'error' && prevStatus.current.get(c.connectionId) === 'connected') {
        toast.error(t('connections.dropped', { name: c.serverInfo?.name ?? c.profileId }), {
          description: c.error ?? undefined,
        });
      }
    }
    prevStatus.current = new Map(connections.map((c) => [c.connectionId, c.status]));
  }, [connections, t]);

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{t('connections.savedServers')}</h1>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(undefined);
              setWizardOpen(true);
            }}
          >
            <Plus />
            {t('connections.addServer')}
          </Button>
        </div>
        {profiles.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-5 text-sm text-muted-foreground">
            <p>{t('connections.noProfiles')}</p>
            <Button
              size="sm"
              variant="secondary"
              disabled={createProfile.isPending}
              onClick={() => void createProfile.mutateAsync(DEV_PROFILE)}
            >
              {createProfile.isPending && <Loader2 className="animate-spin" />}
              {t('connections.addDev')}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {profiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                onEdit={() => {
                  setEditing(profile);
                  setWizardOpen(true);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('connections.activeConnections')}</h2>
        {connections.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Server className="size-4" aria-hidden /> {t('connections.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {connections.map((connection) => (
              <ConnectionCard key={connection.connectionId} connection={connection} />
            ))}
          </ul>
        )}
      </section>

      <ProfileWizard open={wizardOpen} onOpenChange={setWizardOpen} editing={editing} />

      <p className="mt-auto text-xs text-muted-foreground">
        {t('connections.proofOfLife')}
        {versions?.['electron'] &&
          ` · Electron ${versions['electron']} · Chromium ${versions['chrome']} · Node ${versions['node']}`}
      </p>
    </div>
  );
}

function ProfileRow({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
  const { t } = useTranslation();
  const deleteProfile = useDeleteProfile();
  const createProfile = useCreateProfile();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (profile.auth.method === 'none') {
      setHint(null);
      return;
    }
    let cancelled = false;
    void getCredentialHint(profile.id).then((value) => {
      if (!cancelled) setHint(value);
    });
    return () => {
      cancelled = true;
    };
  }, [profile.id, profile.updatedAt, profile.auth.method]);

  const connect = async (): Promise<void> => {
    setConnecting(true);
    setConnectError(null);
    try {
      await connectProfile(profile.id);
    } catch (cause) {
      const message = describeError(cause);
      setConnectError(message);
      toast.error(t('connections.connectFailed', { name: profile.name }), { description: message });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <li className="rounded-lg border bg-card p-3 text-card-foreground">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{profile.name}</p>
          <p className="truncate text-xs text-muted-foreground">{transportSummary(profile)}</p>
          <p className="text-xs text-muted-foreground">
            {t('connections.auth')}: {profile.auth.method}
            {profile.auth.method === 'header' && ` (${profile.auth.headerName})`}
            {hint && ` · ${hint}`}
            {profile.tlsInsecure && ` · ${t('connections.tlsInsecureBadge')}`}
          </p>
          {(profile.tags?.env || profile.tags?.project) && (
            <div className="mt-1 flex gap-1.5">
              {profile.tags.env && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{profile.tags.env}</span>
              )}
              {profile.tags.project && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{profile.tags.project}</span>
              )}
            </div>
          )}
          {connectError && <p className="mt-1 text-xs text-destructive">{connectError}</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" disabled={connecting} onClick={() => void connect()}>
            {connecting && <Loader2 className="animate-spin" />}
            {t('connections.connect')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            {t('connections.edit')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void createProfile.mutateAsync({ ...profile, name: `${profile.name} (copy)` } as ProfileInput)
            }
          >
            {t('connections.duplicate')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void deleteProfile.mutateAsync(profile.id)}>
            {t('connections.delete')}
          </Button>
        </div>
      </div>
    </li>
  );
}

function ConnectionCard({ connection }: { connection: ConnectionSummary }) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  const errored = connection.status === 'error';

  useEffect(() => {
    if (errored) {
      setTools([]);
      return;
    }
    let cancelled = false;
    void fetchTools(connection.connectionId).then((list) => {
      if (!cancelled) setTools(list);
    });
    return () => {
      cancelled = true;
    };
  }, [connection.connectionId, errored]);

  return (
    <li className="rounded-lg border bg-card p-4 text-card-foreground">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <span
              className={cn('size-1.5 shrink-0 rounded-full', errored ? 'bg-destructive' : 'bg-emerald-500')}
              aria-hidden
            />
            {connection.serverInfo?.name ?? t('connections.unknownServer')}{' '}
            <span className="text-muted-foreground">{connection.serverInfo?.version}</span>
          </p>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {connection.transportKind}
              {connection.latencyMs != null && ` · ${Math.round(connection.latencyMs)} ms`}
              {' · '}
              {connection.capabilities.tools} {t('connections.tools')} · {connection.capabilities.resources}{' '}
              {t('connections.resources')} · {connection.capabilities.prompts} {t('connections.prompts')}
            </span>
            <Sparkline values={connection.latencyHistory} />
          </p>
          {connection.sessionId && (
            <p className="text-xs text-muted-foreground">
              {t('connections.sessionId')}: <span className="font-mono">{connection.sessionId}</span>
            </p>
          )}
          {errored && connection.error && <p className="mt-1 text-xs text-destructive">{connection.error}</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          {errored && (
            <Button size="sm" variant="outline" onClick={() => void reconnectConnection(connection.connectionId)}>
              <RotateCw />
              {t('connections.reconnect')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void disconnectConnection(connection.connectionId)}>
            <Unplug />
            {t('connections.disconnect')}
          </Button>
        </div>
      </div>
      {tools.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tools.map((tool) => (
            <span
              key={tool.name}
              title={tool.description}
              className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
            >
              {tool.name}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
