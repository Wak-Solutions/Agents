import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Plus, UserCheck, UserX, KeyRound, Edit2, Users, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface Agent {
  id: number;
  name: string;
  email: string;
  role: "admin" | "agent";
  is_active: boolean;
  last_login: string | null;
  active_chat_count: number;
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

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, wRes] = await Promise.all([
        fetch("/api/agents", { credentials: "include" }),
        fetch("/api/agents/workload", { credentials: "include" }),
      ]);
      if (aRes.ok) setAgents(await aRes.json());
      if (wRes.ok) setWorkload(await wRes.json());
    } catch (_) {
      setError("Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      fetchAll();
      const interval = setInterval(fetchAll, 60000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, isAdmin, fetchAll]);

  const toggleActive = async (agent: Agent) => {
    const endpoint = agent.is_active ? "deactivate" : "activate";
    const res = await fetch(`/api/agents/${agent.id}/${endpoint}`, {
      method: "PATCH", credentials: "include",
    });
    if (res.ok) {
      fetchAll();
    } else {
      const b = await res.json().catch(() => ({}));
      setError(b.message || "Failed to update agent");
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
      if (!res.ok) { setNewError(body.message || "Failed to create agent"); return; }
      setCreatedPassword(newAgent.password);
      setNewAgent({ name: "", email: "", password: "", role: "agent" });
      fetchAll();
    } catch (_) {
      setNewError("Network error");
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
      if (!res.ok) { const b = await res.json(); setEditError(b.message || "Failed"); return; }
      setEditAgent(null);
      fetchAll();
    } catch (_) {
      setEditError("Network error");
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
      if (!res.ok) { const b = await res.json(); setResetError(b.message || "Failed"); return; }
      setResetAgent(null); setNewPw("");
    } catch (_) {
      setResetError("Network error");
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
          <span className="hidden sm:block text-sm text-white/70">Agents</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} title="Refresh" className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <Link href="/"><a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Dashboard</span>
          </a></Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 space-y-8">

        {/* Section A — Agent List */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-[#0F510F]" />
              <h1 className="text-xl font-bold text-foreground">Agents</h1>
            </div>
            <button
              onClick={() => { setCreatedPassword(null); setNewError(""); setShowNewModal(true); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Agent
            </button>
          </div>

          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</p>}

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
              </div>
            ) : (
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[30%]">Agent</th>
                    <th className="text-left px-2 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[18%]">Role / Status</th>
                    <th className="text-center px-1 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[10%]">Chats</th>
                    <th className="text-center px-1 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[12%]">Meetings</th>
                    <th className="text-center px-1 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[11%]">Rating</th>
                    <th className="hidden md:table-cell text-left px-2 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[14%]">Last Login</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
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
                            {agent.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </td>
                      {/* Active Chats */}
                      <td className="px-1 py-3 text-center font-semibold text-foreground">
                        {agent.active_chat_count}
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
                          : "Never"}
                      </td>
                      {/* Actions: labels on xl+, icons only on smaller */}
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setEditForm({ name: agent.name, email: agent.email, role: agent.role }); setEditAgent(agent); setEditError(""); }}
                            title="Edit"
                            className="flex items-center gap-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="hidden xl:inline text-xs">Edit</span>
                          </button>
                          <button
                            onClick={() => { setResetAgent(agent); setNewPw(""); setResetError(""); }}
                            title="Reset password"
                            className="flex items-center gap-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <KeyRound className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="hidden xl:inline text-xs">Reset</span>
                          </button>
                          <button
                            onClick={() => toggleActive(agent)}
                            title={agent.is_active ? "Deactivate" : "Activate"}
                            className={`flex items-center gap-1 p-1.5 rounded-lg transition-colors ${agent.is_active ? "text-red-500 hover:bg-red-50" : "text-green-600 hover:bg-green-50"}`}
                          >
                            {agent.is_active ? <UserX className="w-3.5 h-3.5 flex-shrink-0" /> : <UserCheck className="w-3.5 h-3.5 flex-shrink-0" />}
                            <span className="hidden xl:inline text-xs">{agent.is_active ? "Deactivate" : "Activate"}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {agents.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No agents yet</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Section B — Workload */}
        <section className="space-y-3 pb-8">
          <h2 className="text-base font-semibold text-foreground">Workload Overview</h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {["Agent", "Active Chats", "Resolved Today", "Resolved This Week", "Total Resolved", "Meetings Done"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {workload.map(row => (
                    <tr key={row.agent_id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground flex items-center gap-2">
                        {row.name}
                        {!row.is_active && <Badge color="bg-gray-100 text-gray-400">inactive</Badge>}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-foreground">{row.active_chats}</td>
                      <td className="px-4 py-3 text-center text-foreground">{row.resolved_today}</td>
                      <td className="px-4 py-3 text-center text-foreground">{row.resolved_this_week}</td>
                      <td className="px-4 py-3 text-center text-foreground">{row.total_resolved}</td>
                      <td className="px-4 py-3 text-center text-foreground">{row.meetings_completed}</td>
                    </tr>
                  ))}
                  {workload.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No agents yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      {/* New Agent Modal */}
      {showNewModal && (
        <Modal title="New Agent" onClose={() => setShowNewModal(false)}>
          {createdPassword ? (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-green-800 mb-1">Agent created successfully!</p>
                <p className="text-xs text-green-700 mb-3">Share these credentials with the agent:</p>
                <p className="text-xs text-green-900 font-mono bg-green-100 rounded-lg px-3 py-2 break-all">
                  Password: <strong>{createdPassword}</strong>
                </p>
              </div>
              <button onClick={() => setShowNewModal(false)} className="w-full py-2.5 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] transition-colors">
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreateAgent} className="space-y-4">
              {[
                { label: "Full Name", key: "name", type: "text", placeholder: "Jane Smith" },
                { label: "Email", key: "email", type: "email", placeholder: "jane@wak-solutions.com" },
                { label: "Password", key: "password", type: "password", placeholder: "Min. 6 characters" },
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
                <label className="text-sm font-medium text-foreground">Role</label>
                <select
                  value={newAgent.role}
                  onChange={e => setNewAgent(p => ({ ...p, role: e.target.value as "agent" | "admin" }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0F510F]"
                >
                  <option value="agent">Agent</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {newError && <p className="text-sm text-destructive">{newError}</p>}
              <button type="submit" disabled={newSaving} className="w-full py-2.5 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] disabled:opacity-60 transition-colors">
                {newSaving ? "Creating…" : "Create Agent"}
              </button>
            </form>
          )}
        </Modal>
      )}

      {/* Edit Agent Modal */}
      {editAgent && (
        <Modal title="Edit Agent" onClose={() => setEditAgent(null)}>
          <form onSubmit={handleEditSave} className="space-y-4">
            {[
              { label: "Full Name", key: "name", type: "text" },
              { label: "Email", key: "email", type: "email" },
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
              <label className="text-sm font-medium text-foreground">Role</label>
              <select
                value={editForm.role}
                onChange={e => setEditForm(p => ({ ...p, role: e.target.value as "agent" | "admin" }))}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0F510F]"
              >
                <option value="agent">Agent</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <button type="submit" disabled={editSaving} className="w-full py-2.5 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] disabled:opacity-60 transition-colors">
              {editSaving ? "Saving…" : "Save Changes"}
            </button>
          </form>
        </Modal>
      )}

      {/* Reset Password Modal */}
      {resetAgent && (
        <Modal title={`Reset Password — ${resetAgent.name}`} onClose={() => setResetAgent(null)}>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">New Password</label>
              <input
                type="password" required minLength={6}
                placeholder="Min. 6 characters"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0F510F]"
                autoFocus
              />
            </div>
            {resetError && <p className="text-sm text-destructive">{resetError}</p>}
            <button type="submit" disabled={resetSaving} className="w-full py-2.5 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] disabled:opacity-60 transition-colors">
              {resetSaving ? "Saving…" : "Set New Password"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
