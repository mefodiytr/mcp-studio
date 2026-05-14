import { create } from 'zustand';

import type { Conversation, Message } from '../../../shared/domain/conversations';

function bridge(): NonNullable<typeof window.studio> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio;
}

/**
 * Renderer-side mirror of the per-profile conversation store (main owns the
 * `workspace.json` persistence; this store mirrors it for fast UI reads + Zustand
 * subscribers).
 *
 * The `EMPTY` shared reference is the M3/M4-lesson Zustand singleton — a
 * derived-collection selector must return a stable empty reference in the
 * no-conversation case, otherwise React #185 loops on `Object.is` comparison
 * (the C55 + C65 fix; canonical pitfall — see `docs/m4-followups.md`).
 *
 * `ensureLoaded(profileId)` hydrates once per profile per session (via the
 * `conversations:list` IPC); subsequent calls are no-ops. Mutations issue the
 * corresponding IPC then update the store optimistically.
 */
interface ConversationsState {
  conversationsByProfile: Record<string, Conversation[]>;
  hydratedProfiles: Set<string>;

  ensureLoaded: (profileId: string) => Promise<void>;
  upsert: (profileId: string, conversation: Conversation) => Promise<void>;
  remove: (profileId: string, id: string) => Promise<void>;
  appendMessage: (
    profileId: string,
    conversationId: string,
    message: Message,
  ) => Promise<Conversation | null>;
  /** Local-only patch — used for the "in-flight streaming assistant message"
   *  that's being assembled chunk by chunk. Persistence happens via
   *  appendMessage once the message is complete. */
  patchInflight: (
    profileId: string,
    conversationId: string,
    patcher: (c: Conversation) => Conversation,
  ) => void;
}

const EMPTY: readonly Conversation[] = [];

export const useConversationsStore = create<ConversationsState>((set, get) => ({
  conversationsByProfile: {},
  hydratedProfiles: new Set(),

  async ensureLoaded(profileId) {
    if (get().hydratedProfiles.has(profileId)) return;
    const { conversations } = await bridge().invoke('conversations:list', { profileId });
    set((s) => ({
      conversationsByProfile: { ...s.conversationsByProfile, [profileId]: conversations },
      hydratedProfiles: new Set([...s.hydratedProfiles, profileId]),
    }));
  },

  async upsert(profileId, conversation) {
    await bridge().invoke('conversations:save', { profileId, conversation });
    set((s) => {
      const existing = s.conversationsByProfile[profileId] ?? [];
      const idx = existing.findIndex((c) => c.id === conversation.id);
      const next = idx >= 0 ? [...existing] : [...existing, conversation];
      if (idx >= 0) next[idx] = conversation;
      // Sort newest-first by updatedAt to match the repo's list order.
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      return {
        conversationsByProfile: { ...s.conversationsByProfile, [profileId]: next },
      };
    });
  },

  async remove(profileId, id) {
    await bridge().invoke('conversations:delete', { profileId, id });
    set((s) => ({
      conversationsByProfile: {
        ...s.conversationsByProfile,
        [profileId]: (s.conversationsByProfile[profileId] ?? []).filter((c) => c.id !== id),
      },
    }));
  },

  async appendMessage(profileId, conversationId, message) {
    const { conversation } = await bridge().invoke('conversations:append', {
      profileId,
      conversationId,
      message,
    });
    if (!conversation) return null;
    set((s) => {
      const list = s.conversationsByProfile[profileId] ?? [];
      const idx = list.findIndex((c) => c.id === conversationId);
      const next = idx >= 0 ? [...list] : [...list, conversation];
      if (idx >= 0) next[idx] = conversation;
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      return {
        conversationsByProfile: { ...s.conversationsByProfile, [profileId]: next },
      };
    });
    return conversation;
  },

  patchInflight(profileId, conversationId, patcher) {
    set((s) => {
      const list = s.conversationsByProfile[profileId] ?? [];
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx < 0) return s;
      const current = list[idx];
      if (!current) return s;
      const next = [...list];
      next[idx] = patcher(current);
      return {
        conversationsByProfile: { ...s.conversationsByProfile, [profileId]: next },
      };
    });
  },
}));

/** Stable selector — returns the shared `EMPTY` reference when a profile has
 *  no conversations (the React #185 guard; see store comment). */
export function selectConversations(profileId: string | undefined) {
  return (s: ConversationsState): readonly Conversation[] => {
    if (!profileId) return EMPTY;
    const list = s.conversationsByProfile[profileId];
    return list && list.length > 0 ? list : EMPTY;
  };
}
