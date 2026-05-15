import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useHostBus } from '@mcp-studio/plugin-api';

import { signOutOAuth } from '@renderer/lib/auth';
import { connectProfile, disconnectConnection, useConnections } from '@renderer/lib/connections';
import { describeError } from '@renderer/lib/errors';
import { clearHistory, useHistory } from '@renderer/lib/history';
import { buildPluginContext } from '@renderer/lib/plugin-context';
import { collectStaticContributions } from '@renderer/lib/plugin-prompts';
import { selectionLabel } from '@renderer/lib/host-selection';
import { useProfiles } from '@renderer/lib/profiles';
import { useTheme } from '@renderer/lib/theme';
import { callTool } from '@renderer/lib/tools';
import { pickPlugin } from '@renderer/plugins/registry';
import { useDiagnosticFlowLauncher } from '@renderer/stores/diagnostic-flow-launcher';

import type { AppView } from '@renderer/app/LeftRail';
import type { ConnectionSummary } from '@shared/domain/connection';

/** One entry in the command palette. `when: false` hides it (context scoping). */
export interface Command {
  id: string;
  title: string;
  group: string;
  keywords?: string;
  when?: boolean;
  run: () => void | Promise<void>;
}

interface ShellHandle {
  view: AppView | null;
  setView: (view: AppView) => void;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  /** The connection whose plugin (if any) contributes commands — the active
   *  plugin connection (see AppShell). Undefined when none is connected. */
  pluginConnection?: ConnectionSummary;
}

const VIEW_KEYS: { view: AppView; navKey: string }[] = [
  { view: 'connections', navKey: 'servers' },
  { view: 'tools', navKey: 'tools' },
  { view: 'resources', navKey: 'resources' },
  { view: 'prompts', navKey: 'prompts' },
  { view: 'history', navKey: 'history' },
  { view: 'usage', navKey: 'usage' },
  { view: 'perf', navKey: 'perf' },
  { view: 'assistant', navKey: 'assistant' },
  { view: 'raw', navKey: 'raw' },
];

