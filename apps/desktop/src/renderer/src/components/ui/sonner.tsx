import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';

import { useTheme } from '@renderer/lib/theme';

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return <SonnerToaster theme={resolvedTheme} position="bottom-right" richColors closeButton {...props} />;
}
