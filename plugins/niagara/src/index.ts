import { lazy } from 'react';
import { Activity, Boxes, ClipboardList, LineChart, List, Network, Terminal } from 'lucide-react';
import type { Plugin } from '@mcp-studio/plugin-api';

import { NIAGARA_DIAGNOSTIC_FLOWS } from './diagnostic-flows';
import { fromToolCall } from './lib/write-ops';
import { NIAGARA_MANIFEST } from './manifest';
import { NIAGARA_STARTER_QUESTIONS } from './starter-questions';
import { usePendingStore } from './state/pending-store';
import { NIAGARA_SYSTEM_PROMPT } from './system-prompt';
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

/**
 * **M5 C75** — host-callable helper for routing an AI-attributed write call
 * into the Niagara plugin's pending-changes queue. The chat view imports this
 * when `connections:call` returns a `pendingEnqueued` outcome.
 *
 * Returns `'enqueued'` (success — the op now appears in the Changes view),
 * `'unrenderable'` (this plugin doesn't understand the tool — chat view tells
 * the LLM to stop), or `'no-connection'` (no connectionId resolved — chat
 * view surfaces an error).
 *
 * Direct coupling between chat view and Niagara is intentional for M5 v1
 * (one write-capable plugin). A generalised host bus driven by
 * `Plugin.canHandleWrite` lands when a second write-plugin appears.
 */
export function enqueueAiWrite(
  connectionId: string | null | undefined,
  toolCall: { name: string; args: Record<string, unknown> },
  source: { type: 'ai'; conversationId: string; agentId?: string },
): 'enqueued' | 'unrenderable' | 'no-connection' {
  if (!connectionId) return 'no-connection';
  const id = usePendingStore.getState().enqueueFromAi(connectionId, toolCall, source);
  return id === null ? 'unrenderable' : 'enqueued';
}

/** The in-box Niagara plugin: a station browser + (M3) write workflow + (M4)
 *  observability + (M5) AI co-pilot contributions. */
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
  // M5 C75: `toolAnnotationOverrides` migrated onto NIAGARA_MANIFEST (single
  // source of truth so main + renderer agree without a round-trip — see
  // `pluginManifestSchema`).
  // M5 AI co-pilot contributions (C74). Static for v1 — the system prompt
  // doesn't depend on the live connection state in M5; M6 may want
  // ctx.listTools()-driven feature-detection to add "if getTrendAnalysis is
  // available, prefer it" guidance per handover §7.
  systemPrompt: () => NIAGARA_SYSTEM_PROMPT,
  starterQuestions: () => NIAGARA_STARTER_QUESTIONS,
  diagnosticFlows: () => NIAGARA_DIAGNOSTIC_FLOWS,
  // M5 C75: the plugin claims AI-proposed write ops it can render in its
  // pending-changes queue (the `fromToolCall` inverse). Mirror of `enqueueAiWrite`
  // above — the host can ask the plugin "do you handle this?" before
  // committing to enqueue. M5 doesn't iterate plugins yet (single write-plugin
  // reality); the hook is here to keep the contract complete + ready for the
  // second-write-plugin generalization.
  canHandleWrite: (op) => fromToolCall(op.name, op.args) !== null,
};
