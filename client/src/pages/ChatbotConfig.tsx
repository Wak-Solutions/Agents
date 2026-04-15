import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Bot, Save, Plus, Trash2, GripVertical, Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import DashboardLayout from "@/components/DashboardLayout";

// ── Types (unchanged) ─────────────────────────────────────────────────────────

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
  businessName: "",
  industry: "",
  tone: "Professional",
  customTone: "",
  greeting: "",
  questions: [],
  faq: [],
  escalationRules: [],
  closingMessage: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Drag-to-reorder hook (unchanged) ─────────────────────────────────────────

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

// ── Shared input styles ───────────────────────────────────────────────────────

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-[#0F510F]/40 placeholder:text-gray-400 transition-shadow";

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
    </div>
  );
}

// ── Answer type badge (click to cycle) ───────────────────────────────────────

const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  free: "Free text",
  yesno: "Yes / No",
  multiple: "Multiple choice",
};

const ANSWER_TYPE_ORDER: AnswerType[] = ["free", "yesno", "multiple"];

function AnswerTypeBadge({
  value,
  onChange,
}: {
  value: AnswerType;
  onChange: (v: AnswerType) => void;
}) {
  const cycle = () => {
    const idx = ANSWER_TYPE_ORDER.indexOf(value);
    onChange(ANSWER_TYPE_ORDER[(idx + 1) % ANSWER_TYPE_ORDER.length]);
  };
  return (
    <button
      type="button"
      onClick={cycle}
      title="Click to change answer type"
      className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors select-none"
    >
      {ANSWER_TYPE_LABELS[value]}
    </button>
  );
}

// ── Questions editor ──────────────────────────────────────────────────────────

