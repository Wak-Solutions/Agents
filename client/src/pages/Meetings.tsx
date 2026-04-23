import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Video, ChevronLeft, ChevronRight, Ban, Clock, MessageCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import DashboardLayout from "@/components/DashboardLayout";

type MeetingStatus = "pending" | "in_progress" | "completed";
type FilterType = "all" | "upcoming" | "completed";

interface Meeting {
  id: number;
  customer_phone: string;
  agent_id: number | null;
  agent_name: string | null;
  meeting_link: string;
  meeting_token: string | null;
  agreed_time: string | null;
  scheduled_at: string | null;
  status: MeetingStatus;
  created_at: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const ksa = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[ksa.getUTCDay()]} ${ksa.getUTCDate()} ${months[ksa.getUTCMonth()]} ${ksa.getUTCFullYear()}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const ksa = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const hh = String(ksa.getUTCHours()).padStart(2, "0");
  const mm = String(ksa.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} AST`;
}

const SLOT_HOURS = ["07:00","08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00","21:00","22:00","23:00","00:00"];
const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ── Work hours types + constants ──────────────────────────────────────────────

interface WorkHours {
  days: string[];
  start: string;
  end: string;
  timezone: string;
}

const ALL_WEEK_DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const DEFAULT_WORK_HOURS: WorkHours = {
  days: ["Sun","Mon","Tue","Wed","Thu"],
  start: "09:00",
  end: "18:00",
  timezone: "Asia/Riyadh",
};

// Generate time options in 30-minute increments from 00:00 to 23:30
const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2,"0")}:00`);
  TIME_OPTIONS.push(`${String(h).padStart(2,"0")}:30`);
}

const COMMON_TIMEZONES = [
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Kuwait",
  "Asia/Bahrain",
  "Asia/Qatar",
  "Africa/Cairo",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "UTC",
];

// ── WorkHoursPanel component ──────────────────────────────────────────────────