export function useAppCommands({
  view,
  setView,
  inspectorOpen,
  setInspectorOpen,
  pluginConnection,
}: ShellHandle): Command[] {
  const { t } = useTranslation();
  const { cycleTheme } = useTheme();
  const qc = useQueryClient();
  const connections = useConnections();
  const profilesQuery = useProfiles();
  const historyQuery = useHistory();
  // **M6 C87** — host-bus selection drives "Run rooftop diagnosis on `AHU-1`"
  // entries (vs the plain "Run rooftop diagnosis") when the operator has a
  // current pick in the Niagara Explorer. The palette rebuilds when the
  // selection changes (memo dep) so the title stays in sync.
  const hostSelection = useHostBus((s) => s.selectedOrd);

  return useMemo(() => {
    const groups = {
      go: t('commandPalette.group.go'),
      view: t('commandPalette.group.view'),
      connections: t('commandPalette.group.connections'),
      tools: t('commandPalette.group.tools'),
      history: t('commandPalette.group.history'),
    };
    const list: Command[] = [];

    for (const { view: v, navKey } of VIEW_KEYS) {
      list.push({
        id: `view.${v}`,
        title: t('commandPalette.openView', { name: t(`nav.${navKey}`) }),
        group: groups.go,
        keywords: `${v} ${navKey}`,
        when: view !== v,
        run: () => setView(v),
      });
    }

    list.push({
      id: 'inspector.toggle',
      title: inspectorOpen ? t('commandPalette.hideInspector') : t('commandPalette.showInspector'),
      group: groups.view,
      keywords: 'protocol inspector traffic',
      run: () => setInspectorOpen((open) => !open),
    });
    list.push({
      id: 'theme.cycle',
      title: t('commandPalette.toggleTheme'),
      group: groups.view,
      keywords: 'dark light system appearance',
      run: cycleTheme,
    });
    list.push({
      id: 'window.reload',
      title: t('commandPalette.reloadWindow'),
      group: groups.view,
      run: () => window.location.reload(),
    });

    for (const profile of profilesQuery.data ?? []) {
      const live = connections.find((c) => c.profileId === profile.id && c.status === 'connected');
      if (live) {
        list.push({
          id: `conn.disconnect.${profile.id}`,
          title: t('commandPalette.disconnectFrom', { name: profile.name }),
          group: groups.connections,
          keywords: profile.name,
          run: () => void disconnectConnection(live.connectionId),
        });
      } else {
        list.push({
          id: `conn.connect.${profile.id}`,
          title: t('commandPalette.connectTo', { name: profile.name }),
          group: groups.connections,
          keywords: profile.name,
          run: () => {
            void connectProfile(profile.id)
              .then(() => toast.success(t('connections.connected', { name: profile.name })))
              .catch((cause: unknown) => toast.error(describeError(cause)));
          },
        });
      }
      if (profile.auth.method === 'oauth') {
        list.push({
          id: `conn.signOut.${profile.id}`,
          title: t('commandPalette.signOutOf', { name: profile.name }),
          group: groups.connections,
          keywords: `${profile.name} oauth`,
          run: () => {
            void signOutOAuth(profile.id)
              .then(() => void qc.invalidateQueries({ queryKey: ['oauth-status', profile.id] }))
              .catch((cause: unknown) => toast.error(describeError(cause)));
          },
        });
      }
    }

    const last = historyQuery.data?.[0];
    if (last) {
      const stillLive = connections.some((c) => c.connectionId === last.connectionId && c.status === 'connected');
      list.push({
        id: 'tool.runLast',
        title: t('commandPalette.runLastTool', { name: last.toolName }),
        group: groups.tools,
        keywords: 're-run last tool',
        when: stillLive,
        run: () => {
          const args =
            last.args && typeof last.args === 'object' && !Array.isArray(last.args)
              ? (last.args as Record<string, unknown>)
              : undefined;
          void callTool(last.connectionId, last.toolName, args)
            .then((outcome) => {
              if (outcome.error) toast.error(`${last.toolName}: ${outcome.error.message}`);
              else if (outcome.result?.isError) toast.warning(`${last.toolName}: ${t('tools.toolReportedError')}`);
              else toast.success(`${last.toolName} ✓`);
              void qc.invalidateQueries({ queryKey: ['history'] });
            })
            .catch((cause: unknown) => toast.error(describeError(cause)));
        },
      });
    }

    list.push({
      id: 'history.clear',
      title: t('commandPalette.clearHistory'),
      group: groups.history,
      keywords: 'clear history',
      when: view === 'history',
      run: () => void clearHistory().then(() => void qc.invalidateQueries({ queryKey: ['history'] })),
    });

    // Commands contributed by the active connection's plugin (if any).
    const plugin = pickPlugin(pluginConnection?.serverInfo);
    if (pluginConnection && plugin) {
      const groupName = pluginConnection.serverInfo?.name ?? plugin.manifest.name;
      const ctx = buildPluginContext(pluginConnection);
      if (plugin.commands) {
        for (const pc of plugin.commands(ctx)) {
          list.push({ id: pc.id, title: pc.title, group: pc.group ?? groupName, keywords: pc.keywords, run: pc.run });
        }
      }
      // M5: diagnostic-flow launchers from the plugin's `diagnosticFlows`. Each
      // flow becomes a palette entry that navigates to the assistant view +
      // enqueues the flow into the chat-side launcher (the dialog opens; the
      // user fills params; the ReAct loop fires).
      const flowGroup = t('commandPalette.group.assistant');
      // Palette needs only the static subset — the async system prompt
      // (M6 C84) is awaited at runner-launch time, not here.
      const contributions = collectStaticContributions([plugin], ctx);
      for (const flow of contributions.diagnosticFlows) {
        // **M6 C87** — same decoration rule as the chat empty state's
        // diagnostic-flow buttons (selectionLabel). Parameterless flows
        // keep their plain title.
        const decorate =
          hostSelection !== null && flow.params !== undefined && flow.params.length > 0;
        const titleKey = decorate ? 'commandPalette.runFlowOnSelection' : 'commandPalette.runFlow';
        const title = decorate
          ? t(titleKey, { name: flow.title, selection: selectionLabel(hostSelection!) })
          : t(titleKey, { name: flow.title });
        list.push({
          id: `assistant.flow.${flow.id}`,
          title,
          group: flowGroup,
          keywords: `${flow.id} ${flow.title} ${flow.description} ${flow.pluginName} diagnostic flow`,
          run: () => {
            setView('assistant');
            useDiagnosticFlowLauncher.getState().enqueue(flow);
          },
        });
      }
    }

    return list;
  }, [
    t,
    cycleTheme,
    qc,
    connections,
    profilesQuery.data,
    historyQuery.data,
    view,
    inspectorOpen,
    setView,
    setInspectorOpen,
    pluginConnection,
    hostSelection,
  ]);
}
