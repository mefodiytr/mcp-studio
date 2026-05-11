import { ThemeProvider } from '@renderer/lib/theme';
import { AppShell } from './AppShell';
import { CommandPalette } from './CommandPalette';

export function App() {
  return (
    <ThemeProvider>
      <AppShell />
      <CommandPalette />
    </ThemeProvider>
  );
}
