import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { Inbox, User, Users, Clock, RefreshCw, Calendar, Video, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import DashboardLayout from "@/components/DashboardLayout";

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

function StatusBadge({ status, label }: { status: string; label: string }) {
  const colors: Record<string, string> = {
    in_progress: "bg-yellow-100 text-yellow-700",
    closed: "bg-green-100 text-green-700",
    resolved: "bg-green-100 text-green-700",
    completed: "bg-green-100 text-green-700",
    open: "bg-gray-100 text-gray-600",
    pending: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${colors[status] ?? colors.open}`}>
      {label}
    </span>
  );
}

function MeetingModal({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-semibold text-gray-900">{t("inboxMeetingDetails")}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-0.5">{t("inboxCustomer")}</p>
              <p className="text-sm font-semibold font-mono text-gray-900">{item.customer_phone}</p>
            </div>
            {item.meeting_scheduled_at && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-0.5">{t("inboxDateTime")}</p>
                <p className="text-sm font-semibold text-gray-900">{formatKsa(item.meeting_scheduled_at)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-0.5">{t("inboxStatus")}</p>
              <StatusBadge status={item.meeting_status ?? "pending"} label={item.meeting_status ?? "pending"} />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-0.5">{t("inboxAssignedAgent")}</p>
              {item.meeting_agent_name
                ? <p className="text-sm text-gray-900">{item.meeting_agent_name}</p>
                : <p className="text-sm text-gray-400 italic">{t("inboxUnassigned")}</p>}
            </div>
          </div>
          {item.meeting_link && (
            <a
              href={item.meeting_link}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0F510F] hover:bg-[#0d4510] text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <Video className="w-4 h-4" /> {t("inboxJoinMeeting")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

type Tab = "shared" | "mine" | "all";

export default function InboxPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin, agentId } = useAuth();
  const [tab, setTab] = useState<Tab>("shared");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [meetingModal, setMeetingModal] = useState<InboxItem | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthLoading, isAuthenticated, setLocation]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { credentials: "include" });
      if (res.ok) setItems(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
      const interval = setInterval(fetchData, 15000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, fetchData]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isAuthenticated) fetchData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchData, isAuthenticated]);

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
        setError(body.message || t("inboxClaimError"));
      } else {
        await fetchData();
      }
    } catch {
      setError(t("inboxNetworkError"));
    } finally {
      setClaiming(null);
    }
  };

  const sharedItems = items.filter(item =>
    item.item_type === "chat" ? item.assigned_agent_id === null : item.meeting_agent_id === null,
  );
  const myItems = items.filter(item =>
    item.item_type === "chat" ? item.assigned_agent_id === agentId : item.meeting_agent_id === agentId,
  );

  const tabs: { key: Tab; label: string; count: number; show: boolean }[] = [
    { key: "shared", label: t("inboxTabShared"), count: sharedItems.length, show: true },
    { key: "mine", label: t("inboxTabMy"), count: myItems.length, show: true },
    { key: "all", label: t("inboxTabAll"), count: items.length, show: isAdmin },
  ];

  const activeItems = tab === "shared" ? sharedItems : tab === "mine" ? myItems : items;

  return (
    <DashboardLayout>
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          {/* Page header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t("inboxTitle")}</h1>
              <p className="text-sm text-gray-500 mt-1">{items.length} items</p>
            </div>
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-5">
            {tabs.filter(tb => tb.show).map(tb => (
              <button
                key={tb.key}
                onClick={() => setTab(tb.key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  tab === tb.key ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tb.key === "all" ? <Users className="w-3.5 h-3.5" /> : <Inbox className="w-3.5 h-3.5" />}
                {tb.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  tab === tb.key ? "bg-[#0F510F] text-white" : "bg-gray-300/50 text-gray-500"
                }`}>
                  {tb.count}
                </span>
              </button>
            ))}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4">{error}</p>
          )}

          {/* Items */}
          <div className="space-y-2">
            {activeItems.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
                <Inbox className="w-10 h-10 opacity-30" />
                <p className="text-sm">
                  {tab === "shared" ? t("inboxEmptyShared") : tab === "mine" ? t("inboxEmptyMy") : t("inboxEmptyAll")}
                </p>
              </div>
            ) : (
              activeItems.map(item =>
                item.item_type === "meeting" ? (
                  <div key={`meeting-${item.meeting_id}`} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-gray-50/50 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <Calendar className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 font-mono">{item.customer_phone}</p>
                        <StatusBadge status={item.meeting_status ?? "pending"} label={item.meeting_status ?? "pending"} />
                      </div>
                      {item.meeting_scheduled_at && (
                        <p className="text-xs text-gray-500 mt-0.5">{formatKsa(item.meeting_scheduled_at)}</p>
                      )}
                    </div>
                    <button
                      onClick={() => setMeetingModal(item)}
                      className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      {t("inboxView")}
                    </button>
                  </div>
                ) : (
                  <div key={item.customer_phone} className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#0F510F]/10 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-[#0F510F]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-900 font-mono">{item.customer_phone}</p>
                          <StatusBadge
                            status={item.chat_status ?? "open"}
                            label={item.chat_status === "in_progress" ? `${t("statusInProgress")}${item.assigned_agent_name ? ` · ${item.assigned_agent_name}` : ""}` : item.chat_status === "closed" || item.chat_status === "resolved" ? t("statusResolved") : t("statusOpen")}
                          />
                        </div>
                        {item.escalation_reason && (
                          <p className="text-xs text-gray-500 truncate">{item.escalation_reason}</p>
                        )}
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Clock className="w-3 h-3 text-gray-400" />
                          <span className="text-xs text-gray-400">{timeAgo(item.created_at)}</span>
                        </div>
                      </div>
                      <div className="shrink-0">
                        {tab === "shared" ? (
                          <button
                            onClick={() => claim(item.customer_phone)}
                            disabled={claiming === item.customer_phone}
                            className="px-3 py-1.5 text-xs font-medium bg-[#0F510F] text-white rounded-lg hover:bg-[#0d4510] disabled:opacity-50 transition-colors"
                          >
                            {claiming === item.customer_phone ? t("inboxClaiming") : t("inboxClaim")}
                          </button>
                        ) : (
                          <Link href={`/dashboard?phone=${encodeURIComponent(item.customer_phone)}`}>
                            <a className="px-3 py-1.5 text-xs font-medium border border-[#0F510F]/30 text-[#0F510F] rounded-lg hover:bg-[#0F510F]/5 transition-colors">
                              {t("inboxOpen")}
                            </a>
                          </Link>
                        )}
                      </div>
                    </div>
                    {item.meeting_id && item.meeting_scheduled_at && (
                      <button
                        onClick={() => setMeetingModal(item)}
                        className="mt-2 ms-12 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700 font-medium hover:bg-blue-100 transition-colors"
                      >
                        <Calendar className="w-3 h-3" />
                        {t("inboxMeeting")} · {formatKsa(item.meeting_scheduled_at)}
                      </button>
                    )}
                  </div>
                ),
              )
            )}
          </div>
        </div>
      </div>

      {meetingModal && <MeetingModal item={meetingModal} onClose={() => setMeetingModal(null)} />}
    </DashboardLayout>
  );
}
