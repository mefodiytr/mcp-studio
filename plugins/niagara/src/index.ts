import { lazy } from 'react';
import { Boxes, Network } from 'lucide-react';
import type { Plugin } from '@mcp-studio/plugin-api';

import { NIAGARA_MANIFEST } from './manifest';

// View bodies are lazy chunks — the plugin's entry (this file, eagerly imported
// by the renderer registry) carries only the manifest + view metadata, so a
// view's heavy deps stay out of the initial bundle until a Niagara connection
// actually opens it.
const ExplorerView = lazy(() => import('./views/ExplorerView').then((m) => ({ default: m.ExplorerView })));
const PropertySheetView = lazy(() => import('./views/PropertySheetView').then((m) => ({ default: m.PropertySheetView })));

/** The in-box Niagara plugin: a read-only station browser, built out over C40–C45. */
export const niagaraPlugin: Plugin = {
  manifest: NIAGARA_MANIFEST,
  views: [
    { id: 'explorer', title: 'Explorer', icon: Network, component: ExplorerView },
    { id: 'properties', title: 'Properties', icon: Boxes, component: PropertySheetView },
  ],
};
