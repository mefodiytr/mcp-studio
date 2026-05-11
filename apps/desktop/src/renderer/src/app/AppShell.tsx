import { useEffect, useState } from 'react';

import { ConnectionsView } from '@renderer/features/connections/ConnectionsView';
import { HistoryPanel } from '@renderer/features/history/HistoryPanel';
import { ProtocolInspector } from '@renderer/features/inspector/ProtocolInspector';
import { PromptsLibrary } from '@renderer/features/prompts/PromptsLibrary';
import { RawConsole } from '@renderer/features/raw/RawConsole';
import { ResourcesBrowser } from '@renderer/features/resources/ResourcesBrowser';
import { ToolsCatalog } from '@renderer/features/tools/ToolsCatalog';

import { LeftRail, type AppView } from './LeftRail';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';

/**
 * The three-zone application chrome: a left navigation rail, and a main column
 * made of a tab strip, the active view, an optional protocol-inspector dock,
 * and a status bar. View switching is a single piece of state for now; the real
 * multi-tab strip arrives in C22.
 */
export function AppShell() {
  const [view, setView] = useState<AppView>('connections');
  const [inspectorOpen, setInspectorOpen] = useState(false);

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
      <LeftRail
        view={view}
        onSelect={setView}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((open) => !open)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar view={view} />
        <main className="min-h-0 flex-1 overflow-auto">
          {view === 'tools' ? (
            <ToolsCatalog />
          ) : view === 'resources' ? (
            <ResourcesBrowser />
          ) : view === 'prompts' ? (
            <PromptsLibrary />
          ) : view === 'history' ? (
            <HistoryPanel />
          ) : view === 'raw' ? (
            <RawConsole />
          ) : (
            <ConnectionsView />
          )}
        </main>
        {inspectorOpen && <ProtocolInspector onClose={() => setInspectorOpen(false)} />}
        <StatusBar />
      </div>
    </div>
  );
}
