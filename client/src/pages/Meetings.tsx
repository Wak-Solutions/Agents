import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Video, ExternalLink, CheckCircle2, Clock, Filter, CalendarDays, ChevronLeft, ChevronRight, Ban } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

type MeetingStatus = "pending" | "completed";
type FilterType = "all" | "upcoming" | "completed";

interface Meeting {
  id: number;
  customer_phone: string;
  agent: string | null;
  meeting_link: string;
  meeting_token: string | null;
  agreed_time: string | null;
  scheduled_at: string | null;
  status: MeetingStatus;
  created_at: string;
}

function formatScheduledAt(iso: string): string {
  const d = new Date(iso);
  // Convert UTC to KSA (UTC+3) for display
  const ksa = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const hh = String(ksa.getUTCHours()).padStart(2, "0");
  const mm = String(ksa.getUTCMinutes()).padStart(2, "0");
  return `${days[ksa.getUTCDay()]} ${ksa.getUTCDate()} ${months[ksa.getUTCMonth()]} ${ksa.getUTCFullYear()} · ${hh}:${mm} AST`;
}

// ── Availability helpers ──────────────────────────────────────────────────────

const SLOT_HOURS = ["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"];
const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function getMondayOf(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  x.setDate(x.getDate() - ((day + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Meetings() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const [filter, setFilter] = useState<FilterType>("all");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Availability state
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOf(new Date()));
  const [blockedSlots, setBlockedSlots] = useState<Set<string>>(new Set());
  const [bookedSlots, setBookedSlots] = useState<Set<string>>(new Set());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [togglingSlot, setTogglingSlot] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthLoading, isAuthenticated, setLocation]);

  // Fetch blocked and booked slots for current week
  const fetchSlots = useCallback(async () => {
    setLoadingSlots(true);
    try {
      const ws = toDateStr(weekStart);
      const [blockedRes, bookedRes] = await Promise.all([
        fetch(`/api/availability?weekStart=${ws}`, { credentials: "include" }),
        fetch(`/api/availability/booked?weekStart=${ws}`, { credentials: "include" }),
      ]);
      if (blockedRes.ok) {
        const rows: { date: string; time: string }[] = await blockedRes.json();
        setBlockedSlots(new Set(rows.map(r => `${r.date}|${r.time}`)));
      }
      if (bookedRes.ok) {
        const rows: { date: string; time: string }[] = await bookedRes.json();
        setBookedSlots(new Set(rows.map(r => `${r.date}|${r.time}`)));
      }
    } catch (_) {} finally {
      setLoadingSlots(false);
    }
  }, [weekStart]);

  useEffect(() => {
    if (isAuthenticated) fetchSlots();
  }, [isAuthenticated, fetchSlots]);

  const toggleSlot = async (date: string, time: string) => {
    const key = `${date}|${time}`;
    setTogglingSlot(key);
    // optimistic update
    setBlockedSlots(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    try {
      await fetch('/api/availability/toggle', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time }),
      });
    } catch (_) {
      // revert on failure
      setBlockedSlots(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
    } finally {
      setTogglingSlot(null);
    }
  };

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings?filter=${filter}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load meetings");
      setMeetings(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (isAuthenticated) fetchMeetings();
  }, [isAuthenticated, fetchMeetings]);

  const markComplete = async (id: number) => {
    if (!window.confirm("Mark this meeting as done and send the customer a survey?")) return;
    setCompleting(id);
    try {
      const res = await fetch(`/api/meetings/${id}/complete`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update meeting");
      setMeetings((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: "completed" } : m))
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCompleting(null);
    }
  };

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "upcoming", label: "Upcoming" },
    { key: "completed", label: "Completed" },
  ];

  // Build the 7 dates for the current week
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekLabel = `${weekDates[0].toLocaleDateString("en-GB",{day:"numeric",month:"short"})} – ${weekDates[6].toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}`;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header — matches dashboard exactly */}
      <header className="h-14 bg-[#0F510F] text-white flex items-center justify-between px-5 flex-shrink-0 z-20 shadow-md">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="WAK Solutions" className="h-[36px] shrink-0" />
          <div className="hidden sm:block">
            <span className="font-semibold text-sm text-white/90">WAK Solutions</span>
            <span className="text-white/40 mx-2">—</span>
            <span className="text-sm text-white/70">Meetings</span>
          </div>
        </div>
        <Link href="/">
          <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Back to Inbox</span>
            <span className="sm:hidden">Back</span>
          </a>
        </Link>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-2">
          <Video className="w-5 h-5 text-[#0F510F]" />
          <h1 className="text-xl font-bold text-foreground">Meetings</h1>
        </div>

        {/* Filter bar */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground" />
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === f.key
                    ? "bg-[#0F510F] text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
            </div>
          ) : meetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Video className="w-10 h-10 opacity-30" />
              <p className="text-sm">No meetings found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Customer
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Meeting Link
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Scheduled (AST)
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Agent
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Status
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {meetings.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        {m.customer_phone}
                      </td>
                      <td className="px-4 py-3">
                        {m.meeting_token && m.meeting_link ? (
                          <a
                            href={`/meeting/${m.meeting_token}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[#0F510F] hover:underline font-mono text-xs"
                          >
                            {`/meeting/${m.meeting_token.slice(0, 8)}…`}
                            <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs italic">Pending booking</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground text-xs whitespace-nowrap">
                        {m.scheduled_at ? (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            {formatScheduledAt(m.scheduled_at)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">Not booked yet</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {m.agent ?? <span className="italic">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            m.status === "completed"
                              ? "bg-[#0F510F]/10 text-[#0F510F]"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {m.status === "completed" ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <Clock className="w-3 h-3" />
                          )}
                          {m.status === "completed" ? "Completed" : "Pending"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {m.status === "pending" && (
                          <button
                            onClick={() => markComplete(m.id)}
                            disabled={completing === m.id}
                            className="flex items-center gap-1 text-xs font-medium text-[#0F510F] border border-[#0F510F]/30 px-3 py-1 rounded-lg hover:bg-[#0F510F]/5 disabled:opacity-50 transition-colors whitespace-nowrap"
                          >
                            {completing === m.id ? (
                              <div className="w-3 h-3 border-2 border-[#0F510F]/30 border-t-[#0F510F] rounded-full animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            Mark Complete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {/* ── Availability Section ── */}
        <section className="space-y-4 pb-8">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-[#0F510F]" />
            <h2 className="text-base font-semibold text-foreground">Manage Availability</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Click a slot to block or unblock it. Blocked slots (red) cannot be booked by customers. Booked slots (blue) are already taken by a customer. All times are KSA (UTC+3).
          </p>

          {/* Week navigation */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setWeekStart(w => addDays(w, -7))}
              className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-foreground min-w-[200px] text-center">{weekLabel}</span>
            <button
              onClick={() => setWeekStart(w => addDays(w, 7))}
              className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Grid */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {loadingSlots ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium w-16">Time</th>
                      {weekDates.map((d, i) => (
                        <th key={i} className="px-2 py-2 text-center text-muted-foreground font-medium min-w-[80px]">
                          <div>{DAY_LABELS[i]}</div>
                          <div className="font-normal">{d.toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {SLOT_HOURS.map(hour => (
                      <tr key={hour} className="divide-x divide-border">
                        <td className="px-3 py-2 text-muted-foreground font-mono whitespace-nowrap">{hour}</td>
                        {weekDates.map((d, di) => {
                          const dateStr = toDateStr(d);
                          const key = `${dateStr}|${hour}`;
                          const isBlocked = blockedSlots.has(key);
                          const isBooked = bookedSlots.has(key);
                          const isToggling = togglingSlot === key;
                          if (isBooked) {
                            return (
                              <td key={di} className="px-2 py-1 text-center">
                                <div
                                  title="This slot has been booked by a customer"
                                  className="w-full h-8 rounded-md text-xs font-medium flex items-center justify-center gap-1 bg-blue-100 text-blue-700 border border-blue-200 cursor-default"
                                >
                                  <span className="hidden sm:inline">Booked</span>
                                  <span className="sm:hidden">●</span>
                                </div>
                              </td>
                            );
                          }
                          return (
                            <td key={di} className="px-2 py-1 text-center">
                              <button
                                onClick={() => toggleSlot(dateStr, hour)}
                                disabled={isToggling}
                                title={isBlocked ? "Click to unblock" : "Click to block"}
                                className={`w-full h-8 rounded-md text-xs font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1 ${
                                  isBlocked
                                    ? "bg-red-100 text-red-700 hover:bg-red-200 border border-red-200"
                                    : "bg-[#0F510F]/10 text-[#0F510F] hover:bg-[#0F510F]/20 border border-[#0F510F]/20"
                                }`}
                              >
                                {isToggling ? (
                                  <div className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                                ) : isBlocked ? (
                                  <><Ban className="w-3 h-3" /><span className="hidden sm:inline">Blocked</span></>
                                ) : (
                                  <span className="hidden sm:inline">Open</span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
