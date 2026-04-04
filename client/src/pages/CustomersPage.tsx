import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import {
  Search, MessageSquare, Bot, HeadphonesIcon,
  AlertTriangle, Calendar, CheckCircle2, ClipboardList,
  ClipboardCheck, Package, ChevronLeft, ChevronRight, X,
  Users2, BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { format, formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import DashboardLayout from "@/components/DashboardLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomerRow {
  phone: string;
  name: string | null;
  source: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  touchpoints: number;
}

interface TimelineEvent {
  type:
    | "first_contact" | "bot_message" | "agent_message"
    | "escalation" | "meeting_booked" | "meeting_completed"
    | "survey_sent" | "survey_submitted" | "order";
  timestamp: string;
  summary: string;
  meta: Record<string, any>;
}

interface JourneyData {
  customer: { phone: string; name: string | null; source: string | null; firstSeen: string | null };
  timeline: TimelineEvent[];
}

interface FunnelStage { stage: string; count: number; }

// ── Event config (icon + colours) ────────────────────────────────────────────

const EVENT_CONFIG: Record<
  TimelineEvent["type"],
  { icon: React.ReactNode; bg: string; text: string; border: string }
> = {
  first_contact:      { icon: <MessageSquare className="w-3.5 h-3.5" />, bg: "bg-blue-100",   text: "text-blue-600",   border: "border-blue-200"   },
  bot_message:        { icon: <Bot            className="w-3.5 h-3.5" />, bg: "bg-gray-100",   text: "text-gray-500",   border: "border-gray-200"   },
  agent_message:      { icon: <HeadphonesIcon className="w-3.5 h-3.5" />, bg: "bg-purple-100", text: "text-purple-600", border: "border-purple-200" },
  escalation:         { icon: <AlertTriangle  className="w-3.5 h-3.5" />, bg: "bg-orange-100", text: "text-orange-600", border: "border-orange-200" },
  meeting_booked:     { icon: <Calendar       className="w-3.5 h-3.5" />, bg: "bg-teal-100",   text: "text-teal-600",   border: "border-teal-200"   },
  meeting_completed:  { icon: <CheckCircle2   className="w-3.5 h-3.5" />, bg: "bg-green-100",  text: "text-green-600",  border: "border-green-200"  },
  survey_sent:        { icon: <ClipboardList  className="w-3.5 h-3.5" />, bg: "bg-yellow-100", text: "text-yellow-600", border: "border-yellow-200" },
  survey_submitted:   { icon: <ClipboardCheck className="w-3.5 h-3.5" />, bg: "bg-green-100",  text: "text-green-600",  border: "border-green-200"  },
  order:              { icon: <Package        className="w-3.5 h-3.5" />, bg: "bg-indigo-100", text: "text-indigo-600", border: "border-indigo-200" },
};

// Funnel bar colours: green → yellow → orange → red (top → bottom of funnel)
const FUNNEL_COLORS = ["#16a34a", "#65a30d", "#d97706", "#ea580c", "#dc2626"];

// ── Sub-components ────────────────────────────────────────────────────────────

function TimelineRow({ event }: { event: TimelineEvent }) {
  const cfg = EVENT_CONFIG[event.type];
  return (
    <div className="flex gap-3 items-start">
      {/* Icon */}
      <div className={`mt-0.5 w-7 h-7 rounded-full ${cfg.bg} ${cfg.text} flex items-center justify-center flex-shrink-0`}>
        {cfg.icon}
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0 pb-4 border-b border-gray-200/40 last:border-0 last:pb-0">
        <p className="text-sm font-medium text-gray-900 leading-snug">{event.summary}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {format(new Date(event.timestamp), "MMM d, yyyy · h:mm a")}
        </p>
      </div>
    </div>
  );
}

function JourneyPanel({
  phone,
  onClose,
}: {
  phone: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [data, setData] = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/customers/${encodeURIComponent(phone)}/journey`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [phone]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-white shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="h-14 bg-[#0F510F] text-white flex items-center gap-3 px-4 flex-shrink-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">
              {data?.customer?.name || phone}
            </p>
            {data?.customer?.name && (
              <p className="text-xs text-white/60 font-mono truncate">{phone}</p>
            )}
          </div>
          {data?.customer?.firstSeen && (
            <p className="text-xs text-white/60 flex-shrink-0 hidden sm:block">
              {t("journeyFirstSeen")}: {format(new Date(data.customer.firstSeen), "MMM d, yyyy")}
            </p>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center pt-16">
              <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
            </div>
          ) : !data || data.timeline.length === 0 ? (
            <p className="text-sm text-gray-500 text-center pt-12">{t("journeyNoEvents")}</p>
          ) : (
            <div className="space-y-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
                {data.timeline.length} events
              </p>
              {data.timeline.map((evt, i) => (
                <TimelineRow key={i} event={evt} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function FunnelTab() {
  const { t } = useLanguage();
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/customers/funnel", { credentials: "include" })
      .then(r => r.ok ? r.json() : { stages: [] })
      .then(d => { setStages(d.stages); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center pt-20">
        <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
      </div>
    );
  }

  // Annotate with drop-off %
  const annotated = stages.map((s, i) => {
    const prev = i === 0 ? null : stages[i - 1].count;
    const dropOff = prev && prev > 0 ? Math.round((1 - s.count / prev) * 100) : null;
    return { ...s, dropOff };
  });

  const max = Math.max(...stages.map(s => s.count), 1);

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-gray-900">{t("funnelTitle")}</h2>

      {/* Recharts bar chart */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={annotated}
            layout="vertical"
            margin={{ top: 0, right: 60, bottom: 0, left: 0 }}
          >
            <XAxis type="number" domain={[0, max]} hide />
            <YAxis
              type="category"
              dataKey="stage"
              width={140}
              tick={{ fontSize: 12, fill: "#6b7280" }}
            />
            <Tooltip
              formatter={(value: number) => [`${value} ${t("funnelCustomers")}`, ""]}
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
            />
            <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={36}>
              {annotated.map((_, i) => (
                <Cell key={i} fill={FUNNEL_COLORS[Math.min(i, FUNNEL_COLORS.length - 1)]} />
              ))}
              <LabelList
                dataKey="count"
                position="right"
                style={{ fontSize: 12, fontWeight: 600, fill: "#374151" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Stage table with drop-off */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Stage</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Customers</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("funnelDropOff")}</th>
              <th className="px-4 py-3 w-40"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {annotated.map((s, i) => (
              <tr key={s.stage} className="hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-gray-900">{s.stage}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">{s.count}</td>
                <td className="px-4 py-3 text-right">
                  {s.dropOff !== null ? (
                    <span className={`text-sm font-medium ${s.dropOff >= 50 ? "text-red-500" : s.dropOff >= 25 ? "text-orange-500" : "text-gray-500"}`}>
                      −{s.dropOff}%
                    </span>
                  ) : <span className="text-gray-500">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${(s.count / max) * 100}%`,
                        backgroundColor: FUNNEL_COLORS[Math.min(i, FUNNEL_COLORS.length - 1)],
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin } = useAuth();
  const { t } = useLanguage();

  const [tab, setTab] = useState<"list" | "funnel">("list");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // All hooks before early returns
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
    if (!isAuthLoading && isAuthenticated && !isAdmin) setLocation("/dashboard");
  }, [isAuthLoading, isAuthenticated, isAdmin, setLocation]);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/customers?${params}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.customers);
        setTotal(data.total);
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [page, debouncedSearch]);

  useEffect(() => {
    if (isAuthenticated && isAdmin) fetchCustomers();
  }, [isAuthenticated, isAdmin, fetchCustomers]);

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
      </div>
    );
  }

  const totalPages = Math.ceil(total / 20);

  return (
    <DashboardLayout>
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">
          {/* Page header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("customersTitle")}</h1>
            <p className="text-sm text-gray-500 mt-1">{total} {t("customersTotal")}</p>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {(["list", "funnel"] as const).map(key => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  tab === key
                    ? "bg-white shadow-sm text-gray-900"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {key === "list" ? <Users2 className="w-3.5 h-3.5" /> : <BarChart3 className="w-3.5 h-3.5" />}
                {key === "list" ? t("customersTabList") : t("customersTabFunnel")}
              </button>
            ))}
          </div>

          {tab === "funnel" ? (
            <FunnelTab />
          ) : (
            <>
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder={t("customersSearch")}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-[#0F510F] transition-colors"
                />
              </div>

              {/* Table */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50/50">
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("customersColName")}</th>
                          <th className="hidden md:table-cell text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("customersColFirstSeen")}</th>
                          <th className="hidden sm:table-cell text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("customersColLastSeen")}</th>
                          <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("customersTouchpoints")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {customers.map(c => (
                          <tr
                            key={c.phone}
                            onClick={() => setSelectedPhone(c.phone)}
                            className="hover:bg-gray-50/50 cursor-pointer transition-colors"
                          >
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-900">
                                {c.name || <span className="text-gray-500 italic text-xs">{t("customersUnknown")}</span>}
                              </p>
                              <p className="text-xs text-gray-500 font-mono">{c.phone}</p>
                            </td>
                            <td className="hidden md:table-cell px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                              {c.firstSeen ? format(new Date(c.firstSeen), "MMM d, yyyy") : "—"}
                            </td>
                            <td className="hidden sm:table-cell px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                              {c.lastSeen
                                ? formatDistanceToNow(new Date(c.lastSeen), { addSuffix: true })
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="inline-flex items-center justify-center w-8 h-6 rounded-full bg-[#0F510F]/10 text-[#0F510F] text-xs font-semibold">
                                {c.touchpoints}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {customers.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-4 py-12 text-center text-gray-500 text-sm">
                              {t("customersNoResults")}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-gray-500">
                    Page {page} of {totalPages}
                  </p>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Journey side panel */}
      {selectedPhone && (
        <JourneyPanel
          phone={selectedPhone}
          onClose={() => setSelectedPhone(null)}
        />
      )}
    </DashboardLayout>
  );
}
