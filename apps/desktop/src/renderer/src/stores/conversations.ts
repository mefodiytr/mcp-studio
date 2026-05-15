import { create } from 'zustand';

import type { Conversation, Message } from '../../../shared/domain/conversations';
import type { LlmUsage } from '@mcp-studio/llm-provider';

import { computeHeadSlice, type SummariserResult } from '../lib/summariser';

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
  /** **M6 C86 — head-trim with LLM summarisation.** Slices the conversation
   *  into head (to summarise) + tail (to keep); calls `opts.summarise(head)`
   *  for the replacement text; on success, replaces the head with a single
   *  synthetic `marker: 'summary'` assistant message and persists; on null
   *  (failure / abort — never throws), drops the head silently and signals
   *  `outcome: 'dropped'` so the caller can surface a warning chip.
   *
   *  The `summarise` callback is the injection seam: the caller (ChatView)
   *  builds the LlmProvider + resolves the summariser model + threads its
   *  AbortSignal. This keeps the store free of provider/IPC dependencies
   *  for testing.
   *
   *  Re-summarisation continuity (promt19 edge case #4) is handled by
   *  `computeHeadSlice` — a prior `'summary'` marker is consumed into the
   *  next head slice, so the single summary marker grows in scope. */
  summariseAndTrim: (
    profileId: string,
    conversationId: string,
    opts: {
      summarise: (headSlice: readonly Message[]) => Promise<SummariserResult | null>;
    },
  ) => Promise<SummariseAndTrimResult>;
}

export type SummariseAndTrimResult =
  | { outcome: 'noop'; reason: 'missing-conversation' | 'no-head-to-trim'; conversation: null }
  | { outcome: 'summarised'; conversation: Conversation; usage: LlmUsage | null }
  | { outcome: 'dropped'; conversation: Conversation; reason: 'summariser-returned-null' };

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

  async summariseAndTrim(profileId, conversationId, opts) {
    const list = get().conversationsByProfile[profileId] ?? [];
    const current = list.find((c) => c.id === conversationId);
    if (!current) {
      return { outcome: 'noop', reason: 'missing-conversation', conversation: null };
    }
    const { headSlice, tail } = computeHeadSlice(current.messages);
    if (headSlice.length === 0) {
      return { outcome: 'noop', reason: 'no-head-to-trim', conversation: null };
    }
    const summary = await opts.summarise(headSlice);

    if (summary === null) {
      // **Graceful degradation** (promt19 edge case #1 + #2). Drop the head
      // slice silently, preserving the tail. No synthetic marker — the
      // operator hasn't been informed via this branch; the caller surfaces a
      // warning chip if appropriate. This is the M5 head-trim behaviour
      // (silent drop-oldest) re-used as the summariser's fallback path.
      const trimmed: Conversation = {
        ...current,
        messages: tail,
        updatedAt: Date.now(),
      };
      await bridge().invoke('conversations:save', { profileId, conversation: trimmed });
      set((s) => upsertInList(s, profileId, trimmed));
      return { outcome: 'dropped', conversation: trimmed, reason: 'summariser-returned-null' };
    }

    // Successful summarisation. The replacement is a single synthetic
    // assistant message with `marker: 'summary'`, carrying the summariser
    // call's usage so the UsageBadge + workspace-global spend totals see it
    // (promt19: "Summary call usage credits both UsageBadge AND workspace-
    // global session spend"). The MessageView renders it as a collapsible
    // card (default collapsed; expandable to reveal the summary text).
    const summaryMessage: Message = {
      id: `m_summary_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'assistant',
      content: [{ type: 'text', text: summary.text }],
      marker: 'summary',
      ts: Date.now(),
      ...(summary.usage ? { usage: summary.usage } : {}),
    };
    const next: Conversation = {
      ...current,
      messages: [summaryMessage, ...tail],
      updatedAt: Date.now(),
    };
    await bridge().invoke('conversations:save', { profileId, conversation: next });
    set((s) => upsertInList(s, profileId, next));
    return { outcome: 'summarised', conversation: next, usage: summary.usage };
  },
}));

/** Shared in-list upsert helper for the immutable Zustand state updates. */
function upsertInList(
  s: ConversationsState,
  profileId: string,
  conversation: Conversation,
): Partial<ConversationsState> {
  const existing = s.conversationsByProfile[profileId] ?? [];
  const idx = existing.findIndex((c) => c.id === conversation.id);
  const next = idx >= 0 ? [...existing] : [...existing, conversation];
  if (idx >= 0) next[idx] = conversation;
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    conversationsByProfile: { ...s.conversationsByProfile, [profileId]: next },
  };
}

/** Stable selector — returns the shared `EMPTY` reference when a profile has
 *  no conversations (the React #185 guard; see store comment). */
export function selectConversations(profileId: string | undefined) {
  return (s: ConversationsState): readonly Conversation[] => {
    if (!profileId) return EMPTY;
    const list = s.conversationsByProfile[profileId];
    return list && list.length > 0 ? list : EMPTY;
  };
}
