import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Bot, ArrowRight, RefreshCw, Plus, Trash2, ChevronDown, ChevronUp, GripVertical,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import DashboardLayout from "@/components/DashboardLayout";
import { useLanguage } from "@/lib/language-context";

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

interface SubSubItem {
  id: string;
  label: string;
}

interface SubItem {
  id: string;
  label: string;
  subItems: SubSubItem[];   // level 3 — max depth
}

interface MenuItem {
  id: string;
  label: string;
  subItems: SubItem[];      // level 2
}

interface Config {
  businessName: string;
  industry: string;        // mapped from "description" — backward compat key
  tone: string;
  customTone: string;
  greeting: string;
  questions: Question[];
  faq: FaqItem[];
  escalationRules: EscalationRule[];
  closingMessage: string;
  servicesText: string;
  menuConfig: MenuItem[];
}

interface ConvMessage {
  role: "bot" | "user";
  text: string;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Config = {
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
  menuConfig: [],
};

const TONES = ["Professional", "Friendly", "Formal", "Casual", "Custom"];

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-[#0F510F]/40 placeholder:text-gray-400 transition-shadow";

const labelCls = "block text-xs font-medium text-gray-500 mb-1";
const hintCls = "text-[11px] text-gray-400 mt-0.5";

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ── Step card ─────────────────────────────────────────────────────────────────

function StepCard({
  step,
  title,
  desc,
  children,
}: {
  step: number;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-start gap-3">
        <div className="w-6 h-6 rounded-full bg-[#0F510F]/10 text-[#0F510F] text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
          {step}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
        </div>
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
    </div>
  );
}

// ── Menu editor ───────────────────────────────────────────────────────────────

const SUB_LABELS = "abcdefghijklmnopqrstuvwxyz";

function MenuEditor({
  items,
  onChange,
}: {
  items: MenuItem[];
  onChange: (items: MenuItem[]) => void;
}) {
  const { t } = useLanguage();
  const [expandedL1, setExpandedL1] = useState<string | null>(null);
  const [expandedL2, setExpandedL2] = useState<string | null>(null); // key = `${itemId}:${subIdx}`

  // ── Level 1 helpers ──────────────────────────────────────────────────────
  const addItem = () => {
    const n: MenuItem = { id: uid(), label: "", subItems: [] };
    onChange([...items, n]);
    setExpandedL1(n.id);
  };

  const removeItem = (id: string) => {
    onChange(items.filter(it => it.id !== id));
    if (expandedL1 === id) setExpandedL1(null);
  };

  const updateItemLabel = (id: string, label: string) =>
    onChange(items.map(it => it.id === id ? { ...it, label } : it));

  // ── Level 2 helpers ──────────────────────────────────────────────────────
  const addSubItem = (itemId: string) => {
    const n: SubItem = { id: uid(), label: "", subItems: [] };
    onChange(items.map(it => it.id === itemId
      ? { ...it, subItems: [...it.subItems, n] }
      : it));
    setExpandedL2(`${itemId}:${n.id}`);
  };

  const removeSubItem = (itemId: string, subId: string) =>
    onChange(items.map(it => it.id === itemId
      ? { ...it, subItems: it.subItems.filter(s => s.id !== subId) }
      : it));

  const updateSubLabel = (itemId: string, subId: string, label: string) =>
    onChange(items.map(it => it.id === itemId
      ? { ...it, subItems: it.subItems.map(s => s.id === subId ? { ...s, label } : s) }
      : it));

  // ── Level 3 helpers ──────────────────────────────────────────────────────
  const addSubSubItem = (itemId: string, subId: string) => {
    const n: SubSubItem = { id: uid(), label: "" };
    onChange(items.map(it => it.id === itemId
      ? { ...it, subItems: it.subItems.map(s => s.id === subId
          ? { ...s, subItems: [...s.subItems, n] }
          : s) }
      : it));
  };

  const removeSubSubItem = (itemId: string, subId: string, ssId: string) =>
    onChange(items.map(it => it.id === itemId
      ? { ...it, subItems: it.subItems.map(s => s.id === subId
          ? { ...s, subItems: s.subItems.filter(ss => ss.id !== ssId) }
          : s) }
      : it));

  const updateSubSubLabel = (itemId: string, subId: string, ssId: string, label: string) =>
    onChange(items.map(it => it.id === itemId
      ? { ...it, subItems: it.subItems.map(s => s.id === subId
          ? { ...s, subItems: s.subItems.map(ss => ss.id === ssId ? { ...ss, label } : ss) }
          : s) }
      : it));

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-xs text-gray-400 italic py-2">{t("chatbotSetupMenuNoItems")}</p>
      )}

