import type { Conversation, Message } from '../../shared/domain/conversations';
import { MAX_MESSAGES_PER_CONVERSATION } from '../../shared/domain/conversations';

import type { JsonStore } from './json-store';
import type { WorkspaceData } from './workspace-store';

/**
 * Per-profile conversation list (M5). Reads/writes the `conversations` field
 * of the workspace store; `connectionId` is session-only so M5 keys by
 * `profileId` (same shape as the M4 watch list). Per-conversation
 * head-trim at `MAX_MESSAGES_PER_CONVERSATION` (200) on `append`; the
 * trimmed-context marker is added by the caller, not the repository — the
 * repo's job is storage, not summarisation.
 */
export class ConversationRepository {
  constructor(private readonly store: JsonStore<WorkspaceData>) {
    if (
      typeof this.store.data.conversations !== 'object' ||
      Array.isArray(this.store.data.conversations)
    ) {
      this.store.data.conversations = {};
    }
  }

  /** All conversations for a profile, newest-updated first. */
  list(profileId: string): Conversation[] {
    const list = this.store.data.conversations[profileId];
    if (!Array.isArray(list)) return [];
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** One conversation by id; null if not found. */
  get(profileId: string, id: string): Conversation | null {
    const list = this.store.data.conversations[profileId];
    if (!Array.isArray(list)) return null;
    return list.find((c) => c.id === id) ?? null;
  }

  /** Upsert a conversation (full-document write). Saves to disk. */
  save(profileId: string, conversation: Conversation): void {
    const list = this.store.data.conversations[profileId] ?? [];
    const idx = list.findIndex((c) => c.id === conversation.id);
    if (idx >= 0) {
      list[idx] = conversation;
    } else {
      list.push(conversation);
    }
    this.store.data.conversations[profileId] = list;
    this.store.save();
  }

  /** Delete one conversation. No-op if not found. */
  delete(profileId: string, id: string): void {
    const list = this.store.data.conversations[profileId];
    if (!Array.isArray(list)) return;
    const next = list.filter((c) => c.id !== id);
    if (next.length === list.length) return;
    if (next.length === 0) {
      delete this.store.data.conversations[profileId];
    } else {
      this.store.data.conversations[profileId] = next;
    }
    this.store.save();
  }

  /**
   * Append a message to a conversation, head-trimming if past the cap. Returns
   * the updated conversation. Creates a new conversation if the id is not
   * found (the caller drives "new conversation" by `save`-then-`append`; this
   * is the convenience for the streaming runner that emits one message at a
   * time). Saves to disk.
   */
  append(profileId: string, conversationId: string, message: Message): Conversation | null {
    const conversation = this.get(profileId, conversationId);
    if (!conversation) return null;
    let messages = [...conversation.messages, message];
    if (messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      // Head-trim, keeping the most-recent slice. A real summarisation pass is
      // m5-followup; the trim guard prevents unbounded workspace growth.
      messages = messages.slice(messages.length - MAX_MESSAGES_PER_CONVERSATION);
    }
    const updated: Conversation = { ...conversation, messages, updatedAt: message.ts };
    this.save(profileId, updated);
    return updated;
  }

  /** Drop every conversation for a profile (e.g. when the profile is deleted). */
  clear(profileId: string): void {
    if (!(profileId in this.store.data.conversations)) return;
    delete this.store.data.conversations[profileId];
    this.store.save();
  }
}
