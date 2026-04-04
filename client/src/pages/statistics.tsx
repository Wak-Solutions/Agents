import { useState, useEffect, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { Users, RefreshCw, Sparkles, AlertCircle, ClipboardList } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { useStatistics, useAiSummary } from "@/hooks/use-statistics";
import { useLanguage } from "@/lib/language-context";
import DashboardLayout from "@/components/DashboardLayout";

// ── Date range helpers ──────────────────────────────────────────────────────

type Preset = "today" | "week" | "month" | "custom";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  x.setDate(x.getDate() - ((day + 6) % 7)); // back to Monday
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

function rangeFromPreset(preset: Preset, customFrom: string, customTo: string): [Date, Date] {
  const now = new Date();
  if (preset === "today") return [startOfDay(now), endOfDay(now)];
  if (preset === "week") return [startOfWeek(now), endOfDay(now)];
  if (preset === "month") return [startOfMonth(now), endOfDay(now)];
  // custom
  const from = customFrom ? new Date(customFrom + "T00:00:00") : startOfDay(now);
  const to = customTo ? new Date(customTo + "T23:59:59") : endOfDay(now);
  return [from, to];
}

// Fill in zeros for days missing in the perDay array
function fillDays(perDay: { date: string; count: number }[], from: Date, to: Date) {
  const map = new Map(perDay.map(d => [d.date, d.count]));
  const result: { date: string; count: number; label: string }[] = [];
  const cur = startOfDay(new Date(from));
  const end = startOfDay(new Date(to));
  while (cur <= end) {
    const key = toDateInput(cur);
    result.push({
      date: key,
      count: map.get(key) ?? 0,
      label: cur.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    });
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function Statistics() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { t } = useLanguage();

  const [preset, setPreset] = useState<Preset>("week");
  const [customFrom, setCustomFrom] = useState(toDateInput(new Date()));
  const [customTo, setCustomTo] = useState(toDateInput(new Date()));

  const [from, to] = useMemo(
    () => rangeFromPreset(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  );

  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  const { data: stats, isLoading: isStatsLoading } = useStatistics(fromISO, toISO);
  const { mutate: generateSummary, data: summaryData, isPending: isSummaryLoading, error: summaryError, reset: resetSummary } = useAiSummary();

  const [surveyOverview, setSurveyOverview] = useState<{
    survey_id: number | null;
    title?: string;
    weekly_sent?: number;
    weekly_submitted?: number;
    avg_rating_this_week?: number | null;
  } | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/api/surveys/active-summary", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setSurveyOverview(d))
      .catch(() => {});
  }, [isAuthenticated]);

  // Auto-generate summary when date range changes (only if a summary was already shown)
  const hasSummary = !!summaryData;
  useEffect(() => {
    if (hasSummary) {
      resetSummary();
    }
    // intentionally only reset — user must click Generate to start fresh
  }, [fromISO, toISO]);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthLoading, isAuthenticated, setLocation]);

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
      </div>
    );
  }

  const chartData = stats ? fillDays(stats.perDay, from, to) : [];
  const showBarChart = chartData.length <= 60; // avoid cramped charts for very long ranges

  const presets: { key: Preset; label: string }[] = [
    { key: "today",  label: t("periodToday") },
    { key: "week",   label: t("periodThisWeek") },
    { key: "month",  label: t("periodThisMonth") },
    { key: "custom", label: t("periodCustom") },
  ];

  return (
    <DashboardLayout>
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          <h1 className="text-2xl font-bold text-gray-900">{t("statisticsTitle")}</h1>

          {/* ── Date Range Filter ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {presets.map(p => (
                <button
                  key={p.key}
                  onClick={() => setPreset(p.key)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    preset === p.key
                      ? "bg-[#0F510F] text-white"
                      : "bg-gray-100 text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {preset === "custom" && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 whitespace-nowrap">{t("statisticsFrom")}</label>
                  <input
                    type="date"
                    value={customFrom}
                    max={customTo}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="border border-gray-200 rounded-md px-2 py-1 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0F510F]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 whitespace-nowrap">{t("statisticsTo")}</label>
                  <input
                    type="date"
                    value={customTo}
                    min={customFrom}
                    max={toDateInput(new Date())}
                    onChange={e => setCustomTo(e.target.value)}
                    className="border border-gray-200 rounded-md px-2 py-1 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0F510F]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Section 1: Customers Contacted ── */}
          <section className="space-y-4">
            <h2 className="text-base font-semibold text-gray-900">{t("statisticsCustomersContacted")}</h2>

            {/* Total count card */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-[#0F510F]/10 flex items-center justify-center flex-shrink-0">
                <Users className="w-6 h-6 text-[#0F510F]" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">{t("statisticsUniqueCustomers")}</p>
                {isStatsLoading ? (
                  <div className="h-8 w-16 bg-gray-100 rounded animate-pulse mt-1" />
                ) : (
                  <p className="text-3xl font-bold text-gray-900">{stats?.totalCustomers ?? 0}</p>
                )}
              </div>
            </div>

            {/* Bar chart */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs text-gray-500 mb-4">{t("statisticsPerDay")}</p>
              {isStatsLoading ? (
                <div className="h-48 flex items-center justify-center">
                  <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
                </div>
              ) : chartData.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-sm text-gray-500">
                  {t("statisticsNoData")}
                </div>
              ) : showBarChart ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      axisLine={false}
                      tickLine={false}
                      interval={chartData.length > 14 ? "preserveStartEnd" : 0}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "#111827", fontWeight: 600 }}
                      itemStyle={{ color: "#0F510F" }}
                      formatter={(v: any) => [v, t("statisticsCustomersTooltip")]}
                    />
                    <Bar dataKey="count" fill="#0F510F" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-sm text-gray-500">
                  {t("statisticsRangeTooLarge")}
                </div>
              )}
            </div>
          </section>

          {/* ── Section 2: AI Summary ── */}
          <section className="space-y-4 pb-8">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">{t("statisticsAiSummary")}</h2>
              <button
                onClick={() => generateSummary({ from: fromISO, to: toISO })}
                disabled={isSummaryLoading}
                className="flex items-center gap-1.5 text-xs font-medium bg-[#0F510F] text-white px-3 py-1.5 rounded-lg hover:bg-[#0d4510] disabled:opacity-60 transition-colors"
              >
                {isSummaryLoading ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t("statisticsGenerating")}
                  </>
                ) : (
                  <>
                    {hasSummary ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                    {hasSummary ? t("statisticsRegenerate") : t("statisticsGenerate")}
                  </>
                )}
              </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 min-h-[120px] flex flex-col justify-center">
              {isSummaryLoading ? (
                <div className="space-y-2">
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-full" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-5/6" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-4/6" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-5/6 mt-2" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-3/6" />
                </div>
              ) : summaryError ? (
                <div className="flex items-start gap-2 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{summaryError.message}</span>
                </div>
              ) : summaryData ? (
                <p className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">
                  {summaryData.summary}
                </p>
              ) : (
                <p className="text-sm text-gray-500 text-center">
                  {t("statisticsClickToGenerate")}
                </p>
              )}
            </div>
          </section>

          {/* ── Section 3: Survey Overview ── */}
          <section className="space-y-4 pb-8">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-[#0F510F]" />
              <h2 className="text-base font-semibold text-gray-900">{t("statisticsSurveyOverview")}</h2>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              {surveyOverview === null ? (
                <div className="h-16 flex items-center justify-center">
                  <div className="w-5 h-5 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">{t("statisticsActiveSurvey")}</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {surveyOverview.survey_id ? surveyOverview.title : t("statisticsNoActiveSurvey")}
                      </p>
                    </div>
                    {surveyOverview.survey_id && (
                      <Link href="/surveys">
                        <a className="text-xs text-[#0F510F] hover:underline font-medium">{t("statisticsViewResults")}</a>
                      </Link>
                    )}
                  </div>

                  {surveyOverview.survey_id && (
                    <div className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-200">
                      <div className="text-center">
                        <p className="text-xl font-bold text-gray-900">{surveyOverview.weekly_sent ?? 0}</p>
                        <p className="text-xs text-gray-500">{t("statisticsSentThisWeek")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-gray-900">{surveyOverview.weekly_submitted ?? 0}</p>
                        <p className="text-xs text-gray-500">{t("statisticsSubmitted")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-gray-900">
                          {surveyOverview.avg_rating_this_week != null
                            ? `${surveyOverview.avg_rating_this_week} / 5`
                            : "—"}
                        </p>
                        <p className="text-xs text-gray-500">{t("statisticsAvgRating")}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
