import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { useAppCommands } from '@renderer/lib/commands';
import { useConnections } from '@renderer/lib/connections';
import { buildPluginContext } from '@renderer/lib/plugin-context';
import { useHostBus } from '@mcp-studio/plugin-api';

import { IN_BOX_PLUGINS, pickPlugin } from '@renderer/plugins/registry';
import { useTemplatingStore } from '@renderer/stores/templating';
import { useWorkspaceStore, type PluginViewRef, type Tab } from '@renderer/stores/workspace';

import { CommandPalette } from './CommandPalette';
import { LeftRail, type AppView } from './LeftRail';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';

// Feature views are code-split: each ships as its own chunk (and pulls in its
// own heavy deps — schema-form / react-hook-form / zod for the catalogs) so the
// initial renderer bundle stays lean.
const ConnectionsView = lazy(() =>
  import('@renderer/features/connections/ConnectionsView').then((m) => ({ default: m.ConnectionsView })),
);
const ToolsCatalog = lazy(() =>
  import('@renderer/features/tools/ToolsCatalog').then((m) => ({ default: m.ToolsCatalog })),
);
const ResourcesBrowser = lazy(() =>
  import('@renderer/features/resources/ResourcesBrowser').then((m) => ({ default: m.ResourcesBrowser })),
);
const PromptsLibrary = lazy(() =>
  import('@renderer/features/prompts/PromptsLibrary').then((m) => ({ default: m.PromptsLibrary })),
);
const HistoryPanel = lazy(() =>
  import('@renderer/features/history/HistoryPanel').then((m) => ({ default: m.HistoryPanel })),
);
const RawConsole = lazy(() => import('@renderer/features/raw/RawConsole').then((m) => ({ default: m.RawConsole })));
const UsageView = lazy(() => import('@renderer/features/usage/UsageView').then((m) => ({ default: m.UsageView })));
const PerfView = lazy(() => import('@renderer/features/perf/PerfView').then((m) => ({ default: m.PerfView })));
const ChatView = lazy(() => import('@renderer/features/chat/ChatView').then((m) => ({ default: m.ChatView })));
const ProtocolInspector = lazy(() =>
  import('@renderer/features/inspector/ProtocolInspector').then((m) => ({ default: m.ProtocolInspector })),
);

function BuiltinView({ view }: { view: AppView }) {
  switch (view) {
    case 'tools':
      return <ToolsCatalog />;
    case 'resources':
      return <ResourcesBrowser />;
    case 'prompts':
      return <PromptsLibrary />;
    case 'history':
      return <HistoryPanel />;
    case 'raw':
      return <RawConsole />;
    case 'usage':
      return <UsageView />;
    case 'perf':
      return <PerfView />;
    case 'assistant':
      return <ChatView />;
    case 'connections':
      return <ConnectionsView />;
  }
}

/** Host for a plugin-contributed view — finds the plugin + view + bound
 *  connection and renders the view's component with a fresh `PluginContext`. */
function PluginViewHost({ view, connectionId }: { view: PluginViewRef; connectionId?: string }) {
  const { t } = useTranslation();
  const connections = useConnections();
  const setCwd = useTemplatingStore((s) => s.setCwd);
  const connection = connections.find((c) => c.connectionId === connectionId);
  const ctx = useMemo(() => (connection ? buildPluginContext(connection, setCwd) : null), [connection, setCwd]);
  const pluginView = IN_BOX_PLUGINS.find((p) => p.manifest.name === view.plugin)?.views.find((v) => v.id === view.viewId);
  if (!ctx || !pluginView) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('plugins.unavailable')}
      </div>
    );
  }
  const Component = pluginView.component;
  return <Component ctx={ctx} />;
}

function ViewForTab({ tab }: { tab: Tab }) {
  if (typeof tab.view !== 'string') return <PluginViewHost view={tab.view} connectionId={tab.connectionId} />;
  return <BuiltinView view={tab.view} />;
}

function LoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" aria-hidden />
    </div>
  );
}

function WorkspaceEmpty({ onOpen }: { onOpen: (view: AppView) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <p>{t('tabs.emptyHint')}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => onOpen('connections')}>
          {t('nav.servers')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onOpen('tools')}>
          {t('nav.tools')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The application chrome: a left navigation rail (built-in items + the active
 * connection's plugin's view items), then a main column made of the tab strip,
 * the active tab's view (or the empty state), an optional protocol-inspector
 * dock, and the status bar. Tab/layout state lives in the Zustand workspace
 * store (persisted to localStorage); server data stays in React Query.
 */
export function AppShell() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const focusOrOpen = useWorkspaceStore((s) => s.focusOrOpen);
  const connections = useConnections();

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeBuiltinView = activeTab && typeof activeTab.view === 'string' ? activeTab.view : null;
  const activePluginViewId = activeTab && typeof activeTab.view === 'object' ? activeTab.view.viewId : null;

  // Rail plugin items come from the first connected connection that a plugin
  // specializes. (Disambiguating multiple matching connections is a follow-up.)
  const pluginConnection = useMemo(
    () => connections.find((c) => c.status === 'connected' && pickPlugin(c.serverInfo) !== undefined),
    [connections],
  );
  const activePlugin = pluginConnection ? pickPlugin(pluginConnection.serverInfo) : undefined;

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const commands = useAppCommands({
    view: activeBuiltinView,
    setView: focusOrOpen,
    inspectorOpen,
    setInspectorOpen,
    pluginConnection,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.code === 'Backquote') {
        event.preventDefault();
        setInspectorOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // C79 — chat ord-chip click → switch to the Niagara plugin's Explorer view.
  // The published ord stays in the host-bus's `pendingOrdNav` after this hook
  // triggers the view switch; the niagara `ExplorerView` mounts and calls
  // `consumeOrdNav()` on its own effect to call `useExplorerStore.select(ord)`.
  // Two consumers don't race because this side only PEEKS (re-renders when
  // pending changes) while the plugin-side CONSUMES (clears).
  const pendingOrd = useHostBus((s) => s.pendingOrdNav);
  useEffect(() => {
    if (!pendingOrd || !activePlugin || !pluginConnection) return;
    const explorerView = activePlugin.views.find((v) => v.id === 'explorer');
    if (!explorerView) return;
    focusOrOpen({ plugin: activePlugin.manifest.name, viewId: explorerView.id }, pluginConnection.connectionId);
  }, [pendingOrd, activePlugin, pluginConnection, focusOrOpen]);

  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <CommandPalette commands={commands} />
      <LeftRail
        view={activeBuiltinView}
        onSelect={focusOrOpen}
        pluginViews={activePlugin?.views ?? []}
        activePluginViewId={activePluginViewId}
        onOpenPluginView={(viewId) => {
          if (activePlugin && pluginConnection) {
            focusOrOpen({ plugin: activePlugin.manifest.name, viewId }, pluginConnection.connectionId);
          }
        }}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((open) => !open)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <main className="min-h-0 flex-1 overflow-auto">
          <Suspense fallback={<LoadingFallback />}>
            {activeTab ? <ViewForTab key={activeTab.id} tab={activeTab} /> : <WorkspaceEmpty onOpen={focusOrOpen} />}
          </Suspense>
        </main>
        {inspectorOpen && (
          <Suspense fallback={null}>
            <ProtocolInspector onClose={() => setInspectorOpen(false)} />
          </Suspense>
        )}
        <StatusBar />
      </div>
    </div>
  );
}
