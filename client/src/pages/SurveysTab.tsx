import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown,
  BarChart2, Edit2, CheckCircle2, XCircle, ClipboardList, AlertTriangle,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type QuestionType = "rating" | "yes_no" | "free_text";

interface Survey {
  id: number;
  title: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  question_count: number;
  response_count: number;
  submitted_count: number;
}

interface Question {
  id: number;
  question_text: string;
  question_type: QuestionType;
  order_index: number;
}

interface QuestionDraft {
  _key: string;
  id?: number;
  question_text: string;
  question_type: QuestionType;
  order_index: number;
}

interface SurveyDraft {
  id?: number;
  title: string;
  description: string;
  is_default: boolean;
  questions: QuestionDraft[];
}

interface ResultData {
  total_sent: number;
  total_submitted: number;
  response_rate: number;
  questions: any[];
  per_agent: { agent_id: number | null; agent_name: string; chats_handled: number; avg_rating: number | null }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _k = 0;
const newKey = () => `q_${++_k}`;

function blankQuestion(order_index: number): QuestionDraft {
  return { _key: newKey(), question_text: "", question_type: "rating", order_index };
}

function fromServer(q: Question): QuestionDraft {
  return { _key: newKey(), id: q.id, question_text: q.question_text, question_type: q.question_type, order_index: q.order_index };
}

type View = "list" | "editor" | "results";

// ── Component ─────────────────────────────────────────────────────────────────

export default function SurveysTab() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { t } = useLanguage();

  const [view, setView] = useState<View>("list");
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");