      {items.map((item, idx) => {
        const l1Open = expandedL1 === item.id;
        return (
          <div key={item.id} className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Level 1 row */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50">
              <GripVertical className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
              <span className="text-xs font-medium text-gray-400 w-5 flex-shrink-0">{idx + 1}.</span>
              <input
                className={inputCls + " flex-1 py-1.5 text-xs"}
                placeholder={t("chatbotSetupMenuItemPlaceholder")}
                value={item.label}
                onChange={e => updateItemLabel(item.id, e.target.value)}
              />
              <button
                type="button"
                onClick={() => setExpandedL1(l1Open ? null : item.id)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                {l1Open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="text-gray-300 hover:text-red-500 p-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Level 2 sub-items */}
            <AnimatePresence initial={false}>
              {l1Open && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="bg-white border-t border-gray-100 px-4 py-3 space-y-2">
                    <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                      {t("chatbotSetupMenuSubItems")}
                    </p>

                    {item.subItems.map((sub, si) => {
                      const l2Key = `${item.id}:${sub.id}`;
                      const l2Open = expandedL2 === l2Key;
                      return (
                        <div key={sub.id} className="border border-gray-100 rounded-lg overflow-hidden">
                          {/* Level 2 row */}
                          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50/60">
                            <span className="text-xs text-gray-400 w-5 flex-shrink-0">
                              {SUB_LABELS[si] ?? si + 1}.
                            </span>
                            <input
                              className={inputCls + " flex-1 py-1 text-xs"}
                              placeholder={t("chatbotSetupMenuSubItemPlaceholder")}
                              value={sub.label}
                              onChange={e => updateSubLabel(item.id, sub.id, e.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => setExpandedL2(l2Open ? null : l2Key)}
                              className="text-gray-400 hover:text-gray-600 p-0.5"
                            >
                              {l2Open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeSubItem(item.id, sub.id)}
                              className="text-gray-300 hover:text-red-500 p-0.5"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Level 3 sub-sub-items */}
                          <AnimatePresence initial={false}>
                            {l2Open && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.12 }}
                                className="overflow-hidden"
                              >
                                <div className="bg-gray-50/40 border-t border-gray-100 px-4 py-2.5 space-y-1.5">
                                  {sub.subItems.map((ss) => (
                                    <div key={ss.id} className="flex items-center gap-2">
                                      <span className="text-xs text-gray-300 w-3 flex-shrink-0">–</span>
                                      <input
                                        className={inputCls + " flex-1 py-1 text-xs bg-white"}
                                        placeholder={t("chatbotSetupMenuSubSubItemPlaceholder")}
                                        value={ss.label}
                                        onChange={e => updateSubSubLabel(item.id, sub.id, ss.id, e.target.value)}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => removeSubSubItem(item.id, sub.id, ss.id)}
                                        className="text-gray-300 hover:text-red-500 p-0.5"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => addSubSubItem(item.id, sub.id)}
                                    className="flex items-center gap-1 text-xs text-[#0F510F] hover:underline mt-0.5"
                                  >
                                    <Plus className="w-3 h-3" />
                                    {t("chatbotSetupMenuAddSubSubItem")}
                                  </button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => addSubItem(item.id)}
                      className="flex items-center gap-1.5 text-xs text-[#0F510F] hover:underline mt-1"
                    >
                      <Plus className="w-3 h-3" />
                      {t("chatbotSetupMenuAddSubItem")}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addItem}
        className="flex items-center gap-2 text-sm text-[#0F510F] border border-dashed border-[#0F510F]/40 rounded-lg px-4 py-2 w-full hover:bg-[#0F510F]/5 transition-colors"
      >
        <Plus className="w-4 h-4" />
        {t("chatbotSetupMenuAddItem")}
      </button>
    </div>
  );
}

// ── Skeleton bubble ───────────────────────────────────────────────────────────

function SkeletonBubble({ wide = false }: { wide?: boolean }) {
  return (
    <div className={`h-10 rounded-2xl bg-gray-200 animate-pulse ${wide ? "w-[72%]" : "w-[55%]"}`} />
  );
}

// ── First message preview ─────────────────────────────────────────────────────

function ChatBubble({ text, isUser = false }: { text: string; isUser?: boolean }) {
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] px-3.5 py-2 rounded-2xl shadow-sm ${isUser ? "bg-[#DCF8C6] rounded-tr-sm" : "bg-white rounded-tl-sm"}`}>
        <p className="text-[13px] text-gray-800 leading-snug whitespace-pre-wrap">{text}</p>
        <p className="text-[10px] text-gray-400 text-right mt-1">
          {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

function FirstMessagePreview({
  companyName,
  menuItems,
}: {
  companyName: string;
  menuItems: MenuItem[];
}) {
  const { t } = useLanguage();
  const name = companyName || "Your Business";

  const filtered = menuItems.filter(it => it.label.trim());
  const mainMenuText = filtered.length > 0
    ? `Welcome to ${name}! How can I help you today?\n\n` + filtered.map((it, i) => `${i + 1}. ${it.label}`).join("\n")
    : `Welcome to ${name}! How can I help you today?`;

  // Show sub-menu demo for the first item that has sub-items
  const firstWithSubs = filtered.find(it => it.subItems.some(s => s.label.trim()));
  const subMenuText = firstWithSubs
    ? firstWithSubs.subItems
        .filter(s => s.label.trim())
        .map((s, j) => `${SUB_LABELS[j] ?? j + 1}. ${s.label}`)
        .join("\n")
    : null;

  // Show sub-sub-menu demo for the first sub-item that has sub-sub-items
  const firstSubWithSubs = firstWithSubs?.subItems.find(s => s.subItems.some(ss => ss.label.trim()));
  const subSubMenuText = firstSubWithSubs
    ? firstSubWithSubs.subItems
        .filter(ss => ss.label.trim())
        .map(ss => `- ${ss.label}`)
        .join("\n")
    : null;

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm bg-white">
      <div className="bg-[#075E54] px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xs">{name.charAt(0).toUpperCase()}</span>
        </div>
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold truncate">{name}</p>
          <p className="text-white/60 text-xs">{t("chatbotSetupAiAssistant")}</p>
        </div>
      </div>
      <div className="bg-[#ECE5DD] px-3 py-4 space-y-2">
        <ChatBubble text={mainMenuText} />
        {subMenuText && (
          <>
            <ChatBubble text={`1`} isUser />
            <ChatBubble text={`Here are the options for ${firstWithSubs!.label}:\n\n${subMenuText}`} />
          </>
        )}
        {subSubMenuText && firstSubWithSubs && (
          <>
            <ChatBubble text={`${SUB_LABELS[firstWithSubs!.subItems.indexOf(firstSubWithSubs)]}`} isUser />
            <ChatBubble text={`For ${firstSubWithSubs.label}, choose one:\n\n${subSubMenuText}`} />
          </>
        )}
      </div>
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

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [conversation, loading]);

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-md bg-white">
      <div className="bg-[#075E54] px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">{name.charAt(0).toUpperCase()}</span>
        </div>
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold truncate">{name}</p>
          <p className="text-white/60 text-xs">{t("chatbotSetupAiAssistant")}</p>
        </div>
      </div>

      <div
        ref={chatRef}
        className="bg-[#ECE5DD] px-3 py-4 space-y-2.5 min-h-[400px] max-h-[540px] overflow-y-auto"
      >
        {!hasGenerated && !loading && (
          <div className="flex flex-col items-center justify-center h-64 space-y-2 text-center px-4">
            <div className="w-10 h-10 rounded-full bg-white/60 flex items-center justify-center">
              <Bot className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm text-gray-500 font-medium">{t("chatbotSetupEmptyTitle")}</p>
            <p className="text-xs text-gray-400">{t("chatbotSetupEmptyDesc")}</p>
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            <SkeletonBubble wide />
            <div className="flex justify-end"><SkeletonBubble /></div>
            <SkeletonBubble wide />
            <div className="flex justify-end"><SkeletonBubble /></div>
            <SkeletonBubble />
          </div>
        )}

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
                  <p className="text-[13px] text-gray-800 leading-snug whitespace-pre-wrap">{msg.text}</p>
                  <p className="text-[10px] text-gray-400 text-right mt-1">
                    {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

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

  // ── Config state ───────────────────────────────────────────────────────────
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);

  // ── Generation / demo state ────────────────────────────────────────────────
  const [conversation, setConversation] = useState<ConvMessage[]>([]);
  const [feedback, setFeedback]         = useState("");
  const [generating, setGenerating]     = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [genError, setGenError]         = useState<string | null>(null);

  // ── System prompt preview (returned by API after save) ────────────────────
  const [systemPromptPreview, setSystemPromptPreview] = useState<string | null>(null);

  // ── Autosave state ─────────────────────────────────────────────────────────
  type SaveStatus = "idle" | "saving" | "saved" | "error";
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const savePayloadRef = useRef({ config, conversation });
  savePayloadRef.current = { config, conversation };

  const userEditedRef  = useRef(false);
  const savedTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          // Prefer menu_config column over menuConfig inside structured_config
          // Normalise menu items: ensure every sub-item is an object with {id, label, subItems}
        // (old data may have plain strings if saved before this migration)
        const rawMenu: any[] = Array.isArray(data.menu_config) && data.menu_config.length > 0
            ? data.menu_config
            : (sc.menuConfig ?? []);
        const menuConfig: MenuItem[] = rawMenu.map((it: any) => ({
            id: it.id ?? uid(),
            label: it.label ?? "",
            subItems: (it.subItems ?? []).map((sub: any) =>
              typeof sub === "string"
                ? { id: uid(), label: sub, subItems: [] }
                : {
                    id: sub.id ?? uid(),
                    label: sub.label ?? "",
                    subItems: (sub.subItems ?? []).map((ss: any) =>
                      typeof ss === "string"
                        ? { id: uid(), label: ss }
                        : { id: ss.id ?? uid(), label: ss.label ?? "" }
                    ),
                  }
            ),
        }));
          setConfig({
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
            menuConfig,
          });
        }

        if (data.system_prompt_preview) {
          setSystemPromptPreview(data.system_prompt_preview);
        }

        const saved = data.demo_conversation;
        if (Array.isArray(saved) && saved.length > 0) {
          setConversation(saved);
          setHasGenerated(true);
        }
      })
      .catch(() => {});
  }, [isAuthenticated]);

  // ── Update helper — marks user edit ───────────────────────────────────────
  const updateConfig = useCallback((patch: Partial<Config>) => {
    userEditedRef.current = true;
    setConfig(prev => ({ ...prev, ...patch }));
  }, []);

  // ── Core save (reads from ref — stale-closure safe) ────────────────────────
  const doSave = useCallback(async (convOverride?: ConvMessage[]) => {
    const { config, conversation } = savePayloadRef.current;
    const convToSave = convOverride ?? conversation;
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/chatbot-config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          structured_config: config,
          override_active: false,
          raw_prompt: "",
          demo_conversation: convToSave,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || "Failed to save");
      }
      const data = await res.json();
      if (data.system_prompt_preview) setSystemPromptPreview(data.system_prompt_preview);
      setSaveStatus("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("error");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounced autosave on any config change ────────────────────────────────
  const configKey = JSON.stringify(config);
  useEffect(() => {
    if (!userEditedRef.current) return;
    const timer = setTimeout(() => doSave(), 2000);
    return () => clearTimeout(timer);
  }, [configKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate demo conversation ─────────────────────────────────────────────
  const generate = async (isFeedback = false) => {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/chatbot-config/generate-conversation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName:  config.businessName,
          description:  config.industry,
          services:     config.servicesText,
          menuConfig:   config.menuConfig,
          feedback:     isFeedback ? feedback : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || "Generation failed");
      }
      const data = await res.json();
      const newConv: ConvMessage[] = data.conversation ?? [];
      setConversation(newConv);
      setHasGenerated(true);
      if (isFeedback) setFeedback("");
      await doSave(newConv);
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

          {/* Page header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-[#0F510F]" />
              <h1 className="text-xl font-bold text-gray-900">{t("chatbotSetupTitle")}</h1>
            </div>
            {/* Autosave indicator */}
            <div className="flex items-center gap-1.5 text-xs min-w-[90px] justify-end">
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

          <div className="flex flex-col xl:flex-row gap-8 items-start">

            {/* ── Left column — steps ──────────────────────────────────────── */}
            <div className="w-full xl:flex-1 xl:min-w-0 space-y-4">

              {/* Step 1 — Business basics */}
              <StepCard
                step={1}
                title={t("chatbotSetupStep1Title")}
                desc={t("chatbotSetupStep1Desc")}
              >
                <div>
                  <label className={labelCls}>{t("chatbotSetupCompanyName")}</label>
                  <input
                    className={inputCls}
                    placeholder={t("chatbotSetupCompanyNamePlaceholder")}
                    value={config.businessName}
                    onChange={e => updateConfig({ businessName: e.target.value })}
                  />
                </div>

                <div>
                  <label className={labelCls}>{t("chatbotSetupBusinessDescLabel")}</label>
                  <p className={hintCls}>{t("chatbotSetupBusinessDescHint")}</p>
                  <textarea
                    className={inputCls + " resize-none mt-1.5"}
                    rows={3}
                    placeholder={t("chatbotSetupBusinessDescPlaceholder")}
                    value={config.industry}
                    onChange={e => updateConfig({ industry: e.target.value })}
                  />
                </div>
              </StepCard>

              {/* Step 2 — Menu editor */}
              <StepCard
                step={2}
                title={t("chatbotSetupStep2Title")}
                desc={t("chatbotSetupStep2Desc")}
              >
                <p className={hintCls + " !mt-0"}>{t("chatbotSetupMenuNote")}</p>

                <MenuEditor
                  items={config.menuConfig}
                  onChange={items => updateConfig({ menuConfig: items })}
                />

                {/* Live first-message preview when menu has items */}
                {config.menuConfig.some(it => it.label.trim()) && (
                  <div className="pt-2">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                      {t("chatbotSetupMenuFirstMessage")}
                    </p>
                    <FirstMessagePreview
                      companyName={config.businessName}
                      menuItems={config.menuConfig}
                    />
                  </div>
                )}
              </StepCard>

              {/* Step 3 — Additional info */}
              <StepCard
                step={3}
                title={t("chatbotSetupStep3Title")}
                desc={t("chatbotSetupStep3Desc")}
              >
                <div>
                  <label className={labelCls}>{t("chatbotSetupServices")}</label>
                  <p className={hintCls}>{t("chatbotSetupServicesHint")}</p>
                  <textarea
                    className={inputCls + " resize-none mt-1.5"}
                    rows={4}
                    placeholder={t("chatbotSetupServicesPlaceholder")}
                    value={config.servicesText}
                    onChange={e => updateConfig({ servicesText: e.target.value })}
                  />
                </div>

                {/* FAQ */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={labelCls + " !mb-0"}>{t("chatbotSetupFaqSectionLabel")}</label>
                    <button
                      type="button"
                      onClick={() => updateConfig({ faq: [...config.faq, { id: uid(), question: "", answer: "" }] })}
                      className="flex items-center gap-1 text-xs text-[#0F510F] hover:underline"
                    >
                      <Plus className="w-3 h-3" />
                      {t("chatbotSetupFaqAddBtn")}
                    </button>
                  </div>
                  <div className="space-y-3">
                    {config.faq.map((f, i) => (
                      <div key={f.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-400">Q{i + 1}</span>
                          <button
                            type="button"
                            onClick={() => updateConfig({ faq: config.faq.filter(x => x.id !== f.id) })}
                            className="text-gray-300 hover:text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <input
                          className={inputCls + " text-xs py-1.5"}
                          placeholder={t("chatbotSetupFaqQuestionPlaceholder")}
                          value={f.question}
                          onChange={e => updateConfig({ faq: config.faq.map(x => x.id === f.id ? { ...x, question: e.target.value } : x) })}
                        />
                        <textarea
                          className={inputCls + " resize-none text-xs py-1.5"}
                          rows={2}
                          placeholder={t("chatbotSetupFaqAnswerPlaceholder")}
                          value={f.answer}
                          onChange={e => updateConfig({ faq: config.faq.map(x => x.id === f.id ? { ...x, answer: e.target.value } : x) })}
                        />
                      </div>
                    ))}
                    {config.faq.length === 0 && (
                      <p className="text-xs text-gray-400 italic">{t("chatbotSetupMenuNoItems").replace("menu items", "FAQ items")}</p>
                    )}
                  </div>
                </div>
              </StepCard>

              {/* Step 4 — Bot behaviour */}
              <StepCard
                step={4}
                title={t("chatbotSetupStep4Title")}
                desc={t("chatbotSetupStep4Desc")}
              >
                {/* Tone */}
                <div>
                  <label className={labelCls}>{t("chatbotSetupToneLabel")}</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {TONES.map(tone => (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => updateConfig({ tone })}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          config.tone === tone
                            ? "bg-[#0F510F] text-white border-[#0F510F]"
                            : "bg-white text-gray-600 border-gray-200 hover:border-[#0F510F]/40"
                        }`}
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                  {config.tone === "Custom" && (
                    <input
                      className={inputCls + " mt-2"}
                      placeholder={t("chatbotSetupCustomTonePlaceholder")}
                      value={config.customTone}
                      onChange={e => updateConfig({ customTone: e.target.value })}
                    />
                  )}
                </div>

                {/* Greeting */}
                <div>
                  <label className={labelCls}>{t("chatbotSetupGreetingLabel")}</label>
                  <p className={hintCls}>{t("chatbotSetupGreetingHint")}</p>
                  <input
                    className={inputCls + " mt-1.5"}
                    placeholder={t("chatbotSetupGreetingPlaceholder")}
                    value={config.greeting}
                    onChange={e => updateConfig({ greeting: e.target.value })}
                  />
                </div>

                {/* Escalation rules */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <label className={labelCls + " !mb-0"}>{t("chatbotSetupEscalationLabel")}</label>
                      <p className={hintCls}>{t("chatbotSetupEscalationHint")}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateConfig({ escalationRules: [...config.escalationRules, { id: uid(), rule: "" }] })}
                      className="flex items-center gap-1 text-xs text-[#0F510F] hover:underline flex-shrink-0"
                    >
                      <Plus className="w-3 h-3" />
                      {t("chatbotSetupEscalationAddBtn")}
                    </button>
                  </div>
                  <div className="space-y-2 mt-2">
                    {config.escalationRules.map(er => (
                      <div key={er.id} className="flex items-center gap-2">
                        <input
                          className={inputCls + " flex-1 text-xs py-1.5"}
                          placeholder={t("chatbotSetupEscalationPlaceholder")}
                          value={er.rule}
                          onChange={e => updateConfig({ escalationRules: config.escalationRules.map(x => x.id === er.id ? { ...x, rule: e.target.value } : x) })}
                        />
                        <button
                          type="button"
                          onClick={() => updateConfig({ escalationRules: config.escalationRules.filter(x => x.id !== er.id) })}
                          className="text-gray-300 hover:text-red-500 flex-shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Closing message */}
                <div>
                  <label className={labelCls}>{t("chatbotSetupClosingLabel")}</label>
                  <p className={hintCls}>{t("chatbotSetupClosingHint")}</p>
                  <input
                    className={inputCls + " mt-1.5"}
                    placeholder={t("chatbotSetupClosingPlaceholder")}
                    value={config.closingMessage}
                    onChange={e => updateConfig({ closingMessage: e.target.value })}
                  />
                </div>
              </StepCard>

              {/* Step 5 — System prompt */}
              <StepCard
                step={5}
                title={t("chatbotSetupStep5Title")}
                desc={t("chatbotSetupStep5Desc")}
              >
                <label className={labelCls}>{t("chatbotSetupPromptLabel")}</label>
                {systemPromptPreview ? (
                  <textarea
                    readOnly
                    className={inputCls + " resize-none font-mono text-[11px] leading-relaxed bg-gray-50 cursor-default"}
                    rows={14}
                    value={systemPromptPreview}
                  />
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                    <p className="text-xs text-gray-400">{t("chatbotSetupPromptEmpty")}</p>
                  </div>
                )}
              </StepCard>

              {/* Demo regeneration section */}
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 pt-5 pb-4 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-900">{t("chatbotSetupSection1Title")}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{t("chatbotSetupSection1Desc")}</p>
                </div>
                <div className="px-5 py-4 space-y-3">
                  {genError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {genError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => generate(false)}
                    disabled={generating || !config.businessName.trim()}
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

                  <AnimatePresence>
                    {hasGenerated && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.15 }}
                        className="space-y-2 overflow-hidden"
                      >
                        <div className="pt-2 border-t border-gray-100">
                          <p className="text-xs font-medium text-gray-500 mb-1.5">{t("chatbotSetupFeedbackLabel")}</p>
                          <textarea
                            className={inputCls + " resize-none"}
                            rows={2}
                            placeholder={t("chatbotSetupFeedbackPlaceholder")}
                            value={feedback}
                            onChange={e => setFeedback(e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => generate(true)}
                            disabled={generating || !feedback.trim()}
                            className="flex items-center justify-center gap-2 w-full text-sm font-medium border border-[#0F510F] text-[#0F510F] px-5 py-2 rounded-lg hover:bg-[#0F510F]/5 disabled:opacity-50 transition-colors mt-2"
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
              </div>

            </div>

            {/* ── Right column — WhatsApp preview ────────────────────────── */}
            <div className="w-full xl:w-[320px] xl:shrink-0">
              <div className="xl:sticky xl:top-6">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2.5">
                  {t("chatbotSetupDemoLabel")}
                </p>
                <div className="h-[500px] xl:h-auto overflow-y-auto xl:overflow-visible rounded-2xl xl:rounded-none">
                  <WhatsAppPreview
                    companyName={config.businessName}
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
