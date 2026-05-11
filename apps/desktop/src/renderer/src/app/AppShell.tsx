import { ConnectionsView } from '@renderer/features/connections/ConnectionsView';

import { LeftRail } from './LeftRail';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';

/**
 * The three-zone application chrome: a left navigation rail, and a main column
 * made of a tab strip, the active view, and a status bar. For now the only
 * view is Connections (the proof-of-life dev harness); the tab strip becomes
 * real in C22, the wizard/rail navigation in C10/C11.
 */
export function AppShell() {
  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <LeftRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <main className="min-h-0 flex-1 overflow-auto">
          <ConnectionsView />
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
