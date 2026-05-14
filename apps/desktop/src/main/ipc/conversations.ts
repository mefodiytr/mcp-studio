import type { ConversationRepository } from '../store/conversation-repository';
import { handle } from './index';

/** Wire the `conversations:*` IPC channels — per-profile conversation
 *  persistence for the M5 chat foundation. The renderer owns the ReAct loop
 *  and the LLM provider; main is just storage + (in C75) the safety boundary
 *  for AI-attributed write calls. */
export function registerConversationHandlers(conversations: ConversationRepository): void {
  handle('conversations:list', ({ profileId }) => ({
    conversations: conversations.list(profileId),
  }));
  handle('conversations:get', ({ profileId, id }) => ({
    conversation: conversations.get(profileId, id),
  }));
  handle('conversations:save', ({ profileId, conversation }) => {
    conversations.save(profileId, conversation);
    return {};
  });
  handle('conversations:delete', ({ profileId, id }) => {
    conversations.delete(profileId, id);
    return {};
  });
  handle('conversations:append', ({ profileId, conversationId, message }) => ({
    conversation: conversations.append(profileId, conversationId, message),
  }));
}
