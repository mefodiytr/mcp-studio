import { LeftRail } from './LeftRail';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';
import { WelcomeView } from './WelcomeView';

/**
 * The three-zone application chrome: a left navigation rail, and a main column
 * made of a tab strip, the active view, and a status bar. Views (catalog, tool
 * detail, resources, inspector, …) get hung off the tab strip in later commits;
 * for now the only view is the Welcome / empty state.
 */
export function AppShell() {
  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <LeftRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <main className="min-h-0 flex-1 overflow-auto">
          <WelcomeView />
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
