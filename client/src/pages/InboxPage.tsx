import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Inbox, User, Users, Clock, RefreshCw, Calendar, Video, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface InboxItem {
  item_type: "chat" | "meeting";
  customer_phone: string;
  escalation_reason: string | null;
  chat_status: string | null;
  created_at: string;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
  meeting_id: number | null;
  meeting_scheduled_at: string | null;
  meeting_status: string | null;
  meeting_link: string | null;
  meeting_agent_id: number | null;
  meeting_agent_name: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatKsa(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ChatStatusBadge({ status, agentName }: { status: string; agentName?: string | null }) {
  if (status === "in_progress") return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
      <Clock className="w-2.5 h-2.5" />
      In Progress{agentName ? ` · ${agentName}` : ""}
    </span>
  );
  if (status === "closed" || status === "resolved") return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-[#0F510F]/10 text-[#0F510F]">
      Resolved
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
      Open
    </span>
  );
}

function MeetingStatusBadge({ status }: { status: string }) {
  if (status === "in_progress") return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
      <Clock className="w-2.5 h-2.5" /> In Progress
    </span>
  );
  if (status === "completed") return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-[#0F510F]/10 text-[#0F510F]">
      Completed
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
      <Calendar className="w-2.5 h-2.5" /> Upcoming
    </span>
  );
}

// ── Meeting detail modal ──────────────────────────────────────────────────────