function WorkHoursPanel() {
  const { t } = useLanguage();
  const [wh, setWh] = useState<WorkHours>(DEFAULT_WORK_HOURS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle"|"saving"|"saved"|"error">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userEditedRef = useRef(false);
  const whRef = useRef(wh);
  whRef.current = wh;

  // Load on mount
  useEffect(() => {
    fetch("/api/settings/work-hours", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (data.days && data.start && data.end && data.timezone) setWh(data as WorkHours);
      })
      .catch(() => setLoadError(t("workHoursErrorLoad")));
  }, []);

  // Autosave 800ms after change
  const doSave = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/settings/work-hours", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(whRef.current),
      });
      if (!res.ok) throw new Error();
      setSaveStatus("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!userEditedRef.current) return;
    const t = setTimeout(doSave, 800);
    return () => clearTimeout(t);
  }, [wh, doSave]);

  const update = (patch: Partial<WorkHours>) => {
    userEditedRef.current = true;
    setWh(prev => ({ ...prev, ...patch }));
  };

  const toggleDay = (day: string) => {
    const next = wh.days.includes(day)
      ? wh.days.filter(d => d !== day)
      : [...wh.days, day];
    update({ days: next });
  };

  const inputCls = "border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0F510F]/40 transition-shadow";

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#0F510F]" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{t("workHoursTitle")}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{t("workHoursDesc")}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs min-w-[80px] justify-end">
          {saveStatus === "saving" && <><span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" /><span className="text-gray-400">{t("workHoursSaving")}</span></>}
          {saveStatus === "saved"  && <><span className="w-1.5 h-1.5 rounded-full bg-[#0F510F] flex-shrink-0" /><span className="text-[#0F510F]">{t("workHoursSaved")}</span></>}
          {saveStatus === "error"  && <><span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" /><span className="text-red-500">{t("workHoursErrorSave")}</span></>}
        </div>
      </div>

      {loadError && (
        <p className="mx-5 mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</p>
      )}

      <div className="px-5 py-4 space-y-5">
        {/* Day pills */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">{t("workHoursDays")}</p>
          <div className="flex flex-wrap gap-2">
            {ALL_WEEK_DAYS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  wh.days.includes(day)
                    ? "bg-[#0F510F] text-white border-[#0F510F]"
                    : "bg-white text-gray-500 border-gray-200 hover:border-[#0F510F]/40"
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        {/* Time range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("workHoursStartTime")}</label>
            <select
              className={inputCls + " w-full"}
              value={wh.start}
              onChange={e => update({ start: e.target.value })}
            >
              {TIME_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("workHoursEndTime")}</label>
            <select
              className={inputCls + " w-full"}
              value={wh.end}
              onChange={e => update({ end: e.target.value })}
            >
              {TIME_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Timezone */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("workHoursTimezone")}</label>
          <select
            className={inputCls + " w-full"}
            value={wh.timezone}
            onChange={e => update({ timezone: e.target.value })}
          >
            {COMMON_TIMEZONES.map(tz => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function buildWhatsAppLink(phone: string, meetingLink: string): string {
  // Strip +, leading 00, dashes, spaces, and parentheses
  let cleaned = phone.trim().replace(/^\+/, "").replace(/^00/, "").replace(/[-\s()]/g, "");
  const message = `Hello! Here is your meeting link: ${meetingLink}`;
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

function getMondayOf(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() - ((day + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}

function toDateStr(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const statusBadge: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  in_progress: "border border-yellow-200 bg-yellow-50 text-yellow-700",
  pending: "border border-green-200 bg-green-50 text-green-700",
};

export default function Meetings() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { t } = useLanguage();

  const [filter, setFilter] = useState<FilterType>("all");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<number | null>(null);
  const [starting, setStarting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOf(new Date()));
  const [blockedSlots, setBlockedSlots] = useState<Set<string>>(new Set());
  const [bookedSlots, setBookedSlots] = useState<Set<string>>(new Set());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [togglingSlot, setTogglingSlot] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthLoading, isAuthenticated, setLocation]);

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
    } catch {} finally {
      setLoadingSlots(false);
    }
  }, [weekStart]);

  useEffect(() => {
    if (isAuthenticated) fetchSlots();
  }, [isAuthenticated, fetchSlots]);

  const toggleSlot = async (date: string, time: string) => {
    const key = `${date}|${time}`;
    setTogglingSlot(key);
    setBlockedSlots(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    try {
      await fetch("/api/availability/toggle", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time }),
      });
    } catch {
      setBlockedSlots(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    } finally {
      setTogglingSlot(null);
    }
  };

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings?filter=${filter}`, { credentials: "include" });
      if (!res.ok) throw new Error(t("meetingsErrorLoad"));
      setMeetings(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchMeetings();
    const interval = setInterval(fetchMeetings, 20000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchMeetings]);

  useEffect(() => {
    const hv = () => { if (document.visibilityState === "visible" && isAuthenticated) { fetchMeetings(); fetchSlots(); } };
    document.addEventListener("visibilitychange", hv);
    return () => document.removeEventListener("visibilitychange", hv);
  }, [fetchMeetings, fetchSlots, isAuthenticated]);

  const startMeeting = async (id: number, meetingLink: string) => {
    window.open(meetingLink, "_blank", "noopener,noreferrer");
    setStarting(id);
    try {
      const res = await fetch(`/api/meetings/${id}/start`, { method: "PATCH", credentials: "include" });
      if (!res.ok) throw new Error(t("meetingsErrorLoad"));
      const updated = await res.json();
      setMeetings(prev => prev.map(m => m.id === id ? { ...m, status: "in_progress", agent_name: updated.agent_name ?? m.agent_name } : m));
    } catch (e: any) { setError(e.message); } finally { setStarting(null); }
  };

  const markComplete = async (id: number) => {
    if (!window.confirm(t("meetingsBtnMarkCompleteConfirm"))) return;
    setCompleting(id);
    try {
      const res = await fetch(`/api/meetings/${id}/complete`, { method: "PATCH", credentials: "include" });
      if (!res.ok) throw new Error(t("meetingsErrorLoad"));
      setMeetings(prev => prev.map(m => m.id === id ? { ...m, status: "completed" } : m));
    } catch (e: any) { setError(e.message); } finally { setCompleting(null); }
  };

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: t("meetingsFilterAll") },
    { key: "upcoming", label: t("meetingsFilterUpcoming") },
    { key: "completed", label: t("meetingsFilterCompleted") },
  ];

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekLabel = `${weekDates[0].toLocaleDateString("en-GB",{day:"numeric",month:"short"})} – ${weekDates[6].toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}`;

  return (
    <DashboardLayout>
      <div className="h-full overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("meetingsTitle")}</h1>
            <p className="text-sm text-gray-500 mt-1">Upcoming and past meetings with customers</p>
          </div>
        </div>

        {/* Filters — pill-in-container */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-6">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                filter === f.key
                  ? "bg-white shadow-sm text-gray-900"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4">{error}</p>
        )}

        {/* Meetings table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-10">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
            </div>
          ) : meetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
              <Video className="w-10 h-10 opacity-30" />
              <p className="text-sm">{t("meetingsEmpty")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-start px-5 py-3.5 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("meetingsColCustomer")}</th>
                    <th className="text-start px-5 py-3.5 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("meetingsColDate")}</th>
                    <th className="text-start px-5 py-3.5 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("meetingsColMeetingTime")}</th>
                    <th className="text-start px-5 py-3.5 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("meetingsColStatus")}</th>
                    <th className="text-start px-5 py-3.5 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("meetingsColAgent")}</th>
                    <th className="px-5 py-3.5" />
                  </tr>
                </thead>
                <tbody>
                  {meetings.map(m => (
                    <tr key={m.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50 transition-colors">
                      {/* Customer */}
                      <td className="px-5 py-4">
                        <span className="font-medium text-gray-900 text-sm">{m.customer_phone}</span>
                      </td>

                      {/* Date */}
                      <td className="px-5 py-4 text-gray-600 text-sm whitespace-nowrap">
                        {m.scheduled_at ? formatDate(m.scheduled_at) : <span className="text-gray-400 italic">{t("meetingsNotBooked")}</span>}
                      </td>

                      {/* Time */}
                      <td className="px-5 py-4 text-gray-600 text-sm whitespace-nowrap">
                        {m.scheduled_at ? formatTime(m.scheduled_at) : <span className="text-gray-400 italic">—</span>}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full ${statusBadge[m.status] ?? statusBadge.pending}`}>
                          {m.status === "completed"
                            ? t("statusCompleted")
                            : m.status === "in_progress"
                            ? t("statusInProgress")
                            : t("statusScheduled")}
                        </span>
                      </td>

                      {/* Agent */}
                      <td className="px-5 py-4 text-gray-600 text-sm">
                        {m.agent_name ?? <span className="text-gray-400 italic">{t("meetingsUnassigned")}</span>}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {m.status === "pending" && (
                            <button
                              onClick={() => startMeeting(m.id, m.meeting_link)}
                              disabled={starting === m.id}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-gray-200 bg-white px-3.5 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                              <Video className="w-3.5 h-3.5" /> Join
                            </button>
                          )}
                          {m.status === "in_progress" && (
                            <button
                              onClick={() => markComplete(m.id)}
                              disabled={completing === m.id}
                              className="inline-flex items-center gap-1.5 text-xs font-medium bg-[#0F510F] text-white px-3.5 py-2 rounded-lg hover:bg-[#0d4510] disabled:opacity-50 transition-colors"
                            >
                              Complete
                            </button>
                          )}
                          {m.status !== "completed" && (
                            <a
                              href={buildWhatsAppLink(m.customer_phone, m.meeting_link)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#128C7E] border border-[#128C7E]/30 bg-[#128C7E]/5 px-3.5 py-2 rounded-lg hover:bg-[#128C7E]/10 transition-colors"
                            >
                              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Availability */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t("meetingsManageAvailability")}</h2>
              <p className="text-xs text-gray-500 mt-1.5">{t("meetingsAvailabilityHint")}</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setWeekStart(w => addDays(w, -7))} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium text-gray-700 min-w-[200px] text-center">{weekLabel}</span>
              <button onClick={() => setWeekStart(w => addDays(w, 7))} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loadingSlots ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="px-3 py-2 text-start text-gray-500 font-medium w-16">{t("meetingsColTime")}</th>
                      {weekDates.map((d, i) => (
                        <th key={i} className="px-2 py-2 text-center text-gray-500 font-medium min-w-[80px]">
                          <div>{DAY_LABELS[i]}</div>
                          <div className="font-normal">{d.toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SLOT_HOURS.map(hour => (
                      <tr key={hour} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-500 font-mono whitespace-nowrap">{hour}</td>
                        {weekDates.map((d, di) => {
                          const dateStr = toDateStr(d);
                          const key = `${dateStr}|${hour}`;
                          const isBlocked = blockedSlots.has(key);
                          const isBooked = bookedSlots.has(key);
                          const isToggling = togglingSlot === key;
                          if (isBooked) {
                            return (
                              <td key={di} className="px-2 py-1 text-center">
                                <div title={t("meetingsSlotBookedTitle")} className="w-full h-8 rounded-md text-xs font-medium flex items-center justify-center gap-1 bg-blue-100 text-blue-700 border border-blue-200 cursor-default">
                                  <span className="hidden sm:inline">{t("meetingsSlotBooked")}</span>
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
                                title={isBlocked ? t("meetingsSlotClickUnblock") : t("meetingsSlotClickBlock")}
                                className={`w-full h-8 rounded-md text-xs font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1 ${
                                  isBlocked
                                    ? "bg-red-100 text-red-700 hover:bg-red-200 border border-red-200"
                                    : "bg-[#0F510F]/10 text-[#0F510F] hover:bg-[#0F510F]/20 border border-[#0F510F]/20"
                                }`}
                              >
                                {isToggling ? (
                                  <div className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                                ) : isBlocked ? (
                                  <><Ban className="w-3 h-3" /><span className="hidden sm:inline">{t("meetingsSlotBlocked")}</span></>
                                ) : (
                                  <span className="hidden sm:inline">{t("meetingsSlotOpen")}</span>
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
        </div>
      </div>
      {/* Work Hours */}
      <div className="mb-10">
        <WorkHoursPanel />
      </div>
    </DashboardLayout>
  );
}
