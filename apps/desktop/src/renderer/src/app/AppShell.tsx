import { useState } from 'react';

import { ConnectionsView } from '@renderer/features/connections/ConnectionsView';
import { ToolsCatalog } from '@renderer/features/tools/ToolsCatalog';

import { LeftRail, type AppView } from './LeftRail';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';

/**
 * The three-zone application chrome: a left navigation rail, and a main column
 * made of a tab strip, the active view, and a status bar. View switching is a
 * single piece of state for now; the real multi-tab strip arrives in C22.
 */
export function AppShell() {
  const [view, setView] = useState<AppView>('connections');
  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <LeftRail view={view} onSelect={setView} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar view={view} />
        <main className="min-h-0 flex-1 overflow-auto">
          {view === 'tools' ? <ToolsCatalog /> : <ConnectionsView />}
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
