import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Conversation } from '../../../../shared/domain/conversations';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';

/** Left-side conversation switcher inside the chat view. */
export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  conversations: readonly Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card/30">
      <div className="flex items-center justify-between border-b p-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('chat.conversations')}
        </h2>
        <Button size="icon" variant="ghost" onClick={onNew} title={t('chat.newConversation')}>
          <Plus className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">{t('chat.noConversations')}</div>
        ) : (
          <ul className="flex flex-col">
            {conversations.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60',
                      active && 'bg-muted text-foreground',
                    )}
                  >
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{c.title || t('chat.untitled')}</span>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="invisible mr-1 size-7 group-hover:visible"
                    onClick={() => onDelete(c.id)}
                    title={t('chat.delete')}
                    aria-label={t('chat.delete')}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
