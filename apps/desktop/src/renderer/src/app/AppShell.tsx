import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { ConnectionsView } from '@renderer/features/connections/ConnectionsView';
import { HistoryPanel } from '@renderer/features/history/HistoryPanel';
import { ProtocolInspector } from '@renderer/features/inspector/ProtocolInspector';
import { PromptsLibrary } from '@renderer/features/prompts/PromptsLibrary';
import { RawConsole } from '@renderer/features/raw/RawConsole';
import { ResourcesBrowser } from '@renderer/features/resources/ResourcesBrowser';
import { ToolsCatalog } from '@renderer/features/tools/ToolsCatalog';
import { useAppCommands } from '@renderer/lib/commands';
import { useWorkspaceStore, type Tab } from '@renderer/stores/workspace';

import { CommandPalette } from './CommandPalette';
import { LeftRail, type AppView } from './LeftRail';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';

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
          {activeTab ? <ViewForTab key={activeTab.id} tab={activeTab} /> : <WorkspaceEmpty onOpen={focusOrOpen} />}
        </main>
        {inspectorOpen && <ProtocolInspector onClose={() => setInspectorOpen(false)} />}
        <StatusBar />
      </div>
    </div>
  );
}