  // Editor
  const [draft, setDraft] = useState<SurveyDraft | null>(null);
  const [deletedQIds, setDeletedQIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Results
  const [resultSurveyId, setResultSurveyId] = useState<number | null>(null);
  const [resultSurveyTitle, setResultSurveyTitle] = useState("");
  const [results, setResults] = useState<ResultData | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthLoading, isAuthenticated, setLocation]);

  const fetchSurveys = useCallback(async () => {
    setLoading(true); setListError("");
    try {
      const res = await fetch("/api/surveys", { credentials: "include" });
      if (!res.ok) throw new Error(t("statisticsFailedLoad"));
      setSurveys(await res.json());
    } catch (e: any) {
      setListError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAuthenticated) fetchSurveys(); }, [isAuthenticated, fetchSurveys]);

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // ── List actions ─────────────────────────────────────────────────────────────

  const openNew = () => {
    setDraft({ title: "", description: "", is_default: false, questions: [] });
    setDeletedQIds([]); setSaveError("");
    setView("editor");
  };

  const openEdit = async (id: number) => {
    setSaveError(""); setDeletedQIds([]);
    try {
      const res = await fetch(`/api/surveys/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDraft({
        id: data.id, title: data.title, description: data.description ?? "",
        is_default: data.is_default,
        questions: (data.questions as Question[]).map(fromServer),
      });
      setView("editor");
    } catch {
      setListError(t("statisticsFailedLoad"));
    }
  };

  const openResults = async (id: number, title: string) => {
    setResultSurveyId(id); setResultSurveyTitle(title);
    setResultsLoading(true); setResults(null);
    setView("results");
    try {
      const res = await fetch(`/api/surveys/${id}/results`, { credentials: "include" });
      setResults(await res.json());
    } catch {
      setListError(t("statisticsFailedLoad"));
    } finally {
      setResultsLoading(false);
    }
  };

  const activate = async (id: number) => {
    await fetch(`/api/surveys/${id}/activate`, { method: "POST", credentials: "include" });
    fetchSurveys();
  };

  const deactivate = async (id: number) => {
    await fetch(`/api/surveys/${id}/deactivate`, { method: "POST", credentials: "include" });
    fetchSurveys();
  };

  const deleteSurvey = async (id: number, title: string) => {
    if (!confirm(`Delete "${title}"${t("surveysDeleteConfirmSuffix")}`)) return;
    const res = await fetch(`/api/surveys/${id}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.message || t("surveysDeleteFailed"));
      return;
    }
    fetchSurveys();
  };

  // ── Editor helpers ───────────────────────────────────────────────────────────

  const addQuestion = () => {
    if (!draft) return;
    setDraft({ ...draft, questions: [...draft.questions, blankQuestion(draft.questions.length)] });
  };

  const updateQ = (key: string, changes: Partial<QuestionDraft>) => {
    if (!draft) return;
    setDraft({ ...draft, questions: draft.questions.map((q) => q._key === key ? { ...q, ...changes } : q) });
  };

  const removeQ = (key: string) => {
    if (!draft) return;
    const q = draft.questions.find((q) => q._key === key);
    if (q?.id) setDeletedQIds((p) => [...p, q.id!]);
    setDraft({ ...draft, questions: draft.questions.filter((q) => q._key !== key).map((q, i) => ({ ...q, order_index: i })) });
  };

  const moveQ = (key: string, dir: -1 | 1) => {
    if (!draft) return;
    const idx = draft.questions.findIndex((q) => q._key === key);
    const ni = idx + dir;
    if (ni < 0 || ni >= draft.questions.length) return;
    const qs = [...draft.questions];
    [qs[idx], qs[ni]] = [qs[ni], qs[idx]];
    setDraft({ ...draft, questions: qs.map((q, i) => ({ ...q, order_index: i })) });
  };

  const saveDraft = async () => {
    if (!draft) return;
    setSaveError(""); setSaving(true);
    try {
      let surveyId = draft.id;
      if (!surveyId) {
        const res = await fetch("/api/surveys", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: draft.title, description: draft.description }),
        });
        if (!res.ok) throw new Error((await res.json()).message);
        surveyId = (await res.json()).id;
      } else {
        const res = await fetch(`/api/surveys/${surveyId}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: draft.title, description: draft.description }),
        });
        if (!res.ok) throw new Error((await res.json()).message);
      }
      for (const qid of deletedQIds) {
        await fetch(`/api/surveys/${surveyId}/questions/${qid}`, { method: "DELETE", credentials: "include" });
      }
      for (const q of draft.questions) {
        const body = { question_text: q.question_text, question_type: q.question_type, order_index: q.order_index };
        if (!q.id) {
          const res = await fetch(`/api/surveys/${surveyId}/questions`, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error((await res.json()).message);
        } else {
          await fetch(`/api/surveys/${surveyId}/questions/${q.id}`, {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        }
      }
      setView("list"); fetchSurveys();
    } catch (e: any) {
      setSaveError(e.message || t("surveysDeleteFailed"));
    } finally {
      setSaving(false);
    }
  };

  // ── Render: List ─────────────────────────────────────────────────────────────

  const renderList = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">{t("surveysTitle")}</h1>
        <button onClick={openNew} className="flex items-center gap-1.5 bg-[#0F510F] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#0d4510] transition-colors">
          <Plus className="w-4 h-4" /> {t("surveysNewSurvey")}
        </button>
      </div>

      {listError && <p className="text-sm text-destructive">{listError}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
        </div>
      ) : surveys.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t("surveysEmpty")}</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">{t("surveysColTitle")}</th>
                <th className="text-center px-3 py-3 text-muted-foreground font-medium">{t("surveysColQs")}</th>
                <th className="text-center px-3 py-3 text-muted-foreground font-medium">{t("surveysColSent")}</th>
                <th className="text-center px-3 py-3 text-muted-foreground font-medium">{t("surveysColSubmitted")}</th>
                <th className="text-center px-3 py-3 text-muted-foreground font-medium">{t("surveysColRate")}</th>
                <th className="text-center px-3 py-3 text-muted-foreground font-medium">{t("surveysColStatus")}</th>
                <th className="text-right px-4 py-3 text-muted-foreground font-medium">{t("surveysColActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {surveys.map((s) => {
                const rate = s.response_count > 0 ? Math.round((s.submitted_count / s.response_count) * 100) : 0;
                return (
                  <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">{s.title}</span>
                        {s.is_default && (
                          <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">{t("surveysStatusDefault")}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center text-muted-foreground">{s.question_count}</td>
                    <td className="px-3 py-3 text-center text-muted-foreground">{s.response_count}</td>
                    <td className="px-3 py-3 text-center text-muted-foreground">{s.submitted_count}</td>
                    <td className="px-3 py-3 text-center text-muted-foreground">{s.response_count > 0 ? `${rate}%` : "—"}</td>
                    <td className="px-3 py-3 text-center">
                      {s.is_active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> {t("surveysStatusActive")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("surveysStatusInactive")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(s.id)} title="Edit" className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => openResults(s.id, s.title)} title="Results" className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                          <BarChart2 className="w-3.5 h-3.5" />
                        </button>
                        {s.is_active ? (
                          <button onClick={() => deactivate(s.id)} title="Deactivate" className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button onClick={() => activate(s.id)} title="Activate" className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {s.is_default ? (
                          <span title={t("surveysDefaultCannotDelete")} className="p-1.5 rounded cursor-not-allowed opacity-30">
                            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                          </span>
                        ) : (
                          <button onClick={() => deleteSurvey(s.id, s.title)} title="Delete" className="p-1.5 rounded hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── Render: Editor ───────────────────────────────────────────────────────────

  const TYPE_LABELS: Record<QuestionType, string> = {
    rating:    t("surveysQuestionTypeRating"),
    yes_no:    t("surveysQuestionTypeYesNo"),
    free_text: t("surveysQuestionTypeFreeText"),
  };

  const renderEditor = () => {
    if (!draft) return null;
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => setView("list")} className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-xl font-bold text-foreground">{draft.id ? t("surveysEditSurvey") : t("surveysNewSurvey")}</h1>
        </div>

        {/* Default survey warning */}
        {draft.is_default && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{t("surveysDefaultWarning")}</span>
          </div>
        )}

        {/* Survey details */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("surveysFormTitle")}</label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={t("surveysFormTitlePlaceholder")}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#0F510F]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("surveysFormDescription")}</label>
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder={t("surveysFormDescPlaceholder")}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#0F510F] resize-none"
            />
          </div>
        </div>

        {/* Questions */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{t("surveysFormQuestions")} ({draft.questions.length})</h2>

          {draft.questions.length === 0 && (
            <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
              {t("surveysFormNoQuestions")}
            </div>
          )}

          {draft.questions.map((q, idx) => (
            <div key={q._key} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start gap-2">
                <span className="text-xs font-mono text-muted-foreground mt-2.5 w-5 flex-shrink-0 text-right">{idx + 1}.</span>
                <div className="flex-1 space-y-2">
                  <input
                    type="text"
                    value={q.question_text}
                    onChange={(e) => updateQ(q._key, { question_text: e.target.value })}
                    placeholder={t("surveysQuestionPlaceholder")}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#0F510F]"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">{t("surveysQuestionTypeLabel")}</span>
                    {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => updateQ(q._key, { question_type: t })}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          q.question_type === t
                            ? "bg-[#0F510F] text-white border-[#0F510F]"
                            : "border-border text-muted-foreground hover:border-[#0F510F]"
                        }`}
                      >
                        {TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => moveQ(q._key, -1)} disabled={idx === 0} className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-30 transition-colors">
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => moveQ(q._key, 1)} disabled={idx === draft.questions.length - 1} className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-30 transition-colors">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => removeQ(q._key)} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={addQuestion}
            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#0F510F]/30 text-[#0F510F] rounded-xl py-3 text-sm font-medium hover:border-[#0F510F]/60 hover:bg-[#0F510F]/5 transition-colors"
          >
            <Plus className="w-4 h-4" /> {t("surveysBtnAddQuestion")}
          </button>
        </div>

        {saveError && <p className="text-sm text-destructive">{saveError}</p>}

        <div className="flex gap-3 pb-8">
          <button onClick={() => setView("list")} className="px-5 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
            {t("surveysBtnCancel")}
          </button>
          <button
            onClick={saveDraft}
            disabled={saving || !draft.title.trim()}
            className="flex-1 bg-[#0F510F] text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-[#0d4510] disabled:opacity-60 transition-colors"
          >
            {saving ? t("saving") : t("surveysBtnSave")}
          </button>
        </div>
      </div>
    );
  };

  // ── Render: Results ──────────────────────────────────────────────────────────

  const renderResults = () => (
    <div className="space-y-5 pb-10">
      <div className="flex items-center gap-3">
        <button onClick={() => setView("list")} className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-xl font-bold text-foreground">
          {t("surveysResults")} {resultSurveyTitle}
        </h1>
      </div>

      {resultsLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
        </div>
      )}

      {results && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: t("surveysResultsTotalSent"), value: results.total_sent },
              { label: t("surveysResultsTotalSubmitted"), value: results.total_submitted },
              { label: t("surveysResultsResponseRate"), value: `${results.response_rate}%` },
            ].map((c) => (
              <div key={c.label} className="bg-card border border-border rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{c.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Per-question */}
          {results.questions.map((q: any, idx: number) => (
            <div key={q.question_id} className="bg-card border border-border rounded-xl p-5 space-y-3">
              <p className="text-sm font-semibold text-foreground">
                <span className="text-[#0F510F] mr-1">{idx + 1}.</span>
                {q.question_text}
              </p>

              {q.question_type === "rating" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {t("surveysResultsAverage")} <span className="text-foreground font-bold text-lg">{q.avg_score ?? "—"}</span>
                    <span className="text-muted-foreground"> / 5</span>
                  </p>
                  {[5, 4, 3, 2, 1].map((n) => {
                    const count = q.distribution?.[String(n)] ?? 0;
                    const total = Object.values(q.distribution ?? {}).reduce((a: any, b: any) => a + b, 0) as number;
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={n} className="flex items-center gap-2 text-xs">
                        <span className="w-3 text-right text-muted-foreground font-mono">{n}</span>
                        <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-[#0F510F] rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-12 text-muted-foreground text-right">{count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {q.question_type === "yes_no" && (() => {
                const yes = q.yes_count ?? 0;
                const no = q.no_count ?? 0;
                const total = yes + no;
                const yesPct = total > 0 ? Math.round((yes / total) * 100) : 0;
                const noPct  = total > 0 ? Math.round((no / total) * 100) : 0;
                return (
                  <div className="space-y-2">
                    {[
                      { label: "Yes / نعم", count: yes, pct: yesPct, color: "bg-[#0F510F]" },
                      { label: "No / لا",   count: no,  pct: noPct,  color: "bg-red-500" },
                    ].map((row) => (
                      <div key={row.label} className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span className="font-medium">{row.label}</span>
                          <span>{row.count} ({row.pct}%)</span>
                        </div>
                        <div className="h-4 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${row.color} rounded-full transition-all`} style={{ width: `${row.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {q.question_type === "free_text" && (
                <div className="max-h-52 overflow-y-auto space-y-2">
                  {(q.answers ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("surveysResultsNoResponses")}</p>
                  ) : (
                    (q.answers as string[]).map((a, i) => (
                      <p key={i} className="text-sm text-foreground bg-muted/40 rounded-lg px-3 py-2 leading-snug">"{a}"</p>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Per-agent */}
          {results.per_agent.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/40">
                <h3 className="text-sm font-semibold text-foreground">{t("surveysResultsAgentSatisfaction")}</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">{t("agentsColAgentName")}</th>
                    <th className="text-center px-4 py-2.5 text-muted-foreground font-medium">{t("surveysResultsChatsHandled")}</th>
                    <th className="text-center px-4 py-2.5 text-muted-foreground font-medium">{t("surveysResultsAvgRating")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {results.per_agent.map((row, i) => (
                    <tr key={i}>
                      <td className="px-5 py-3 text-foreground">{row.agent_name}</td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{row.chats_handled}</td>
                      <td className="px-4 py-3 text-center font-semibold text-foreground">
                        {row.avg_rating != null ? `${row.avg_rating} / 5` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="h-14 bg-[#0F510F] text-white flex items-center justify-between px-5 flex-shrink-0 z-20 shadow-md">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="WAK Solutions" className="h-[36px] shrink-0" />
          <div className="hidden sm:block">
            <span className="font-semibold text-sm text-white/90">WAK Solutions</span>
            <span className="text-white/40 mx-2">—</span>
            <span className="text-sm text-white/70">{t("surveys")}</span>
          </div>
        </div>
        <Link href="/dashboard">
          <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("backToInbox")}</span>
            <span className="sm:hidden">{t("back")}</span>
          </a>
        </Link>
      </header>
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-6">
        {view === "list"    && renderList()}
        {view === "editor"  && renderEditor()}
        {view === "results" && renderResults()}
      </main>
    </div>
  );
}
