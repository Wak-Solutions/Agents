import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Inbox, User, Users, Clock, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface EscalationRow {
  customer_phone: string;
  escalation_reason: string;
  status: string;
  created_at: string;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function ChatCard({
  row,
  showAgent,
  action,
}: {
  row: EscalationRow;
  showAgent?: boolean;
  action: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-border rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors">
      <div className="w-9 h-9 rounded-full bg-[#0F510F]/10 flex items-center justify-center flex-shrink-0">
        <User className="w-4 h-4 text-[#0F510F]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground font-mono">{row.customer_phone}</p>
        {row.escalation_reason && (
          <p className="text-xs text-muted-foreground truncate">{row.escalation_reason}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <Clock className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{timeAgo(row.created_at)}</span>
          {showAgent && row.assigned_agent_name && (
            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
              {row.assigned_agent_name}
            </span>
          )}
        </div>
      </div>
      <div className="flex-shrink-0">{action}</div>
    </div>
  );
}

type Tab = "shared" | "mine" | "all";

export default function InboxPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin, agentId } = useAuth();
  const [tab, setTab] = useState<Tab>("shared");
  const [unassigned, setUnassigned] = useState<EscalationRow[]>([]);
  const [allChats, setAllChats] = useState<EscalationRow[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthLoading, isAuthenticated, setLocation]);

  const fetchData = useCallback(async () => {
    try {
      const [unRes, allRes] = await Promise.all([
        fetch("/api/escalations/unassigned", { credentials: "include" }),
        fetch("/api/escalations", { credentials: "include" }),
      ]);
      if (unRes.ok) setUnassigned(await unRes.json());
      if (allRes.ok) setAllChats(await allRes.json());
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

  const myChats = allChats.filter(c => c.assigned_agent_id === agentId);

  const tabs: { key: Tab; label: string; count: number; show: boolean }[] = [
    { key: "shared", label: "Shared Inbox", count: unassigned.length, show: true },
    { key: "mine",   label: "My Chats",     count: myChats.length,    show: true },
    { key: "all",    label: "All Chats",    count: allChats.length,   show: isAdmin },
  ];

  const activeRows =
    tab === "shared" ? unassigned :
    tab === "mine"   ? myChats :
    allChats;

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

        {/* Chat list */}
        <div className="space-y-2">
          {activeRows.length === 0 ? (
            <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Inbox className="w-10 h-10 opacity-30" />
              <p className="text-sm">
                {tab === "shared" ? "No unassigned chats" :
                 tab === "mine"   ? "No chats assigned to you" :
                 "No open chats"}
              </p>
            </div>
          ) : (
            activeRows.map(row => (
              <ChatCard
                key={row.customer_phone}
                row={row}
                showAgent={tab === "all"}
                action={
                  tab === "shared" ? (
                    <button
                      onClick={() => claim(row.customer_phone)}
                      disabled={claiming === row.customer_phone}
                      className="px-3 py-1.5 text-xs font-semibold bg-[#0F510F] text-white rounded-lg hover:bg-[#0d4510] disabled:opacity-50 transition-colors"
                    >
                      {claiming === row.customer_phone ? "Claiming…" : "Claim"}
                    </button>
                  ) : (
                    <Link href={`/?phone=${encodeURIComponent(row.customer_phone)}`}>
                      <a className="px-3 py-1.5 text-xs font-semibold border border-[#0F510F]/30 text-[#0F510F] rounded-lg hover:bg-[#0F510F]/5 transition-colors">
                        Open
                      </a>
                    </Link>
                  )
                }
              />
            ))
          )}
        </div>
      </main>
    </div>
  );
}
