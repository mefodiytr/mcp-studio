import { lazy } from 'react';
import { Activity, Boxes, ClipboardList, LineChart, List, Network, Terminal } from 'lucide-react';
import type { Plugin } from '@mcp-studio/plugin-api';

import { NIAGARA_MANIFEST } from './manifest';
import { NIAGARA_TOOL_ANNOTATION_OVERRIDES } from './tool-annotations';
import { NIAGARA_TOOL_HINTS } from './tool-hints';

// View bodies are lazy chunks — the plugin's entry (this file, eagerly imported
// by the renderer registry) carries only the manifest + view metadata, so a
// view's heavy deps (CodeMirror, recharts, …) stay out of the initial bundle
// until a Niagara connection actually opens that view.
const ExplorerView = lazy(() => import('./views/ExplorerView').then((m) => ({ default: m.ExplorerView })));
const FolderView = lazy(() => import('./views/FolderView').then((m) => ({ default: m.FolderView })));
const PropertySheetView = lazy(() => import('./views/PropertySheetView').then((m) => ({ default: m.PropertySheetView })));
const BqlView = lazy(() => import('./views/BqlView').then((m) => ({ default: m.BqlView })));
const ChangesView = lazy(() => import('./views/ChangesView').then((m) => ({ default: m.ChangesView })));
const HistoryView = lazy(() => import('./views/HistoryView').then((m) => ({ default: m.HistoryView })));
const MonitorView = lazy(() => import('./views/MonitorView').then((m) => ({ default: m.MonitorView })));

/** The in-box Niagara plugin: a station browser + (M3) write workflow + (M4) observability. */
export const niagaraPlugin: Plugin = {
  manifest: NIAGARA_MANIFEST,
  views: [
    { id: 'explorer', title: 'Explorer', icon: Network, component: ExplorerView },
    { id: 'folder', title: 'Folder', icon: List, component: FolderView },
    { id: 'properties', title: 'Properties', icon: Boxes, component: PropertySheetView },
    { id: 'bql', title: 'BQL', icon: Terminal, component: BqlView },
    { id: 'changes', title: 'Changes', icon: ClipboardList, component: ChangesView },
    { id: 'history', title: 'History', icon: LineChart, component: HistoryView },
    { id: 'monitor', title: 'Monitor', icon: Activity, component: MonitorView },
  ],
  toolSchemaHints: NIAGARA_TOOL_HINTS,
  toolAnnotationOverrides: NIAGARA_TOOL_ANNOTATION_OVERRIDES,
};
