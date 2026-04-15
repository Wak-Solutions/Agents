import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Bot, ArrowRight, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import DashboardLayout from "@/components/DashboardLayout";
import { useLanguage } from "@/lib/language-context";

// ── Types (all preserved, unchanged) ─────────────────────────────────────────

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
  servicesText: string;
}

// ── Conversation message type ─────────────────────────────────────────────────

interface ConvMessage {
  role: "bot" | "user";
  text: string;
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
  servicesText: "",
};

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-[#0F510F]/40 placeholder:text-gray-400 transition-shadow";

// ── Skeleton bubble ───────────────────────────────────────────────────────────

function SkeletonBubble({ wide = false }: { wide?: boolean }) {
  return (
    <div className={`h-10 rounded-2xl bg-gray-200 animate-pulse ${wide ? "w-[72%]" : "w-[55%]"}`} />
  );
}

// ── WhatsApp preview panel ────────────────────────────────────────────────────

function WhatsAppPreview({
  companyName,
  conversation,
  loading,
  hasGenerated,
}: {
  companyName: string;
  conversation: ConvMessage[];
  loading: boolean;
  hasGenerated: boolean;
}) {
  const chatRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();
  const name = companyName || "Your Business";

  // Scroll to bottom whenever conversation updates
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [conversation, loading]);

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-md bg-white">
      {/* Header */}
      <div className="bg-[#075E54] px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">
            {name.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold truncate">{name}</p>
          <p className="text-white/60 text-xs">{t("chatbotSetupAiAssistant")}</p>
        </div>
      </div>

      {/* Chat body */}
      <div
        ref={chatRef}
        className="bg-[#ECE5DD] px-3 py-4 space-y-2.5 min-h-[400px] max-h-[540px] overflow-y-auto"
      >
        {/* Empty state */}
        {!hasGenerated && !loading && (
          <div className="flex flex-col items-center justify-center h-64 space-y-2 text-center px-4">
            <div className="w-10 h-10 rounded-full bg-white/60 flex items-center justify-center">
              <Bot className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm text-gray-500 font-medium">{t("chatbotSetupEmptyTitle")}</p>
            <p className="text-xs text-gray-400">{t("chatbotSetupEmptyDesc")}</p>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-3">
            <SkeletonBubble wide />
            <div className="flex justify-end">
              <SkeletonBubble />
            </div>
            <SkeletonBubble wide />
            <div className="flex justify-end">
              <SkeletonBubble />
            </div>
            <SkeletonBubble />
          </div>
        )}

        {/* Conversation bubbles */}
        {!loading && conversation.length > 0 && (
          <AnimatePresence initial={false}>
            {conversation.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: i * 0.06 }}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[82%] px-3.5 py-2 rounded-2xl shadow-sm ${
                    msg.role === "user"
                      ? "bg-[#DCF8C6] rounded-tr-sm"
                      : "bg-white rounded-tl-sm"
                  }`}
                >
                  <p className="text-[13px] text-gray-800 leading-snug whitespace-pre-wrap">
                    {msg.text}
                  </p>
                  <p className="text-[10px] text-gray-400 text-right mt-1">
                    {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Input bar (decorative) */}
      <div className="bg-[#F0F0F0] px-3 py-2 flex items-center gap-2 border-t border-gray-200">
        <div className="flex-1 bg-white rounded-full px-4 py-1.5 border border-gray-200">
          <p className="text-gray-400 text-xs">{t("chatbotSetupTypeMessage")}</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-[#075E54] flex items-center justify-center flex-shrink-0">
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

  // ── Form fields ────────────────────────────────────────────────────────────
  const [companyName, setCompanyName]   = useState("");
  const [description, setDescription]  = useState("");
  const [services, setServices]         = useState("");
  const [feedback, setFeedback]         = useState("");

  // ── Config state (loaded from DB on mount, passed through on save) ─────────
  const [loadedConfig, setLoadedConfig] = useState<StructuredConfig>(DEFAULT_STRUCTURED);

  // ── Generation state ───────────────────────────────────────────────────────
  const [conversation, setConversation] = useState<ConvMessage[]>([]);
  const [generating, setGenerating]     = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [genError, setGenError]         = useState<string | null>(null);

  // ── Autosave state ─────────────────────────────────────────────────────────
  type SaveStatus = "idle" | "saving" | "saved" | "error";
  const [saveStatus, setSaveStatus]     = useState<SaveStatus>("idle");

  // Refs to always have latest values available inside debounced callbacks
  const savePayloadRef = useRef({ companyName, description, services, loadedConfig, conversation });
  savePayloadRef.current = { companyName, description, services, loadedConfig, conversation };

  // Set to true only when the user makes a change — prevents autosave on initial DB population
  const userEditedRef = useRef(false);

  // Timer ref for the "saved" fade-out
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
  }, [isLoading, isAuthenticated, setLocation]);

  // Load saved config on mount — pre-fill fields from existing config
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/api/chatbot-config", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        const sc = data.structured_config;
        if (sc && typeof sc === "object") {
          const loaded: StructuredConfig = {
            businessName:    sc.businessName    ?? "",
            industry:        sc.industry        ?? "",
            tone:            sc.tone            ?? "Professional",
            customTone:      sc.customTone      ?? "",
            greeting:        sc.greeting        ?? "",
            questions:       sc.questions       ?? [],
            faq:             sc.faq             ?? [],
            escalationRules: sc.escalationRules ?? [],
            closingMessage:  sc.closingMessage  ?? "",
            servicesText:    sc.servicesText    ?? "",
          };
          setLoadedConfig(loaded);
          setCompanyName(loaded.businessName);
          setDescription(loaded.industry);
          setServices(loaded.servicesText);
        }

        // Restore saved conversation — no API call needed
        const saved = data.demo_conversation;
        if (Array.isArray(saved) && saved.length > 0) {
          setConversation(saved);
          setHasGenerated(true);
        }
      })
      .catch(() => {});
  }, [isAuthenticated]);

  // ── Core save function — reads from savePayloadRef to avoid stale closures ──
  const doSave = async (convOverride?: ConvMessage[]) => {
    const { companyName, description, services, loadedConfig, conversation } = savePayloadRef.current;
    const convToSave = convOverride ?? conversation;
    setSaveStatus("saving");
    try {
      const structured_config: StructuredConfig = {
        ...loadedConfig,
        businessName: companyName,
        industry:     description,
        servicesText: services,
      };
      const res = await fetch("/api/chatbot-config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          structured_config,
          override_active: false,
          raw_prompt: "",
          demo_conversation: convToSave,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || "Failed to save");
      }
      setSaveStatus("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("error");
    }
  };

  // ── Debounced autosave on field changes (2s after user stops typing) ────────
  useEffect(() => {
    if (!userEditedRef.current) return;
    const timer = setTimeout(() => doSave(), 2000);
    return () => clearTimeout(timer);
  }, [companyName, description, services]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate conversation via backend
  const generate = async (isFeedback = false) => {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/chatbot-config/generate-conversation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          description,
          services,
          feedback: isFeedback ? feedback : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || "Generation failed");
      }
      const data = await res.json();
      const newConversation: ConvMessage[] = data.conversation ?? [];
      setConversation(newConversation);
      setHasGenerated(true);
      if (isFeedback) setFeedback("");
      // Save immediately after generation — pass conversation directly to avoid stale state
      await doSave(newConversation);
    } catch (e: any) {
      setGenError(e.message || "Something went wrong. Please try again.");
    } finally {
      setGenerating(false);
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
        <div className="max-w-6xl mx-auto px-6 py-6">

          {/* Page header */}
          <div className="flex items-center gap-2 mb-6">
            <Bot className="w-5 h-5 text-[#0F510F]" />
            <h1 className="text-xl font-bold text-gray-900">{t("chatbotSetupTitle")}</h1>
          </div>

          <div className="flex flex-col md:flex-row gap-8 items-start">

            {/* ── Left column ──────────────────────────────────────────────── */}
            <div className="w-full md:flex-1 md:min-w-0 space-y-4">

              {/* SECTION 1 — Set up your chatbot */}
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">{t("chatbotSetupSection1Title")}</h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t("chatbotSetupSection1Desc")}
                    </p>
                  </div>
                  {/* Autosave status indicator */}
                  <div className="flex-shrink-0 flex items-center gap-1.5 text-xs mt-0.5 min-w-[80px] justify-end">
                    {saveStatus === "saving" && (
                      <><span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" /><span className="text-gray-400">{t("chatbotSetupSaving")}</span></>
                    )}
                    {saveStatus === "saved" && (
                      <><span className="w-1.5 h-1.5 rounded-full bg-[#0F510F] flex-shrink-0" /><span className="text-[#0F510F]">{t("chatbotSetupSavedSuccess")}</span></>
                    )}
                    {saveStatus === "error" && (
                      <><span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" /><span className="text-red-500">Save failed</span></>
                    )}
                  </div>
                </div>
                <div className="px-5 py-4 space-y-4">

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500">{t("chatbotSetupCompanyName")}</label>
                    <input
                      className={inputCls}
                      placeholder={t("chatbotSetupCompanyNamePlaceholder")}
                      value={companyName}
                      onChange={e => { setCompanyName(e.target.value); userEditedRef.current = true; }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500">{t("chatbotSetupDescription")}</label>
                    <textarea
                      className={inputCls + " resize-none"}
                      rows={3}
                      placeholder={t("chatbotSetupDescriptionPlaceholder")}
                      value={description}
                      onChange={e => { setDescription(e.target.value); userEditedRef.current = true; }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500">{t("chatbotSetupServices")}</label>
                    <textarea
                      className={inputCls + " resize-none"}
                      rows={3}
                      placeholder={t("chatbotSetupServicesPlaceholder")}
                      value={services}
                      onChange={e => { setServices(e.target.value); userEditedRef.current = true; }}
                    />
                  </div>

                  {genError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {genError}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => generate(false)}
                    disabled={generating || !companyName.trim()}
                    className="flex items-center justify-center gap-2 w-full text-sm font-medium bg-[#0F510F] text-white px-5 py-2.5 rounded-lg hover:bg-[#0d4510] disabled:opacity-50 transition-colors"
                  >
                    {generating ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {t("chatbotSetupGenerating")}
                      </>
                    ) : (
                      <>
                        {hasGenerated ? <RefreshCw className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
                        {hasGenerated ? t("chatbotSetupRegenerate") : t("chatbotSetupGenerate")}
                      </>
                    )}
                  </button>

                </div>
              </div>

              {/* SECTION 2 — Not quite right? (only after first generation) */}
              <AnimatePresence>
                {hasGenerated && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden"
                  >
                    <div className="px-5 pt-5 pb-4 border-b border-gray-100">
                      <h2 className="text-sm font-semibold text-gray-900">{t("chatbotSetupSection2Title")}</h2>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {t("chatbotSetupSection2Desc")}
                      </p>
                    </div>
                    <div className="px-5 py-4 space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500">{t("chatbotSetupFeedbackLabel")}</label>
                        <textarea
                          className={inputCls + " resize-none"}
                          rows={3}
                          placeholder={t("chatbotSetupFeedbackPlaceholder")}
                          value={feedback}
                          onChange={e => setFeedback(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => generate(true)}
                        disabled={generating || !feedback.trim()}
                        className="flex items-center justify-center gap-2 w-full text-sm font-medium border border-[#0F510F] text-[#0F510F] px-5 py-2.5 rounded-lg hover:bg-[#0F510F]/5 disabled:opacity-50 transition-colors"
                      >
                        {generating ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-[#0F510F]/30 border-t-[#0F510F] rounded-full animate-spin" />
                            {t("chatbotSetupUpdating")}
                          </>
                        ) : (
                          <>
                            <ArrowRight className="w-3.5 h-3.5" />
                            {t("chatbotSetupUpdate")}
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </div>

            {/* ── Right column / mobile bottom: WhatsApp preview ────────────── */}
            <div className="w-full md:w-[300px] md:shrink-0">
              <div className="md:sticky md:top-6">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2.5">
                  {t("chatbotSetupDemoLabel")}
                </p>
                <div className="h-[500px] md:h-auto overflow-y-auto md:overflow-visible rounded-2xl md:rounded-none">
                  <WhatsAppPreview
                    companyName={companyName}
                    conversation={conversation}
                    loading={generating}
                    hasGenerated={hasGenerated}
                  />
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
