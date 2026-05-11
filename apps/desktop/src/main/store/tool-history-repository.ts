import { randomUUID } from 'node:crypto';

import type { CallToolResult, ContentBlock } from '../../shared/domain/tool-result';
import type { ToolHistoryEntry } from '../../shared/domain/tool-history';

import type { JsonStore } from './json-store';
import type { WorkspaceData } from './workspace-store';

const HISTORY_CAP = 200;
/** Inline binary content larger than this (base64 chars) is replaced with a
 *  placeholder so the history file doesn't balloon. */
const MAX_INLINE_BASE64 = 4 * 1024;

function sanitizeBlock(block: ContentBlock): ContentBlock {
  const data = block['data'];
  if (typeof data === 'string' && data.length > MAX_INLINE_BASE64) {
    return { ...block, data: `<${data.length} base64 chars omitted>` };
  }
  return block;
}

/** Drop or shrink large payloads before persisting (the live result in the
 *  invocation dialog keeps the full content). */
export function sanitizeResultForHistory(result: CallToolResult | null): CallToolResult | null {
  if (!result) return null;
  return { ...result, content: result.content.map(sanitizeBlock) };
}

/** Append-and-cap log of tool invocations, persisted through the workspace store. */
export class ToolHistoryRepository {
  constructor(private readonly store: JsonStore<WorkspaceData>) {
    // An older workspace.json may predate the field.
    if (!Array.isArray(this.store.data.toolHistory)) this.store.data.toolHistory = [];
  }

  /** Most recent first. */
  list(): ToolHistoryEntry[] {
    return [...this.store.data.toolHistory].reverse();
  }

  get(id: string): ToolHistoryEntry | undefined {
    return this.store.data.toolHistory.find((e) => e.id === id);
  }

  add(entry: Omit<ToolHistoryEntry, 'id'>): ToolHistoryEntry {
    const full: ToolHistoryEntry = {
      ...entry,
      id: randomUUID(),
      result: sanitizeResultForHistory(entry.result),
    };
    this.store.data.toolHistory.push(full);
    if (this.store.data.toolHistory.length > HISTORY_CAP) {
      this.store.data.toolHistory.splice(0, this.store.data.toolHistory.length - HISTORY_CAP);
    }
    this.store.save();
    return full;
  }

  clear(): void {
    if (this.store.data.toolHistory.length === 0) return;
    this.store.data.toolHistory = [];
    this.store.save();
  }
}
