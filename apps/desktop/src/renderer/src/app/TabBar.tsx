import { useRef } from 'react';
import { Command, Pin, PinOff, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { useWorkspaceStore, type Tab } from '@renderer/stores/workspace';

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const activateTab = useWorkspaceStore((s) => s.activateTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const togglePin = useWorkspaceStore((s) => s.togglePin);
  const moveTab = useWorkspaceStore((s) => s.moveTab);
  const openTab = useWorkspaceStore((s) => s.openTab);

  const dragId = useRef<string | null>(null);

  const activeView = tabs.find((tt) => tt.id === activeTabId)?.view ?? 'connections';

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b bg-background px-2">
      {tabs.map((tab, index) => (
        <TabChip
          key={tab.id}
          tab={tab}
          label={t(`tabs.${tab.view}`)}
          active={tab.id === activeTabId}
          onActivate={() => activateTab(tab.id)}
          onClose={() => closeTab(tab.id)}
          onTogglePin={() => togglePin(tab.id)}
          closeTitle={t('tabs.close')}
          pinTitle={tab.pinned ? t('tabs.unpin') : t('tabs.pin')}
          onDragStart={() => (dragId.current = tab.id)}
          onDrop={() => {
            if (dragId.current && dragId.current !== tab.id) moveTab(dragId.current, index);
            dragId.current = null;
          }}
        />
      ))}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        title={t('tabs.newTab')}
        aria-label={t('tabs.newTab')}
        onClick={() => openTab(activeView)}
      >
        <Plus />
      </Button>
      <div
        className="ml-auto flex shrink-0 select-none items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground"
        title={t('commandPalette.title')}
      >
        <Command className="size-3" aria-hidden />
        <span>K</span>
      </div>
    </div>
  );
}

function TabChip({
  tab,
  label,
  active,
  onActivate,
  onClose,
  onTogglePin,
  closeTitle,
  pinTitle,
  onDragStart,
  onDrop,
}: {
  tab: Tab;
  label: string;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  onTogglePin: () => void;
  closeTitle: string;
  pinTitle: string;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      onClick={onActivate}
      onAuxClick={(event) => {
        if (event.button === 1 && !tab.pinned) onClose();
      }}
      className={cn(
        'group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
      )}
    >
      <button
        type="button"
        title={pinTitle}
        onClick={(event) => {
          event.stopPropagation();
          onTogglePin();
        }}
        className={cn(
          'shrink-0 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-60',
          tab.pinned && 'opacity-80',
        )}
      >
        {tab.pinned ? <Pin className="size-3" /> : <PinOff className="size-3" />}
      </button>
      <span className="truncate">{label}</span>
      {!tab.pinned && (
        <button
          type="button"
          title={closeTitle}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="shrink-0 rounded opacity-0 transition-opacity hover:bg-background/60 hover:opacity-100 group-hover:opacity-60"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
