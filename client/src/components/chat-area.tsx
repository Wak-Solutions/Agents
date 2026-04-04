import { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { Send, CheckCircle2, Bot, HeadphonesIcon, Info, ArrowLeft, UserCheck, Mic, CheckCheck, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import type { Message, Conversation } from "@shared/schema";
import { useSendMessage, useMessages } from "@/hooks/use-messages";
import { useCloseEscalation } from "@/hooks/use-escalations";
import { useAuth } from "@/hooks/use-auth";

export function ChatArea({
  conversation,
  onClose,
}: {
  conversation: Conversation | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 text-gray-400">
        <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-gray-200 flex items-center justify-center mb-4">
          <HeadphonesIcon className="w-8 h-8 text-[#0F510F]/30" />
        </div>
        <h3 className="text-xl font-medium text-gray-800 mb-2">{t("chatSelectConversation")}</h3>
        <p className="text-sm">{t("chatSelectPrompt")}</p>
      </div>
    );
  }

  return <ActiveChat conversation={conversation} onClose={onClose} />;
}

interface Agent { id: number; name: string; email: string; is_active: boolean; }

function ActiveChat({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const { data: messages = [], isLoading } = useMessages(conversation.customer_phone);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const { mutate: closeEscalation, isPending: isClosing } = useCloseEscalation();
  const { isAdmin } = useAuth();

  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [reassigning, setReassigning] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    if (isAdmin) {
      fetch("/api/agents", { credentials: "include" })
        .then(r => (r.ok ? r.json() : []))
        .then(data => setAgents(data.filter((a: Agent) => a.is_active)))
        .catch(() => {});
    }
  }, [isAdmin]);

  const handleReassign = async (agentId: string) => {
    setReassigning(true);
    try {
      await fetch(`/api/escalations/${encodeURIComponent(conversation.customer_phone)}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agentId: agentId === "unassign" ? null : Number(agentId) }),
      });
    } finally {
      setReassigning(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isSending) return;
    sendMessage(
      { customer_phone: conversation.customer_phone, message: text },
      { onSuccess: () => setText("") },
    );
  };

  const handleClose = () => {
    if (confirm(t("chatConfirmResolve"))) {
      closeEscalation(conversation.customer_phone, { onSuccess: onClose });
    }
  };

  const isOpen = conversation.escalation_status !== "closed";

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F0EDE8] relative">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
          <div className="w-8 h-8 rounded-full bg-[#0F510F]/10 flex items-center justify-center">
            <span className="text-xs font-bold text-[#0F510F]">{conversation.customer_phone.slice(-2)}</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">{conversation.customer_phone}</div>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className={cn("w-1.5 h-1.5 rounded-full", isOpen ? "bg-green-500" : "bg-gray-400")} />
              {isOpen ? t("chatStatusActive") : t("chatStatusResolved")}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && agents.length > 0 && (
            <div className="flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-gray-400" />
              <select
                disabled={reassigning}
                value={conversation.assigned_agent_id ?? "unassign"}
                onChange={e => handleReassign(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#0F510F]/30 disabled:opacity-50"
              >
                <option value="unassign">{t("chatUnassigned")}</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}
          {isOpen && (
            <button
              onClick={handleClose}
              disabled={isClosing}
              className="flex items-center gap-1.5 text-xs font-medium text-[#0F510F] border border-[#0F510F]/20 px-3 py-1.5 rounded-lg hover:bg-[#0F510F]/5 disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t("chatResolveIssue")}
            </button>
          )}
        </div>
      </div>

      {/* Escalation reason */}
      {conversation.escalation_reason && (
        <div className="bg-orange-50 border-b border-orange-100 px-4 py-2.5 flex gap-3 text-sm shrink-0">
          <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-orange-800">{t("chatEscalationReason")} </span>
            <span className="text-orange-700">{conversation.escalation_reason}</span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.map((msg, idx) => {
          const showDate =
            idx === 0 ||
            new Date(msg.created_at!).getTime() - new Date(messages[idx - 1].created_at!).getTime() > 1000 * 60 * 30;
          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex justify-center mb-4 mt-2">
                  <span className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider bg-white/80 px-2.5 py-1 rounded-full shadow-sm">
                    {format(new Date(msg.created_at!), "MMM d, h:mm a")}
                  </span>
                </div>
              )}
              <MessageBubble message={msg} />
            </div>
          );
        })}
        {isLoading && messages.length === 0 && (
          <div className="flex justify-center py-8">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce mx-1" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce mx-1" style={{ animationDelay: "150ms" }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce mx-1" style={{ animationDelay: "300ms" }} />
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Composer */}
      <div
        className="bg-white border-t border-gray-200 px-4 py-2 shrink-0"
        onTouchStart={() => {
          const el = inputRef.current;
          if (!el) return;
          el.readOnly = false;
          el.focus();
        }}
      >
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <div className="flex-1 bg-gray-100 rounded-full px-4 py-2">
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={t("chatReplyPlaceholder")}
              className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm text-gray-800 placeholder:text-gray-400"
              disabled={isSending}
            />
          </div>
          <button
            type="submit"
            disabled={!text.trim() || isSending}
            className="w-9 h-9 bg-[#0F510F] rounded-full flex items-center justify-center disabled:opacity-40 transition-opacity shrink-0"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </form>
        <div className="text-center mt-1.5 text-[10px] text-gray-400">
          {t("chatSendingAs")} · <span className="font-medium text-[#0F510F]">{t("chatSendingAsSMS")}</span>
        </div>
      </div>
    </div>
  );
}

function VoiceNoteBubble({ message, isCustomer }: { message: Message; isCustomer: boolean }) {
  const { t } = useLanguage();
  const hasTranscription = message.transcription && message.transcription.trim().length > 0;

  return (
    <div className={cn(
      "px-3 py-2 rounded-xl shadow-sm min-w-[220px] max-w-full",
      isCustomer ? "bg-white text-gray-800" : "bg-gray-100 text-gray-800 border border-gray-200"
    )}>
      <div className="flex items-center gap-2 mb-2">
        <div className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
          isCustomer ? "bg-[#0F510F]/10" : "bg-[#0F510F]/10"
        )}>
          <Mic className="w-3.5 h-3.5 text-[#0F510F]" />
        </div>
        <span className="text-[10px] font-semibold text-gray-500">{t("voiceNote")}</span>
      </div>
      {message.media_url && (
        <audio controls preload="none" src={message.media_url} className="w-full h-8 mb-2" />
      )}
      {hasTranscription ? (
        <div className="text-[10px] text-gray-500 italic bg-gray-50 rounded px-2 py-1">
          <FileText className="w-3 h-3 inline mr-0.5 -mt-0.5" /> {t("voiceNoteTranscription")}: {message.transcription}
        </div>
      ) : (
        !message.media_url && (
          <p className="text-[13px] italic text-gray-400">{t("voiceNoteUnavailable")}</p>
        )
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const { t } = useLanguage();
  const isCustomer = message.sender === "customer";
  const isAI = message.sender === "ai";
  const isVoiceNote = message.media_type === "audio";

  return (
    <div className={cn("flex w-full mb-1", isCustomer ? "justify-start" : "justify-end")}>
      <div className={cn("max-w-[75%] flex flex-col", isCustomer ? "items-start" : "items-end")}>
        {isVoiceNote ? (
          <VoiceNoteBubble message={message} isCustomer={isCustomer} />
        ) : (
          <div className={cn(
            "px-3 py-2 rounded-xl shadow-sm text-[13px] leading-relaxed",
            isCustomer
              ? "bg-white text-gray-800"
              : isAI
                ? "bg-gray-100 text-gray-800 border border-gray-200"
                : "bg-[#DCF8C6] text-gray-800"
          )}>
            {!isCustomer && (
              <div className={cn(
                "text-[10px] font-semibold mb-0.5",
                isAI ? "text-[#408440]" : "text-blue-600"
              )}>
                {isAI && <Bot className="w-3 h-3 inline mr-0.5 -mt-0.5" />}
                {isAI ? t("chatSenderAI") : t("chatSenderYou")}
              </div>
            )}
            {message.message_text}
          </div>
        )}
        <div className="flex items-center gap-1 mt-0.5 px-1">
          <span className="text-[10px] text-gray-400">{format(new Date(message.created_at!), "h:mm a")}</span>
          {!isCustomer && <CheckCheck className="w-3 h-3 text-blue-400" />}
        </div>
      </div>
    </div>
  );
}
