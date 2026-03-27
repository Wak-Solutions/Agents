import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Plus, UserCheck, UserX, KeyRound, Edit2, Users, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";

type Period = "today" | "week" | "month" | "all";

interface Agent {
  id: number;
  name: string;
  email: string;
  role: "admin" | "agent";
  is_active: boolean;
  last_login: string | null;
  resolved_chats: number;
  meetings_completed: number;
  avg_survey_rating: number | null;
}

interface WorkloadRow {
  agent_id: number;
  name: string;
  is_active: boolean;
  active_chats: number;
  resolved_today: number;
  resolved_this_week: number;
  total_resolved: number;
  meetings_completed: number;
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {children}
    </span>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function AgentsTab() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin } = useAuth();
  const { t } = useLanguage();

  const PERIODS: { key: Period; label: string; sub: string }[] = [
    { key: "today", label: t("periodToday"),     sub: t("periodToday") },
    { key: "week",  label: t("periodThisWeek"),  sub: t("periodThisWeek") },
    { key: "month", label: t("periodThisMonth"), sub: t("periodThisMonth") },
    { key: "all",   label: t("periodAllTime"),   sub: t("periodAllTime") },
  ];

  const [period, setPeriod] = useState<Period>("all");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workload, setWorkload] = useState<WorkloadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // New agent modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: "", email: "", password: "", role: "agent" as "agent" | "admin" });
  const [newError, setNewError] = useState("");
  const [newSaving, setNewSaving] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  // Edit modal
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", role: "agent" as "agent" | "admin" });
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Reset password modal
  const [resetAgent, setResetAgent] = useState<Agent | null>(null);
  const [newPw, setNewPw] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetSaving, setResetSaving] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
    if (!isAuthLoading && isAuthenticated && !isAdmin) setLocation("/");
  }, [isAuthLoading, isAuthenticated, isAdmin, setLocation]);

  const fetchAll = useCallback(async (p: Period = period) => {
    setLoading(true);
    try {
      const [aRes, wRes] = await Promise.all([
        fetch(`/api/agents?period=${p}`, { credentials: "include" }),
        fetch("/api/agents/workload", { credentials: "include" }),
      ]);
      if (aRes.ok) setAgents(await aRes.json());
      if (wRes.ok) setWorkload(await wRes.json());
    } catch (_) {
      setError(t("agentsErrorLoad"));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      fetchAll(period);
      const interval = setInterval(() => fetchAll(period), 60000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, isAdmin, period]);

  // Re-fetch immediately on foreground — the 60-second interval is too long
  // to rely on after the iOS PWA resumes from background.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isAuthenticated && isAdmin) fetchAll(period);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchAll, period, isAuthenticated, isAdmin]);

  const toggleActive = async (agent: Agent) => {
    const endpoint = agent.is_active ? "deactivate" : "activate";
    const res = await fetch(`/api/agents/${agent.id}/${endpoint}`, {
      method: "PATCH", credentials: "include",
    });
    if (res.ok) {
      fetchAll();
    } else {
      const b = await res.json().catch(() => ({}));
      setError(b.message || t("agentsErrorUpdate"));
    }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewError(""); setNewSaving(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAgent),
      });
      const body = await res.json();
      if (!res.ok) { setNewError(body.message || t("agentsErrorCreate")); return; }
      setCreatedPassword(newAgent.password);
      setNewAgent({ name: "", email: "", password: "", role: "agent" });
      fetchAll();
    } catch (_) {
      setNewError(t("agentsErrorNetwork"));
    } finally {
      setNewSaving(false);
    }
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAgent) return;
    setEditError(""); setEditSaving(true);
    try {
      const res = await fetch(`/api/agents/${editAgent.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) { const b = await res.json(); setEditError(b.message || t("agentsErrorUpdate")); return; }
      setEditAgent(null);
      fetchAll();
    } catch (_) {
      setEditError(t("agentsErrorNetwork"));
    } finally {
      setEditSaving(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetAgent) return;
    setResetError(""); setResetSaving(true);
    try {
      const res = await fetch(`/api/agents/${resetAgent.id}/reset-password`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: newPw }),
      });
      if (!res.ok) { const b = await res.json(); setResetError(b.message || t("agentsErrorUpdate")); return; }
      setResetAgent(null); setNewPw("");
    } catch (_) {
      setResetError(t("agentsErrorNetwork"));
    } finally {
      setResetSaving(false);
    }
  };

  if (isAuthLoading || !isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>;
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="h-14 bg-[#0F510F] text-white flex items-center justify-between px-5 flex-shrink-0 shadow-md">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="WAK Solutions" className="h-[36px] shrink-0" />
          <span className="hidden sm:block font-semibold text-sm text-white/90">WAK Solutions</span>
          <span className="hidden sm:block text-white/40">—</span>
          <span className="hidden sm:block text-sm text-white/70">{t("agentsTitle")}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchAll(period)} title="Refresh" className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <Link href="/"><a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("dashboard")}</span>
          </a></Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 space-y-8">

        {/* Section A — Agent List */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-[#0F510F]" />
              <h1 className="text-xl font-bold text-foreground">{t("agentsTitle")}</h1>
            </div>
            <button
              onClick={() => { setCreatedPassword(null); setNewError(""); setShowNewModal(true); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t("agentsNewAgent")}
            </button>
          </div>

          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</p>}

          {/* Period filter */}
          <div className="flex gap-1 bg-muted p-1 rounded-xl w-fit">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  period === p.key
                    ? "bg-[#0F510F] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("agentsColAgent")}</th>
                    <th className="text-left px-2 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-28">{t("agentsColRoleStatus")}</th>
                    <th className="text-center px-2 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-20">
                      <span className="block">{t("agentsColChatsResolved")}</span>
                      {period !== "all" && (
                        <span className="block normal-case font-normal text-muted-foreground/60">{PERIODS.find(p => p.key === period)!.sub}</span>
                      )}
                    </th>
                    <th className="text-center px-2 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-20">{t("agentsColMeetings")}</th>
                    <th className="text-center px-2 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-16">{t("agentsColRating")}</th>
                    <th className="hidden md:table-cell text-left px-2 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-28">{t("agentsColLastLogin")}</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-24 xl:w-32">{t("agentsColActions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {agents.map(agent => (
                    <tr key={agent.id} className="hover:bg-muted/30 transition-colors">
                      {/* Agent: name always, email on md+ */}
                      <td className="px-3 py-3">
                        <p className="font-medium text-foreground truncate">{agent.name}</p>
                        <p className="hidden md:block text-xs text-muted-foreground font-mono truncate">{agent.email}</p>
                      </td>
                      {/* Role + Status stacked */}
                      <td className="px-2 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          <Badge color={agent.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}>
                            {agent.role}
                          </Badge>
                          <Badge color={agent.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}>
                            {agent.is_active ? t("statusActive") : t("statusInactive")}
                          </Badge>
                        </div>
                      </td>
                      {/* Chats Resolved */}
                      <td className="px-1 py-3 text-center font-semibold text-foreground">
                        {agent.resolved_chats}
                      </td>
                      {/* Meetings Done */}
                      <td className="px-1 py-3 text-center">
                        <span className={agent.meetings_completed > 0 ? "font-medium text-foreground" : "text-muted-foreground"}>
                          {agent.meetings_completed}
                        </span>
                      </td>
                      {/* Avg Rating — colour coded */}
                      <td className="px-1 py-3 text-center">
                        {agent.avg_survey_rating == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={`font-medium ${
                            agent.avg_survey_rating >= 4 ? "text-[#0F510F]"
                            : agent.avg_survey_rating >= 2 ? "text-amber-600"
                            : "text-red-600"
                          }`}>
                            {agent.avg_survey_rating} ★
                          </span>
                        )}
                      </td>
                      {/* Last Login — hidden on mobile */}
                      <td className="hidden md:table-cell px-2 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {agent.last_login
                          ? new Date(agent.last_login).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                          : t("agentsNever")}
                      </td>
                      {/* Actions: icon-only on <xl, stacked with labels on xl+ */}
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1 xl:flex-col xl:items-end xl:gap-0.5">
                          <button
                            onClick={() => { setEditForm({ name: agent.name, email: agent.email, role: agent.role }); setEditAgent(agent); setEditError(""); }}
                            title="Edit"
                            className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="hidden xl:inline text-xs">{t("agentsBtnEdit")}</span>
                          </button>
                          <button
                            onClick={() => { setResetAgent(agent); setNewPw(""); setResetError(""); }}
                            title={t("agentsBtnReset")}
                            className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <KeyRound className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="hidden xl:inline text-xs">{t("agentsBtnReset")}</span>
                          </button>
                          <button
                            onClick={() => toggleActive(agent)}
                            title={agent.is_active ? t("agentsBtnDeactivate") : t("agentsBtnActivate")}
                            className={`flex items-center gap-1 px-1.5 py-1 rounded-lg transition-colors ${agent.is_active ? "text-red-500 hover:bg-red-50" : "text-green-600 hover:bg-green-50"}`}
                          >
                            {agent.is_active ? <UserX className="w-3.5 h-3.5 flex-shrink-0" /> : <UserCheck className="w-3.5 h-3.5 flex-shrink-0" />}
                            <span className="hidden xl:inline text-xs">{agent.is_active ? t("agentsBtnDeactivate") : t("agentsBtnActivate")}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {agents.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">{t("agentsNoAgents")}</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Section B — Workload */}
        <section className="space-y-3 pb-8">
          <h2 className="text-base font-semibold text-foreground">{t("agentsWorkloadOverview")}</h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {[t("agentsColAgentName"), t("agentsColActiveChats"), t("agentsColResolvedToday"), t("agentsColResolvedWeek"), t("agentsColTotalResolved"), t("agentsColMeetingsDone")].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {workload.map(row => (
                    <tr key={row.agent_id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground flex items-center gap-2">
                        {row.name}
                        {!row.is_active && <Badge color="bg-gray-100 text-gray-400">{t("agentsStatusInactive")}</Badge>}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-foreground">{row.active_chats}</td>
                      <td className="px-4 py-3 text-center text-foreground">{row.resolved_today}</td>
                      <td className="px-4 py-3 text-center text-foreground">{row.resolved_this_week}</td>
                      <td className="px-4 py-3 text-center text-foreground">{row.total_resolved}</td>
                      <td className="px-4 py-3 text-center text-foreground">{row.meetings_completed}</td>
                    </tr>
                  ))}
                  {workload.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">{t("agentsNoAgents")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      {/* New Agent Modal */}
      {showNewModal && (
        <Modal title={t("agentsModalNewTitle")} onClose={() => setShowNewModal(false)}>
          {createdPassword ? (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-green-800 mb-1">{t("agentsCreatedSuccess")}</p>
                <p className="text-xs text-green-700 mb-3">{t("agentsShareCredentials")}</p>
                <p className="text-xs text-green-900 font-mono bg-green-100 rounded-lg px-3 py-2 break-all">
                  {t("agentsPasswordLabel")} <strong>{createdPassword}</strong>
                </p>
              </div>
              <button onClick={() => setShowNewModal(false)} className="w-full py-2.5 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] transition-colors">
                {t("agentsBtnDone")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreateAgent} className="space-y-4">
              {[
                { label: t("agentsFormFullName"), key: "name", type: "text", placeholder: t("agentsFormNamePlaceholder") },
                { label: t("agentsFormEmail"), key: "email", type: "email", placeholder: t("agentsFormEmailPlaceholder") },
                { label: t("agentsFormPassword"), key: "password", type: "password", placeholder: t("agentsFormPasswordPlaceholder") },
              ].map(f => (
                <div key={f.key} className="space-y-1">
                  <label className="text-sm font-medium text-foreground">{f.label}</label>
                  <input
                    type={f.type}
                    placeholder={f.placeholder}
                    required
                    minLength={f.key === "password" ? 6 : 1}
                    value={(newAgent as any)[f.key]}
                    onChange={e => setNewAgent(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0F510F]"
                  />
                </div>
              ))}
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">{t("agentsFormRole")}</label>
                <select
                  value={newAgent.role}
                  onChange={e => setNewAgent(p => ({ ...p, role: e.target.value as "agent" | "admin" }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0F510F]"
                >
                  <option value="agent">{t("agentsRoleOptionAgent")}</option>
                  <option value="admin">{t("agentsRoleOptionAdmin")}</option>
                </select>
              </div>
              {newError && <p className="text-sm text-destructive">{newError}</p>}
              <button type="submit" disabled={newSaving} className="w-full py-2.5 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] disabled:opacity-60 transition-colors">
                {newSaving ? t("creating") : t("agentsBtnCreate")}
              </button>
            </form>
          )}
        </Modal>
      )}

      {/* Edit Agent Modal */}
      {editAgent && (
        <Modal title={t("agentsModalEditTitle")} onClose={() => setEditAgent(null)}>
          <form onSubmit={handleEditSave} className="space-y-4">
            {[
              { label: t("agentsFormFullName"), key: "name", type: "text" },
              { label: t("agentsFormEmail"), key: "email", type: "email" },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <label className="text-sm font-medium text-foreground">{f.label}</label>
                <input
                  type={f.type} required
                  value={(editForm as any)[f.key]}
                  onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0F510F]"
                />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{t("agentsFormRole")}</label>
              <select
                value={editForm.role}
                onChange={e => setEditForm(p => ({ ...p, role: e.target.value as "agent" | "admin" }))}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0F510F]"
              >
                <option value="agent">{t("agentsRoleOptionAgent")}</option>
                <option value="admin">{t("agentsRoleOptionAdmin")}</option>
              </select>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <button type="submit" disabled={editSaving} className="w-full py-2.5 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] disabled:opacity-60 transition-colors">
              {editSaving ? t("saving") : t("agentsBtnSave")}
            </button>
          </form>
        </Modal>
      )}

      {/* Reset Password Modal */}
      {resetAgent && (
        <Modal title={`${t("agentsModalResetTitle")} — ${resetAgent.name}`} onClose={() => setResetAgent(null)}>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{t("agentsFormNewPassword")}</label>
              <input
                type="password" required minLength={6}
                placeholder={t("agentsFormPasswordPlaceholder")}
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0F510F]"
                autoFocus
              />
            </div>
            {resetError && <p className="text-sm text-destructive">{resetError}</p>}
            <button type="submit" disabled={resetSaving} className="w-full py-2.5 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] disabled:opacity-60 transition-colors">
              {resetSaving ? t("saving") : t("agentsBtnSetPassword")}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