function QuestionsEditor({
  questions,
  onChange,
}: {
  questions: Question[];
  onChange: (v: Question[]) => void;
}) {
  const drag = useDraggableList(questions, onChange);

  const add = () =>
    onChange([...questions, { id: uid(), text: "", answerType: "free", choices: [] }]);

  const update = (id: string, patch: Partial<Question>) =>
    onChange(questions.map(q => (q.id === id ? { ...q, ...patch } : q)));

  const remove = (id: string) => onChange(questions.filter(q => q.id !== id));

  const updateChoice = (qid: string, idx: number, val: string) =>
    onChange(
      questions.map(q =>
        q.id === qid ? { ...q, choices: q.choices.map((c, i) => (i === idx ? val : c)) } : q
      )
    );

  const addChoice = (qid: string) =>
    onChange(questions.map(q => (q.id === qid ? { ...q, choices: [...q.choices, ""] } : q)));

  const removeChoice = (qid: string, idx: number) =>
    onChange(
      questions.map(q =>
        q.id === qid ? { ...q, choices: q.choices.filter((_, i) => i !== idx) } : q
      )
    );

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {questions.map((q, i) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.13 }}
            draggable
            onDragStart={() => drag.onDragStart(i)}
            onDragOver={e => drag.onDragOver(e, i)}
            onDrop={drag.onDrop}
            className="group border border-gray-200 rounded-lg bg-gray-50 p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-gray-300 group-hover:text-gray-400 cursor-grab flex-shrink-0 transition-colors" />
              <input
                className={inputCls + " flex-1"}
                placeholder={`Question ${i + 1}`}
                value={q.text}
                onChange={e => update(q.id, { text: e.target.value })}
              />
              <AnswerTypeBadge
                value={q.answerType}
                onChange={type => update(q.id, { answerType: type, choices: [] })}
              />
              <button
                type="button"
                onClick={() => remove(q.id)}
                className="flex-shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {q.answerType === "multiple" && (
              <div className="ml-6 space-y-1.5">
                {q.choices.map((c, ci) => (
                  <div key={ci} className="flex items-center gap-1.5">
                    <input
                      className={inputCls}
                      placeholder={`Option ${ci + 1}`}
                      value={c}
                      onChange={e => updateChoice(q.id, ci, e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => removeChoice(q.id, ci)}
                      className="flex-shrink-0 p-1.5 rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addChoice(q.id)}
                  className="text-xs text-[#0F510F] font-medium hover:underline"
                >
                  + Add option
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg px-3 py-2 w-full hover:border-[#0F510F]/50 hover:text-[#0F510F] transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add question
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
  const add    = () => onChange([...rules, { id: uid(), rule: "" }]);
  const update = (id: string, rule: string) =>
    onChange(rules.map(r => (r.id === id ? { ...r, rule } : r)));
  const remove = (id: string) => onChange(rules.filter(r => r.id !== id));

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {rules.map(r => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.13 }}
            className="flex items-center gap-2"
          >
            <input
              className={inputCls}
              placeholder="e.g. Customer asks to speak to a person"
              value={r.rule}
              onChange={e => update(r.id, e.target.value)}
            />
            <button
              type="button"
              onClick={() => remove(r.id)}
              className="flex-shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg px-3 py-2 w-full hover:border-[#0F510F]/50 hover:text-[#0F510F] transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add rule
      </button>
    </div>
  );
}

// ── WhatsApp preview panel ────────────────────────────────────────────────────

function ChatBubble({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay }}
      className="bg-white rounded-2xl rounded-tl-sm px-3.5 py-2.5 max-w-[88%] shadow-sm"
    >
      <p className="text-[13px] text-gray-800 leading-snug whitespace-pre-wrap">{text}</p>
    </motion.div>
  );
}

function PreviewButton({ label }: { label: string }) {
  return (
    <div className="border border-[#0F510F]/30 rounded-lg px-3 py-1.5 text-center">
      <span className="text-[12px] font-medium text-[#0F510F]">{label}</span>
    </div>
  );
}

function WhatsAppPreview({ config }: { config: StructuredConfig }) {
  const businessName = config.businessName || "Your Business";
  const greeting     = config.greeting     || "Your opening message will appear here...";

  // Build the conversation steps
  const steps: React.ReactNode[] = [];
  let stepDelay = 0;
  const d = 0.07;

  // Greeting bubble
  steps.push(
    <div key="greeting" className="space-y-1.5">
      <ChatBubble text={greeting} delay={stepDelay} />
    </div>
  );
  stepDelay += d;

  // Qualification questions
  config.questions.forEach((q, i) => {
    if (!q.text) return;
    stepDelay += d;
    steps.push(
      <div key={`q-${q.id}`} className="space-y-1.5">
        <ChatBubble text={q.text} delay={stepDelay} />
        {q.answerType === "yesno" && (
          <div className="grid grid-cols-2 gap-1.5 max-w-[88%]">
            <PreviewButton label="Yes" />
            <PreviewButton label="No" />
          </div>
        )}
        {q.answerType === "multiple" && q.choices.filter(Boolean).length > 0 && (
          <div className="flex flex-col gap-1 max-w-[88%]">
            {q.choices.filter(Boolean).map((c, ci) => (
              <PreviewButton key={ci} label={c} />
            ))}
          </div>
        )}
      </div>
    );
    stepDelay += d;
  });

  // Escalation example (if rules exist)
  if (config.escalationRules.some(r => r.rule)) {
    stepDelay += d;
    // Customer message
    steps.push(
      <div key="esc-trigger" className="flex justify-end">
        <div className="bg-[#0F510F] rounded-2xl rounded-tr-sm px-3.5 py-2.5 max-w-[78%] shadow-sm">
          <p className="text-[13px] text-white leading-snug">I'd like to speak to a human</p>
        </div>
      </div>
    );
    stepDelay += d;
    steps.push(
      <div key="esc-response">
        <ChatBubble
          text="Of course — connecting you with our team now. A member will be in touch shortly."
          delay={stepDelay}
        />
      </div>
    );
    stepDelay += d;
  }

  // Closing message
  if (config.closingMessage) {
    stepDelay += d;
    steps.push(
      <div key="closing">
        <ChatBubble text={config.closingMessage} delay={stepDelay} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-md bg-white">
      {/* Header */}
      <div className="bg-[#0F510F] px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xs">
            {businessName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold truncate">{businessName}</p>
          <p className="text-white/50 text-xs">AI Assistant</p>
        </div>
      </div>

      {/* Chat body */}
      <div className="bg-[#ECE5DD] px-3 py-4 space-y-3 min-h-[380px] max-h-[520px] overflow-y-auto">
        <AnimatePresence initial={false}>
          {steps}
        </AnimatePresence>
      </div>

      {/* Input bar */}
      <div className="bg-[#F0F0F0] px-3 py-2 flex items-center gap-2 border-t border-gray-200">
        <div className="flex-1 bg-white rounded-full px-4 py-1.5 border border-gray-200">
          <p className="text-gray-400 text-xs">Type a message...</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-[#0F510F] flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ChatbotConfig() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useLanguage();

  // ── State (all original fields preserved) ──────────────────────────────────
  const [config, setConfig]                 = useState<StructuredConfig>(DEFAULT_STRUCTURED);
  const [overrideActive]                    = useState(false);   // always false — Advanced hidden
  const [rawPrompt]                         = useState("");       // preserved but not rendered
  const [savedAt, setSavedAt]               = useState<string | null>(null);
  const [saving, setSaving]                 = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess]       = useState(false);
  const [isDirty, setIsDirty]               = useState(false);
  const [previewConfig, setPreviewConfig]   = useState<StructuredConfig>(DEFAULT_STRUCTURED);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
  }, [isLoading, isAuthenticated, setLocation]);

  // Load saved config on mount (unchanged API call)
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/api/chatbot-config", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        const sc = data.structured_config;
        if (sc && typeof sc === "object") {
          const loaded: StructuredConfig = {
            businessName:    sc.businessName    ?? DEFAULT_STRUCTURED.businessName,
            industry:        sc.industry        ?? DEFAULT_STRUCTURED.industry,
            tone:            sc.tone            ?? DEFAULT_STRUCTURED.tone,
            customTone:      sc.customTone      ?? "",
            greeting:        sc.greeting        ?? DEFAULT_STRUCTURED.greeting,
            questions:       sc.questions       ?? [],
            faq:             sc.faq             ?? [],
            escalationRules: sc.escalationRules ?? [],
            closingMessage:  sc.closingMessage  ?? DEFAULT_STRUCTURED.closingMessage,
          };
          setConfig(loaded);
          setPreviewConfig(loaded);
        }
        setSavedAt(data.updated_at ?? null);
      })
      .catch(() => {});
  }, [isAuthenticated]);

  // Debounced preview update (300ms)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setPreviewConfig({ ...config }), 300);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [config]);

  const set = <K extends keyof StructuredConfig>(key: K, val: StructuredConfig[K]) => {
    setConfig(c => ({ ...c, [key]: val }));
    setIsDirty(true);
  };

  // Save (unchanged API call — always sends override_active: false)
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/chatbot-config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          structured_config: config,
          override_active: false,
          raw_prompt: rawPrompt,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || "Failed to save");
      }
      const saved = await res.json();
      setSavedAt(saved.updated_at ?? new Date().toISOString());
      setIsDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e: any) {
      setError(e.message || "An error occurred");
    } finally {
      setSaving(false);
    }
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
        <div className="max-w-6xl mx-auto px-6 py-6 pb-4">

          {/* Page header */}
          <div className="flex items-center gap-2 mb-6">
            <Bot className="w-5 h-5 text-[#0F510F]" />
            <h1 className="text-xl font-bold text-gray-900">Chatbot Setup</h1>
          </div>

          <div className="flex gap-8 items-start">

            {/* ── Left column: form ──────────────────────────────────────── */}
            <div className="flex-1 min-w-0 space-y-4 pb-24">

              {/* SECTION 1 — Your Business */}
              <SectionCard
                title="Your Business"
                description="Basic information that shapes how your bot introduces itself"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500">Business Name</label>
                    <input
                      className={inputCls}
                      placeholder="e.g. WAK Solutions"
                      value={config.businessName}
                      onChange={e => set("businessName", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500">Industry</label>
                    <input
                      className={inputCls}
                      placeholder="e.g. Technology, Retail, Healthcare"
                      value={config.industry}
                      onChange={e => set("industry", e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500">Tone</label>
                  <div className="relative">
                    <select
                      className={inputCls + " appearance-none pr-8 cursor-pointer"}
                      value={config.tone}
                      onChange={e => set("tone", e.target.value)}
                    >
                      <option value="Friendly">Friendly</option>
                      <option value="Professional">Professional</option>
                      <option value="Formal">Formal</option>
                      <option value="Custom">Custom</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  </div>
                  <p className="text-xs text-gray-400">This shapes how your bot speaks to customers</p>
                </div>

                {config.tone === "Custom" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500">Describe your tone</label>
                    <textarea
                      className={inputCls + " resize-none"}
                      rows={2}
                      placeholder="e.g. Warm and conversational, like talking to a knowledgeable friend"
                      value={config.customTone}
                      onChange={e => set("customTone", e.target.value)}
                    />
                  </div>
                )}
              </SectionCard>

              {/* SECTION 2 — Welcome Message */}
              <SectionCard
                title="Welcome Message"
                description="This is the first thing customers see when they start a conversation"
              >
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500">Opening message</label>
                  <textarea
                    className={inputCls + " resize-none"}
                    rows={4}
                    placeholder={`e.g. Hey! Welcome to WAK Solutions, your strategic AI partner. How can I help you today?\n\n1. Product Inquiry\n2. Track Order\n3. Complaint`}
                    value={config.greeting}
                    onChange={e => set("greeting", e.target.value)}
                  />
                  <p className="text-xs text-gray-400">This is the first thing customers see</p>
                </div>
              </SectionCard>

              {/* SECTION 3 — Questions */}
              <SectionCard
                title="Questions"
                description="The bot will ask these questions to understand what the customer needs"
              >
                <QuestionsEditor
                  questions={config.questions}
                  onChange={v => set("questions", v)}
                />
              </SectionCard>

              {/* SECTION 4 — Escalation Rules */}
              <SectionCard
                title="Escalation Rules"
                description="When should the bot hand off to a human agent?"
              >
                <EscalationEditor
                  rules={config.escalationRules}
                  onChange={v => set("escalationRules", v)}
                />
              </SectionCard>

            </div>

            {/* ── Right column: WhatsApp preview (sticky) ────────────────── */}
            <div className="hidden lg:block w-[300px] shrink-0">
              <div className="sticky top-6">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2.5">
                  Live Preview
                </p>
                <WhatsAppPreview config={previewConfig} />
              </div>
            </div>

          </div>
        </div>

        {/* ── Sticky save bar ──────────────────────────────────────────────── */}
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-gray-200 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">

            <div className="flex items-center gap-3 min-w-0">
              {isDirty && !saveSuccess && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  Unsaved changes
                </div>
              )}
              {saveSuccess && (
                <div className="flex items-center gap-1.5 text-xs text-[#0F510F]">
                  <Check className="w-3.5 h-3.5" />
                  Saved successfully
                </div>
              )}
              {savedAt && !isDirty && !saveSuccess && (
                <p className="text-xs text-gray-400 truncate">
                  Last saved {new Date(savedAt).toLocaleString()}
                </p>
              )}
              {error && (
                <p className="text-xs text-red-600 truncate">{error}</p>
              )}
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm font-medium bg-[#0F510F] text-white px-5 py-2 rounded-lg hover:bg-[#0d4510] disabled:opacity-60 transition-colors flex-shrink-0"
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  Save changes
                </>
              )}
            </button>

          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