function MeetingModal({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-semibold text-foreground">Meeting Details</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-muted/50 rounded-xl p-4 space-y-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Customer</p>
              <p className="text-sm font-semibold font-mono text-foreground">{item.customer_phone}</p>
            </div>
            {item.meeting_scheduled_at && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Date & Time (KSA)</p>
                <p className="text-sm font-semibold text-foreground">{formatKsa(item.meeting_scheduled_at)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Status</p>
              <MeetingStatusBadge status={item.meeting_status ?? "pending"} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Assigned Agent</p>
              {item.meeting_agent_name
                ? <p className="text-sm text-foreground">{item.meeting_agent_name}</p>
                : <p className="text-sm text-muted-foreground italic">Unassigned</p>}
            </div>
          </div>

          {item.meeting_link && (
            <a
              href={item.meeting_link}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <Video className="w-4 h-4" />
              Join Meeting
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Chat card (with optional meeting attachment) ──────────────────────────────

function ChatCard({
  item,
  showAgent,
  action,
  onMeetingClick,
}: {
  item: InboxItem;
  showAgent?: boolean;
  action: React.ReactNode;
  onMeetingClick?: () => void;
}) {
  return (
    <div className="bg-white border border-border rounded-xl px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-[#0F510F]/10 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-[#0F510F]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground font-mono">{item.customer_phone}</p>
            <ChatStatusBadge status={item.chat_status ?? "open"} agentName={item.assigned_agent_name} />
          </div>
          {item.escalation_reason && (
            <p className="text-xs text-muted-foreground truncate">{item.escalation_reason}</p>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{timeAgo(item.created_at)}</span>
            {showAgent && !item.assigned_agent_name && (
              <span className="text-xs text-muted-foreground italic">Unassigned</span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0">{action}</div>
      </div>

      {/* Linked meeting pill — shown when this chat customer also has a booked meeting */}
      {item.meeting_id && item.meeting_scheduled_at && (
        <button
          onClick={onMeetingClick}
          className="mt-2 ml-12 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700 font-medium hover:bg-blue-100 transition-colors"
        >
          <Calendar className="w-3 h-3" />
          Meeting · {formatKsa(item.meeting_scheduled_at)}
        </button>
      )}
    </div>
  );
}

// ── Standalone meeting card ───────────────────────────────────────────────────

function MeetingCard({
  item,
  showAgent,
  onView,
}: {
  item: InboxItem;
  showAgent?: boolean;
  onView: () => void;
}) {
  return (
    <div className="bg-white border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-blue-50/40 transition-colors">
      <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
        <Calendar className="w-4 h-4 text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-foreground font-mono">{item.customer_phone}</p>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
            <Calendar className="w-2.5 h-2.5" /> Meeting
          </span>
          <MeetingStatusBadge status={item.meeting_status ?? "pending"} />
        </div>
        {item.meeting_scheduled_at && (
          <p className="text-xs text-blue-700 font-medium mt-0.5">{formatKsa(item.meeting_scheduled_at)}</p>
        )}
        {showAgent && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.meeting_agent_name ?? <span className="italic">Unassigned</span>}
          </p>
        )}
      </div>
      <div className="flex-shrink-0">
        <button
          onClick={onView}
          className="px-3 py-1.5 text-xs font-semibold border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors"
        >
          View
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "shared" | "mine" | "all";

export default function InboxPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin, agentId } = useAuth();
  const [tab, setTab] = useState<Tab>("shared");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [meetingModal, setMeetingModal] = useState<InboxItem | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthLoading, isAuthenticated, setLocation]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { credentials: "include" });
      if (res.ok) setItems(await res.json());
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
      const interval = setInterval(fetchData, 15000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, fetchData]);

  const claim = async (phone: string) => {
    setClaiming(phone);
    setError("");
    try {
      const res = await fetch(`/api/escalations/${encodeURIComponent(phone)}/claim`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message || "Failed to claim chat");
      } else {
        await fetchData();
      }
    } catch (_) {
      setError("Network error");
    } finally {
      setClaiming(null);
    }
  };

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Tab filtering
  const sharedItems = items.filter(item =>
    item.item_type === "chat" ? item.assigned_agent_id === null : item.meeting_agent_id === null
  );
  const myItems = items.filter(item =>
    item.item_type === "chat" ? item.assigned_agent_id === agentId : item.meeting_agent_id === agentId
  );

  const tabs: { key: Tab; label: string; count: number; show: boolean }[] = [
    { key: "shared", label: "Shared Inbox", count: sharedItems.length, show: true },
    { key: "mine",   label: "My Chats",     count: myItems.length,    show: true },
    { key: "all",    label: "All",           count: items.length,      show: isAdmin },
  ];

  const activeItems =
    tab === "shared" ? sharedItems :
    tab === "mine"   ? myItems :
    items;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="h-14 bg-[#0F510F] text-white flex items-center justify-between px-5 flex-shrink-0 shadow-md">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="WAK Solutions" className="h-[36px] shrink-0" />
          <span className="hidden sm:block font-semibold text-sm text-white/90">WAK Solutions</span>
          <span className="hidden sm:block text-white/40">—</span>
          <span className="hidden sm:block text-sm text-white/70">Inbox</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            title="Refresh"
            className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <Link href="/">
            <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Dashboard</span>
            </a>
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-[#0F510F]" />
          <h1 className="text-xl font-bold text-foreground">Inbox</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-muted p-1 rounded-xl w-fit">
          {tabs.filter(t => t.show).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                tab === t.key
                  ? "bg-white shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.key === "all" ? <Users className="w-3.5 h-3.5" /> : <Inbox className="w-3.5 h-3.5" />}
              {t.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                tab === t.key ? "bg-[#0F510F] text-white" : "bg-muted-foreground/20 text-muted-foreground"
              }`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</p>
        )}

        {/* Item list */}
        <div className="space-y-2">
          {activeItems.length === 0 ? (
            <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Inbox className="w-10 h-10 opacity-30" />
              <p className="text-sm">
                {tab === "shared" ? "Nothing in the shared inbox" :
                 tab === "mine"   ? "Nothing assigned to you" :
                 "No items"}
              </p>
            </div>
          ) : (
            activeItems.map(item =>
              item.item_type === "meeting" ? (
                <MeetingCard
                  key={`meeting-${item.meeting_id}`}
                  item={item}
                  showAgent={tab === "all"}
                  onView={() => setMeetingModal(item)}
                />
              ) : (
                <ChatCard
                  key={item.customer_phone}
                  item={item}
                  showAgent={tab === "all"}
                  onMeetingClick={item.meeting_id ? () => setMeetingModal(item) : undefined}
                  action={
                    tab === "shared" ? (
                      <button
                        onClick={() => claim(item.customer_phone)}
                        disabled={claiming === item.customer_phone}
                        className="px-3 py-1.5 text-xs font-semibold bg-[#0F510F] text-white rounded-lg hover:bg-[#0d4510] disabled:opacity-50 transition-colors"
                      >
                        {claiming === item.customer_phone ? "Claiming…" : "Claim"}
                      </button>
                    ) : (
                      <Link href={`/?phone=${encodeURIComponent(item.customer_phone)}`}>
                        <a className="px-3 py-1.5 text-xs font-semibold border border-[#0F510F]/30 text-[#0F510F] rounded-lg hover:bg-[#0F510F]/5 transition-colors">
                          Open
                        </a>
                      </Link>
                    )
                  }
                />
              )
            )
          )}
        </div>
      </main>

      {meetingModal && (
        <MeetingModal item={meetingModal} onClose={() => setMeetingModal(null)} />
      )}
    </div>
  );
}
