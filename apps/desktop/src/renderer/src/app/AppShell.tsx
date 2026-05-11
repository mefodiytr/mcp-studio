import { Suspense, lazy, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { useAppCommands } from '@renderer/lib/commands';
import { useWorkspaceStore, type Tab } from '@renderer/stores/workspace';

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
const ProtocolInspector = lazy(() =>
  import('@renderer/features/inspector/ProtocolInspector').then((m) => ({ default: m.ProtocolInspector })),
);

function ViewForTab({ tab }: { tab: Tab }) {
  switch (tab.view) {
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
    case 'connections':
      return <ConnectionsView />;
  }
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
 * The application chrome: a left navigation rail, then a main column made of
 * the tab strip, the active tab's view (or the empty state), an optional
 * protocol-inspector dock, and the status bar. Tab/layout state lives in the
 * Zustand workspace store (persisted to localStorage); server data stays in
 * React Query.
 */
export function AppShell() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const focusOrOpen = useWorkspaceStore((s) => s.focusOrOpen);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeView = activeTab?.view ?? null;

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const commands = useAppCommands({ view: activeView, setView: focusOrOpen, inspectorOpen, setInspectorOpen });

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

  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <CommandPalette commands={commands} />
      <LeftRail
        view={activeView}
        onSelect={focusOrOpen}
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
