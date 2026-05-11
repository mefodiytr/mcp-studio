import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ThemeProvider } from '@renderer/lib/theme';

import { AppShell } from './AppShell';
import { CommandPalette } from './CommandPalette';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppShell />
        <CommandPalette />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
