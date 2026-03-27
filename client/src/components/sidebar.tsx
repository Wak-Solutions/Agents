import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import type { Conversation } from "@shared/schema";

type Filter = 'all' | 'open' | 'closed';

interface SidebarProps {
  conversations: Conversation[];
  selectedPhone: string | null;
  onSelect: (phone: string) => void;
}

export function Sidebar({ conversations, selectedPhone, onSelect }: SidebarProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const { t } = useLanguage();

  const activeConversations = conversations.filter(c => c.escalation_status !== 'closed');
  const visible = filter === 'all' ? conversations
    : filter === 'open' ? activeConversations
    : conversations.filter(c => c.escalation_status === 'closed');

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: t('sidebarFilterAll') },
    { key: 'open', label: t('sidebarFilterActive') },
    { key: 'closed', label: t('sidebarFilterResolved') },
  ];

  return (
    <div className="w-full md:w-80 h-full bg-card border-r border-border flex flex-col z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
      <div className="p-4 border-b border-border/50 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Inbox className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">{t('sidebarInbox')}</h2>
          <p className="text-xs text-muted-foreground">{activeConversations.length} {t('sidebarActiveConversations')}</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-border/50">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "flex-1 py-2 text-xs font-medium transition-colors",
              filter === tab.key
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {visible.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm mt-10">
            <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-20" />
            {t('sidebarNoConversations')}
          </div>
        ) : (
          visible.map(conv => (
            <ConversationItem
              key={conv.customer_phone}
              conversation={conv}
              isSelected={selectedPhone === conv.customer_phone}
              onClick={() => onSelect(conv.customer_phone)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ConversationItem({ conversation, isSelected, onClick }: { conversation: Conversation, isSelected: boolean, onClick: () => void }) {
  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), { addSuffix: true })
    : '';
  const isOpen = conversation.escalation_status !== 'closed';

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-xl transition-all duration-200 group flex gap-3 relative",
        isSelected ? "bg-primary/5 border-primary/20 border" : "hover:bg-muted border border-transparent"
      )}
    >
      {isOpen && !isSelected && (
        <span className="absolute top-4 right-4 w-2 h-2 rounded-full bg-primary" />
      )}

      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center flex-shrink-0 border border-primary/10">
        <span className="text-primary font-medium text-sm">
          {conversation.customer_phone.slice(-2)}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline mb-0.5">
          <span className={cn(
            "text-sm font-semibold truncate block",
            isSelected ? "text-primary" : "text-foreground"
          )}>
            {conversation.customer_phone}
          </span>
          <span className="text-[10px] text-muted-foreground flex-shrink-0 whitespace-nowrap ml-2">
            {timeAgo}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate line-clamp-1 group-hover:text-foreground/70 transition-colors">
          {conversation.last_message}
        </p>
      </div>
    </button>
  );
}
