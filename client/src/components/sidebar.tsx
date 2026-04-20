import { useState } from "react";
import { isToday, isYesterday, format } from "date-fns";
import { MessageSquare, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import type { Conversation } from "@shared/schema";

type FilterType = "all" | "open" | "closed";

interface SidebarProps {
  conversations: Conversation[];
  selectedPhone: string | null;
  onSelect: (phone: string) => void;
}

/* ────────────────────────────────────────────────────────────
   WhatsApp-style time formatting — "10:32 AM", "Yesterday", "3/28/26"
   ──────────────────────────────────────────────────────────── */
function formatConversationTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "M/d/yy");
}

/* ────────────────────────────────────────────────────────────
   Avatar colors — consistent color per phone number
   ──────────────────────────────────────────────────────────── */
const AVATAR_COLORS = [
  "#00a884", "#008069", "#25D366", "#075E54",
  "#128C7E", "#34B7F1", "#7C94B6", "#546E7A",
];

function getAvatarColor(phone: string): string {
  let hash = 0;
  for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(phone: string): string {
  // Use first 2 digits after country code, or last 2 digits
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4, -2);
  return digits.slice(-2);
}

/* ════════════════════════════════════════════════════════════
   MAIN EXPORT — Sidebar (WhatsApp Web conversation list)
   ════════════════════════════════════════════════════════════ */
export function Sidebar({ conversations, selectedPhone, onSelect }: SidebarProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { t } = useLanguage();

  // ESCALATION — hidden for now
  // const activeConversations = conversations.filter(c => c.escalation_status !== "closed");
  // const filteredByStatus =
  //   filter === "all" ? conversations :
  //   filter === "open" ? activeConversations :
  //   conversations.filter(c => c.escalation_status === "closed");
  const activeConversations = conversations;
  const filteredByStatus = conversations;

  // Search filter
  const visible = searchQuery.trim()
    ? filteredByStatus.filter(c =>
        c.customer_phone.includes(searchQuery) ||
        (c.last_message && c.last_message.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : filteredByStatus;

  const tabs: { key: FilterType; label: string }[] = [
    { key: "all", label: t("sidebarFilterAll") },
    { key: "open", label: t("sidebarFilterActive") },
    { key: "closed", label: t("sidebarFilterResolved") },
  ];

  return (
    <div className="w-full md:w-80 h-full bg-white border-e border-[#E9EDEF] flex flex-col z-10">
      {/* ─── Header — WhatsApp Web style ─── */}
      <div className="px-4 py-3 bg-[#F0F2F5] flex items-center justify-between shrink-0">
        <span className="text-[15px] font-bold text-[#111b21] tracking-tight">{t("sidebarInbox")}</span>
        {/* ESCALATION — hidden for now */}
        {/* <div className="flex items-center gap-1">
          <span className="text-[11px] font-medium text-[#00a884] bg-[#00a884]/10 px-2 py-0.5 rounded-full">
            {activeConversations.length} {t("sidebarActiveLabel")}
          </span>
        </div> */}
      </div>

      {/* ─── Search bar ─── */}
      <div className="px-2 py-1.5 bg-white border-b border-[#E9EDEF]">
        <div className="flex items-center bg-[#F0F2F5] rounded-lg px-3 py-1.5 gap-2">
          <Search className="w-4 h-4 text-[#54656f] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t("sidebarSearchPlaceholder")}
            className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-[13px] text-[#111b21] placeholder:text-[#667781]"
          />
        </div>
      </div>

      {/* ─── Filter tabs ─── */}
      <div className="flex border-b border-[#E9EDEF] px-2 bg-white">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "flex-1 py-2 text-[12px] font-medium transition-colors",
              filter === tab.key
                ? "text-[#00a884] border-b-2 border-[#00a884]"
                : "text-[#54656f] hover:text-[#111b21]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Conversation list ─── */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="p-6 text-center text-[#667781] text-sm mt-10">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 text-[#667781]/30" />
            <p className="text-[13px]">{t("sidebarNoConversations")}</p>
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

/* ────────────────────────────────────────────────────────────
   ConversationItem — WhatsApp Web row style
   ──────────────────────────────────────────────────────────── */
function ConversationItem({
  conversation,
  isSelected,
  onClick,
}: {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}) {
  // ESCALATION — hidden for now
  // const isOpen = conversation.escalation_status !== "closed";
  const isOpen = true;
  const phone = conversation.customer_phone;
  const initials = getInitials(phone);
  const avatarColor = getAvatarColor(phone);
  const timeLabel = formatConversationTime(conversation.last_message_at);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-start flex items-center gap-3 px-3 py-3 border-b border-[#E9EDEF]/60 hover:bg-[#F0F2F5] transition-colors",
        isSelected && "bg-[#F0F2F5]"
      )}
    >
      {/* Avatar circle */}
      <div
        className="w-[49px] h-[49px] rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: avatarColor }}
      >
        <span className="text-[16px] font-bold text-white">{initials}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Top row: name + time */}
        <div className="flex items-center justify-between mb-0.5">
          <span className={cn(
            "text-[15px] font-normal truncate",
            isSelected ? "text-[#111b21]" : "text-[#111b21]"
          )}>
            {phone}
          </span>
          <span className={cn(
            "text-[12px] shrink-0 ml-2",
            isOpen && !isSelected ? "text-[#25D366] font-medium" : "text-[#667781]"
          )}>
            {timeLabel}
          </span>
        </div>
        {/* Bottom row: last message + unread badge */}
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-[#667781] truncate pr-2">
            {conversation.last_message || ""}
          </span>
          {isOpen && !isSelected && (
            <span className="w-[18px] h-[18px] rounded-full bg-[#25D366] flex items-center justify-center shrink-0">
              <span className="text-[10px] font-bold text-white leading-none">1</span>
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
