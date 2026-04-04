import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import type { Conversation } from "@shared/schema";

type Filter = "all" | "open" | "closed";

interface SidebarProps {
  conversations: Conversation[];
  selectedPhone: string | null;
  onSelect: (phone: string) => void;
}

export function Sidebar({ conversations, selectedPhone, onSelect }: SidebarProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const { t } = useLanguage();

  const activeConversations = conversations.filter(c => c.escalation_status !== "closed");
  const visible =
    filter === "all" ? conversations :
    filter === "open" ? activeConversations :
    conversations.filter(c => c.escalation_status === "closed");

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: t("sidebarFilterAll") },
    { key: "open", label: t("sidebarFilterActive") },
    { key: "closed", label: t("sidebarFilterResolved") },
  ];

  return (
    <div className="w-full md:w-80 h-full bg-white border-e border-gray-200 flex flex-col z-10">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/80">
        <div className="flex items-center gap-2.5">
          <Inbox className="w-4 h-4 text-[#0F510F]" />
          <div>
            <span className="text-sm font-semibold text-gray-800">{t("sidebarInbox")}</span>
            <span className="text-gray-400 font-normal text-sm"> · {activeConversations.length} {t("sidebarActiveConversations")}</span>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-gray-100">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "flex-1 py-2.5 text-xs font-medium transition-colors",
              filter === tab.key
                ? "text-[#0F510F] border-b-2 border-[#0F510F]"
                : "text-gray-400 hover:text-gray-600"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="p-4 text-center text-gray-400 text-sm mt-10">
            <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-20" />
            {t("sidebarNoConversations")}
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

function ConversationItem({ conversation, isSelected, onClick }: { conversation: Conversation; isSelected: boolean; onClick: () => void }) {
  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), { addSuffix: true })
    : "";
  const isOpen = conversation.escalation_status !== "closed";

  // Mask phone: +966 5** ***4821
  const phone = conversation.customer_phone;
  const masked = phone.length >= 8
    ? phone.slice(0, -4).replace(/\d(?=.*\d{4})/g, "*").slice(0, -4) + " " + phone.slice(-4)
    : phone;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-start px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors",
        isSelected && "bg-[#0F510F]/5 border-s-2 border-s-[#0F510F]"
      )}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className={cn(
          "text-sm font-medium truncate",
          isSelected ? "text-[#0F510F]" : "text-gray-900"
        )}>
          {conversation.customer_phone}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-gray-400">{timeAgo}</span>
          {isOpen && !isSelected && (
            <span className="w-2 h-2 rounded-full bg-[#0F510F]" />
          )}
        </div>
      </div>
      <div className="text-xs text-gray-500 truncate">{conversation.last_message}</div>
      <div className="text-[10px] text-gray-400 mt-0.5">{masked}</div>
    </button>
  );
}
