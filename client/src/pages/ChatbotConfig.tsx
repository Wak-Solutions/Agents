import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Bot, Save, RotateCcw, ChevronDown, ChevronUp,
  Plus, Trash2, GripVertical, AlertTriangle, Eye, EyeOff,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import DashboardLayout from "@/components/DashboardLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

type AnswerType = "free" | "yesno" | "multiple";

interface Question {
  id: string;
  text: string;
  answerType: AnswerType;
  choices: string[];
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

interface EscalationRule {
  id: string;
  rule: string;
}

interface StructuredConfig {
  businessName: string;
  industry: string;
  tone: string;
  customTone: string;
  greeting: string;
  questions: Question[];
  faq: FaqItem[];
  escalationRules: EscalationRule[];
  closingMessage: string;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_STRUCTURED: StructuredConfig = {
  businessName: "WAK Solutions",
  industry: "AI and robotics solutions",
  tone: "Professional",
  customTone: "",
  greeting: "Welcome to WAK Solutions — your strategic AI partner. We deliver innovative solutions that connect human potential with machine precision to build a smarter future.",
  questions: [],
  faq: [],
  escalationRules: [],
  closingMessage: "Thank you for contacting us. A member of our team will be in touch shortly.",
};

// ── Small helpers ─────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0F510F] placeholder:text-gray-400";
const textareaCls = `${inputCls} resize-none`;

// ── Drag-to-reorder hook ───────────────────────────────────────────────────────

function useDraggableList<T>(items: T[], setItems: (v: T[]) => void) {
  const dragIdx = useRef<number | null>(null);
  const overIdx = useRef<number | null>(null);

  const onDragStart = (i: number) => { dragIdx.current = i; };
  const onDragOver  = (e: React.DragEvent, i: number) => { e.preventDefault(); overIdx.current = i; };
  const onDrop      = () => {
    if (dragIdx.current === null || overIdx.current === null || dragIdx.current === overIdx.current) return;
    const arr = [...items];
    const [moved] = arr.splice(dragIdx.current, 1);
    arr.splice(overIdx.current, 0, moved);
    setItems(arr);
    dragIdx.current = null;
    overIdx.current = null;
  };

  return { onDragStart, onDragOver, onDrop };
}

// ── Questions editor ──────────────────────────────────────────────────────────

function QuestionsEditor({
  questions,
  onChange,
}: {
  questions: Question[];
  onChange: (v: Question[]) => void;
}) {
  const { t } = useLanguage();
  const drag = useDraggableList(questions, onChange);

  const add = () =>
    onChange([...questions, { id: uid(), text: "", answerType: "free", choices: [] }]);

  const update = (id: string, patch: Partial<Question>) =>
    onChange(questions.map(q => q.id === id ? { ...q, ...patch } : q));

  const remove = (id: string) => onChange(questions.filter(q => q.id !== id));

  const updateChoice = (qid: string, idx: number, val: string) =>
    onChange(questions.map(q =>
      q.id === qid ? { ...q, choices: q.choices.map((c, i) => i === idx ? val : c) } : q
    ));

  const addChoice = (qid: string) =>
    onChange(questions.map(q =>
      q.id === qid ? { ...q, choices: [...q.choices, ""] } : q
    ));

  const removeChoice = (qid: string, idx: number) =>
    onChange(questions.map(q =>
      q.id === qid ? { ...q, choices: q.choices.filter((_, i) => i !== idx) } : q
    ));

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {questions.map((q, i) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.15 }}
            draggable
            onDragStart={() => drag.onDragStart(i)}
            onDragOver={e => drag.onDragOver(e, i)}
            onDrop={drag.onDrop}
            className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-gray-500 cursor-grab flex-shrink-0" />
              <span className="text-xs font-semibold text-gray-500 w-5 flex-shrink-0">#{i + 1}</span>
              <input
                className={inputCls}
                placeholder={t("chatbotPlaceholderQuestion")}
                value={q.text}
                onChange={e => update(q.id, { text: e.target.value })}
              />
              <select
                className="border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0F510F] flex-shrink-0"
                value={q.answerType}
                onChange={e => update(q.id, { answerType: e.target.value as AnswerType, choices: [] })}
              >
                <option value="free">{t("chatbotQuestionTypeFree")}</option>
                <option value="yesno">{t("chatbotQuestionTypeYesNo")}</option>
                <option value="multiple">{t("chatbotQuestionTypeMultiple")}</option>
              </select>
              <button
                onClick={() => remove(q.id)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {q.answerType === "multiple" && (
              <div className="ml-11 space-y-1.5">
                <p className="text-xs text-gray-500 font-medium">{t("chatbotAnswerChoices")}</p>
                {q.choices.map((c, ci) => (
                  <div key={ci} className="flex items-center gap-1.5">
                    <input
                      className={inputCls}
                      placeholder={`Choice ${ci + 1}`}
                      value={c}
                      onChange={e => updateChoice(q.id, ci, e.target.value)}
                    />
                    <button
                      onClick={() => removeChoice(q.id, ci)}
                      className="p-1.5 rounded text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addChoice(q.id)}
                  className="flex items-center gap-1 text-xs text-[#0F510F] font-medium hover:underline"
                >
                  <Plus className="w-3 h-3" /> {t("chatbotBtnAddChoice")}
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      <button
        onClick={add}
        className="flex items-center gap-1.5 text-sm font-medium text-[#0F510F] border border-[#0F510F]/30 px-3 py-1.5 rounded-lg hover:bg-[#0F510F]/5 transition-colors"
      >
        <Plus className="w-4 h-4" /> {t("chatbotBtnAddQuestion")}
      </button>
    </div>
  );
}

// ── FAQ editor ────────────────────────────────────────────────────────────────

function FaqEditor({ items, onChange }: { items: FaqItem[]; onChange: (v: FaqItem[]) => void }) {
  const { t } = useLanguage();
  const add    = () => onChange([...items, { id: uid(), question: "", answer: "" }]);
  const update = (id: string, patch: Partial<FaqItem>) =>
    onChange(items.map(f => f.id === id ? { ...f, ...patch } : f));
  const remove = (id: string) => onChange(items.filter(f => f.id !== id));

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {items.map(f => (
          <motion.div
            key={f.id}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.15 }}
            className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <input
                  className={inputCls}
                  placeholder={t("chatbotPlaceholderFaqQuestion")}
                  value={f.question}
                  onChange={e => update(f.id, { question: e.target.value })}
                />
                <textarea
                  className={textareaCls}
                  rows={2}
                  placeholder={t("chatbotPlaceholderFaqAnswer")}
                  value={f.answer}
                  onChange={e => update(f.id, { answer: e.target.value })}
                />
              </div>
              <button
                onClick={() => remove(f.id)}
                className="mt-1 p-1.5 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <button
        onClick={add}
        className="flex items-center gap-1.5 text-sm font-medium text-[#0F510F] border border-[#0F510F]/30 px-3 py-1.5 rounded-lg hover:bg-[#0F510F]/5 transition-colors"
      >
        <Plus className="w-4 h-4" /> {t("chatbotBtnAddQA")}
      </button>
    </div>
  );
}

// ── Escalation rules editor ───────────────────────────────────────────────────

function EscalationEditor({
  rules,
  onChange,
}: {
  rules: EscalationRule[];
  onChange: (v: EscalationRule[]) => void;
}) {
  const { t } = useLanguage();
  const add    = () => onChange([...rules, { id: uid(), rule: "" }]);
  const update = (id: string, rule: string) =>
    onChange(rules.map(r => r.id === id ? { ...r, rule } : r));
  const remove = (id: string) => onChange(rules.filter(r => r.id !== id));

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {rules.map(r => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2"
          >
            <input
              className={inputCls}
              placeholder={t("chatbotPlaceholderEscalation")}
              value={r.rule}
              onChange={e => update(r.id, e.target.value)}
            />
            <button
              onClick={() => remove(r.id)}
              className="p-1.5 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      <button
        onClick={add}
        className="flex items-center gap-1.5 text-sm font-medium text-[#0F510F] border border-[#0F510F]/30 px-3 py-1.5 rounded-lg hover:bg-[#0F510F]/5 transition-colors"
      >
        <Plus className="w-4 h-4" /> {t("chatbotBtnAddRule")}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ChatbotConfig() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useLanguage();

  const [config, setConfig]               = useState<StructuredConfig>(DEFAULT_STRUCTURED);
  const [overrideActive, setOverrideActive] = useState(true);
  const [rawPrompt, setRawPrompt]          = useState("");
  const [previewPrompt, setPreviewPrompt]  = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen]    = useState(false);
  const [savedAt, setSavedAt]              = useState<string | null>(null);
  const [saving, setSaving]                = useState(false);
  const [error, setError]                  = useState<string | null>(null);
  const [success, setSuccess]              = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
  }, [isLoading, isAuthenticated, setLocation]);

  // Load saved config on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/api/chatbot-config", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        const sc = data.structured_config;
        if (sc && typeof sc === "object") {
          setConfig({
            businessName:   sc.businessName    ?? DEFAULT_STRUCTURED.businessName,
            industry:       sc.industry        ?? DEFAULT_STRUCTURED.industry,
            tone:           sc.tone            ?? DEFAULT_STRUCTURED.tone,
            customTone:     sc.customTone      ?? "",
            greeting:       sc.greeting        ?? DEFAULT_STRUCTURED.greeting,
            questions:      sc.questions       ?? [],
            faq:            sc.faq             ?? [],
            escalationRules: sc.escalationRules ?? [],
            closingMessage: sc.closingMessage  ?? DEFAULT_STRUCTURED.closingMessage,
          });
        }
        setOverrideActive(data.override_active ?? true);
        setRawPrompt(data.system_prompt ?? "");
        setSavedAt(data.updated_at ?? null);
      })
      .catch(() => {});
  }, [isAuthenticated]);

  // Live compile preview whenever structured config changes (debounced)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchPreview = useCallback(async () => {
    if (overrideActive) { setPreviewPrompt(null); return; }
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/chatbot-config/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structured_config: config }),
      });
      if (res.ok) {
        const { prompt } = await res.json();
        setPreviewPrompt(prompt);
      }
    } catch (_) {}
    setPreviewLoading(false);
  }, [config, overrideActive]);

  useEffect(() => {
    if (!advancedOpen) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(fetchPreview, 400);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [config, advancedOpen, fetchPreview]);

  const set = <K extends keyof StructuredConfig>(key: K, val: StructuredConfig[K]) =>
    setConfig(c => ({ ...c, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/chatbot-config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structured_config: config, override_active: overrideActive, raw_prompt: rawPrompt }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || "Failed to save");
      }
      const saved = await res.json();
      setSavedAt(saved.updated_at ?? new Date().toISOString());
      setSuccess(t("chatbotSavedSuccess"));
    } catch (e: any) {
      setError(e.message || "An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULT_STRUCTURED);
    setOverrideActive(false);
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-5 pb-12">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-[#0F510F]" />
            <h1 className="text-2xl font-bold text-gray-900">{t("chatbotTitle")}</h1>
          </div>

          {/* ── Business Identity ─────────────────────────────────────── */}
          <SectionCard title={t("chatbotSectionIdentity")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t("chatbotFieldBusinessName")}>
                <input
                  className={inputCls}
                  placeholder={t("chatbotPlaceholderBusinessName")}
                  value={config.businessName}
                  onChange={e => set("businessName", e.target.value)}
                />
              </Field>
              <Field label={t("chatbotFieldIndustry")} hint={t("chatbotFieldIndustryHint")}>
                <input
                  className={inputCls}
                  placeholder={t("chatbotPlaceholderIndustry")}
                  value={config.industry}
                  onChange={e => set("industry", e.target.value)}
                />
              </Field>
            </div>
            <Field label={t("chatbotFieldTone")}>
              <div className="flex gap-2 flex-wrap">
                {[
                  { val: "Professional", label: t("chatbotToneProfessional") },
                  { val: "Friendly",     label: t("chatbotToneFriendly") },
                  { val: "Formal",       label: t("chatbotToneFormal") },
                  { val: "Custom",       label: t("chatbotToneCustom") },
                ].map(({ val, label }) => (
                  <button
                    key={val}
                    onClick={() => set("tone", val)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      config.tone === val
                        ? "bg-[#0F510F] border-[#0F510F] text-white"
                        : "border-gray-200 text-gray-500 hover:text-gray-900 hover:border-[#0F510F]/40"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {config.tone === "Custom" && (
                <input
                  className={`${inputCls} mt-2`}
                  placeholder={t("chatbotPlaceholderToneCustom")}
                  value={config.customTone}
                  onChange={e => set("customTone", e.target.value)}
                />
              )}
            </Field>
          </SectionCard>

          {/* ── Conversation Flow ─────────────────────────────────────── */}
          <SectionCard title={t("chatbotSectionFlow")}>
            <Field label={t("chatbotFieldGreeting")} hint={t("chatbotFieldGreetingHint")}>
              <textarea
                className={textareaCls}
                rows={3}
                placeholder={t("chatbotPlaceholderGreeting")}
                value={config.greeting}
                onChange={e => set("greeting", e.target.value)}
              />
            </Field>

            <Field label={t("chatbotFieldQualification")} hint={t("chatbotFieldQualificationHint")}>
              <QuestionsEditor
                questions={config.questions}
                onChange={v => set("questions", v)}
              />
            </Field>

            <Field label={t("chatbotFieldClosing")} hint={t("chatbotFieldClosingHint")}>
              <textarea
                className={textareaCls}
                rows={2}
                placeholder={t("chatbotPlaceholderClosing")}
                value={config.closingMessage}
                onChange={e => set("closingMessage", e.target.value)}
              />
            </Field>
          </SectionCard>

          {/* ── Knowledge Base ────────────────────────────────────────── */}
          <SectionCard title={t("chatbotSectionKnowledge")}>
            <FaqEditor
              items={config.faq}
              onChange={v => set("faq", v)}
            />
          </SectionCard>

          {/* ── Escalation Rules ──────────────────────────────────────── */}
          <SectionCard title={t("chatbotSectionEscalation")}>
            <p className="text-xs text-gray-500 -mt-2">
              {t("chatbotEscalationHint")}
            </p>
            <EscalationEditor
              rules={config.escalationRules}
              onChange={v => set("escalationRules", v)}
            />
          </SectionCard>

          {/* ── Advanced: Raw Prompt ──────────────────────────────────── */}
          <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => { setAdvancedOpen(o => !o); if (!advancedOpen) fetchPreview(); }}
              className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-gray-900 hover:bg-gray-50/50 transition-colors"
            >
              <span>{t("chatbotSectionAdvanced")}</span>
              {advancedOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
            </button>

            <AnimatePresence initial={false}>
              {advancedOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 space-y-4 border-t border-gray-200">
                    {/* Override toggle */}
                    <div className="flex items-center justify-between pt-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{t("chatbotRawOverrideLabel")}</p>
                        <p className="text-xs text-gray-500">{t("chatbotRawOverrideHint")}</p>
                      </div>
                      <button
                        onClick={() => setOverrideActive(o => !o)}
                        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${overrideActive ? "bg-amber-500" : "bg-gray-100"}`}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${overrideActive ? "translate-x-5" : "translate-x-0.5"}`} />
                      </button>
                    </div>

                    {/* Warning banner */}
                    {overrideActive && (
                      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-800">
                          {t("chatbotRawActiveWarning")}
                        </p>
                      </div>
                    )}

                    {/* Compiled preview (when override is off) */}
                    {!overrideActive && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <Eye className="w-3.5 h-3.5" />
                          <span>{t("chatbotCompiledPreview")}</span>
                          {previewLoading && <span className="animate-pulse">{t("chatbotUpdating")}</span>}
                        </div>
                        <textarea
                          readOnly
                          rows={14}
                          className={`${textareaCls} font-mono text-xs bg-gray-50/50 cursor-default`}
                          value={previewPrompt ?? ""}
                        />
                      </div>
                    )}

                    {/* Raw editor (when override is on) */}
                    {overrideActive && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>{t("chatbotRawPromptLabel")}</span>
                        </div>
                        <textarea
                          rows={14}
                          className={`${textareaCls} font-mono text-xs`}
                          value={rawPrompt}
                          onChange={e => setRawPrompt(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* ── Feedback + Actions ────────────────────────────────────── */}
          <div className="space-y-3">
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            {success && (
              <p className="text-sm text-[#0F510F] bg-[#0F510F]/10 border border-[#0F510F]/20 rounded-lg px-3 py-2">{success}</p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 text-sm font-medium bg-[#0F510F] text-white px-5 py-2.5 rounded-lg hover:bg-[#0d4510] disabled:opacity-60 transition-colors"
              >
                {saving ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("saving")}</>
                ) : (
                  <><Save className="w-3.5 h-3.5" />{t("chatbotBtnSave")}</>
                )}
              </button>

              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 text-sm font-medium border border-gray-200 text-gray-500 px-5 py-2.5 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t("chatbotBtnReset")}
              </button>
            </div>

            {savedAt && (
              <p className="text-xs text-gray-500">
                Last saved: {new Date(savedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
