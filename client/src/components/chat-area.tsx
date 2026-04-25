import { useState, useRef, useEffect, useCallback } from "react";
import { format, isToday, isYesterday } from "date-fns";
import {
  Send, CheckCircle2, Bot, HeadphonesIcon, Info, ArrowLeft,
  UserCheck, Mic, Check, Search, MoreVertical, Smile, Paperclip,
  Play, Pause, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import type { Message, Conversation } from "@shared/schema";
import { useSendMessage, useMessages } from "@/hooks/use-messages";
// ESCALATION — hidden for now
// import { useCloseEscalation } from "@/hooks/use-escalations";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

/* ────────────────────────────────────────────────────────────
   WhatsApp SVG wallpaper pattern — identical doodle background
   ──────────────────────────────────────────────────────────── */
const WA_WALLPAPER = `url("data:image/svg+xml,%3Csvg width='400' height='400' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='p' width='200' height='200' patternUnits='userSpaceOnUse'%3E%3Cpath d='M20 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm80 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-40 40a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm80 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-80 40a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm80 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-40 40a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm80 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-120 40a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm80 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' fill='%23d0cbc4' fill-opacity='0.15'/%3E%3Cpath d='M10 50l8-4-8-4zm40 0l8-4-8-4zm40 0l8-4-8-4zm40 0l8-4-8-4zm-100 80l8-4-8-4zm40 0l8-4-8-4zm40 0l8-4-8-4zm40 0l8-4-8-4z' fill='%23d0cbc4' fill-opacity='0.08'/%3E%3Ccircle cx='30' cy='30' r='1.5' fill='%23d0cbc4' fill-opacity='0.12'/%3E%3Ccircle cx='90' cy='30' r='1.5' fill='%23d0cbc4' fill-opacity='0.12'/%3E%3Ccircle cx='150' cy='30' r='1.5' fill='%23d0cbc4' fill-opacity='0.12'/%3E%3Ccircle cx='30' cy='90' r='1.5' fill='%23d0cbc4' fill-opacity='0.12'/%3E%3Ccircle cx='90' cy='90' r='1.5' fill='%23d0cbc4' fill-opacity='0.12'/%3E%3Ccircle cx='150' cy='90' r='1.5' fill='%23d0cbc4' fill-opacity='0.12'/%3E%3Ccircle cx='30' cy='150' r='1.5' fill='%23d0cbc4' fill-opacity='0.12'/%3E%3Ccircle cx='90' cy='150' r='1.5' fill='%23d0cbc4' fill-opacity='0.12'/%3E%3Ccircle cx='150' cy='150' r='1.5' fill='%23d0cbc4' fill-opacity='0.12'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='400' height='400' fill='%23ECE5DD'/%3E%3Crect width='400' height='400' fill='url(%23p)'/%3E%3C/svg%3E")`;

/* ────────────────────────────────────────────────────────────
   Date separator formatting — "Today", "Yesterday", "Mar 28"
   ──────────────────────────────────────────────────────────── */
function formatDateSeparator(date: Date): string {
  if (isToday(date)) return "TODAY";
  if (isYesterday(date)) return "YESTERDAY";
  return format(date, "MMMM d, yyyy").toUpperCase();
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/* ────────────────────────────────────────────────────────────
   Read receipt ticks — WhatsApp style
   ──────────────────────────────────────────────────────────── */
function ReadReceipt({ isCustomer }: { isCustomer: boolean }) {
  if (isCustomer) return null;
  // Double blue ticks for sent messages (delivered + read)
  return (
    <span className="inline-flex ml-1 -mr-0.5">
      <svg width="16" height="11" viewBox="0 0 16 11" className="text-[#53bdeb]">
        <path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-2.011-2.095a.463.463 0 0 0-.336-.153.457.457 0 0 0-.344.153.441.441 0 0 0 0 .637l2.345 2.442a.452.452 0 0 0 .336.153.465.465 0 0 0 .372-.178l6.541-8.07a.45.45 0 0 0-.028-.601z" fill="currentColor" />
        <path d="M15.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-1.2-1.25-.735.908 1.6 1.667a.452.452 0 0 0 .336.153.465.465 0 0 0 .372-.178l6.541-8.07a.45.45 0 0 0-.04-.642z" fill="currentColor" />
      </svg>
    </span>
  );
}

/* ────────────────────────────────────────────────────────────
   WhatsApp-style bubble tail SVG
   ──────────────────────────────────────────────────────────── */
function BubbleTail({ side, color }: { side: "left" | "right"; color: string }) {
  if (side === "left") {
    return (
      <span className="absolute -left-2 top-0 w-3 h-3" aria-hidden>
        <svg viewBox="0 0 8 13" width="8" height="13">
          <path d="M1.533 3.568 8 0v13c-2.5-3.5-4.5-6-6.467-9.432Z" fill={color} />
        </svg>
      </span>
    );
  }
  return (
    <span className="absolute -right-2 top-0 w-3 h-3" aria-hidden>
      <svg viewBox="0 0 8 13" width="8" height="13">
        <path d="M6.467 3.568 0 0v13c2.5-3.5 4.5-6 6.467-9.432Z" fill={color} />
      </svg>
    </span>
  );
}

/* ────────────────────────────────────────────────────────────
   Voice note waveform player — WhatsApp style
   ──────────────────────────────────────────────────────────── */
function VoiceNotePlayer({ message, isCustomer }: { message: Message; isCustomer: boolean }) {
  const { t } = useLanguage();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animRef = useRef<number>(0);
  const hasTranscription = message.transcription && message.transcription.trim().length > 0;

  const tick = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setProgress(a.duration ? a.currentTime / a.duration : 0);
    if (!a.paused) animRef.current = requestAnimationFrame(tick);
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setPlaying(true);
      animRef.current = requestAnimationFrame(tick);
    } else {
      a.pause();
      setPlaying(false);
      cancelAnimationFrame(animRef.current);
    }
  };

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const formatDur = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Generate pseudo-random waveform bars from message id
  const bars = Array.from({ length: 32 }, (_, i) => {
    const seed = ((message.id ?? 0) * 7 + i * 13) % 100;
    return 0.15 + (seed / 100) * 0.85;
  });

  return (
    <div className="flex flex-col gap-1.5 min-w-[240px]">
      {message.media_url && (
        <audio
          ref={audioRef}
          src={message.media_url}
          preload="metadata"
          onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
          onEnded={() => { setPlaying(false); setProgress(0); }}
        />
      )}
      <div className="flex items-center gap-2.5">
        {/* Avatar / play button */}
        <button
          onClick={toggle}
          disabled={!message.media_url}
          className={cn(
            "w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-colors",
            isCustomer ? "bg-gray-200" : "bg-[#00a884]/20"
          )}
        >
          {playing ? (
            <Pause className={cn("w-5 h-5", isCustomer ? "text-gray-600" : "text-[#00a884]")} />
          ) : (
            <Play className={cn("w-5 h-5 ml-0.5", isCustomer ? "text-gray-600" : "text-[#00a884]")} />
          )}
        </button>

        {/* Waveform + duration */}
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex items-end gap-px h-5">
            {bars.map((h, i) => (
              <div
                key={i}
                className={cn(
                  "w-[3px] rounded-full transition-colors duration-75",
                  i / bars.length <= progress
                    ? (isCustomer ? "bg-gray-600" : "bg-[#00a884]")
                    : (isCustomer ? "bg-gray-300" : "bg-[#00a884]/30")
                )}
                style={{ height: `${h * 100}%` }}
              />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">
              {duration > 0 ? formatDur(playing ? progress * duration : duration) : "0:00"}
            </span>
            <Mic className={cn("w-3 h-3", isCustomer ? "text-gray-400" : "text-[#00a884]/60")} />
          </div>
        </div>
      </div>

      {/* Transcription */}
      {hasTranscription && (
        <div className="text-[11px] text-gray-500 italic bg-black/[0.03] rounded-md px-2 py-1.5 mt-0.5">
          <FileText className="w-3 h-3 inline mr-1 -mt-0.5 text-gray-400" />
          {t("voiceNoteTranscription")}: {message.transcription}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   MAIN EXPORT — ChatArea
   ════════════════════════════════════════════════════════════ */
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
      <div
        className="flex-1 flex flex-col items-center justify-center"
        style={{ background: WA_WALLPAPER, backgroundSize: "400px 400px" }}
      >
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg px-8 py-10 flex flex-col items-center max-w-sm text-center">
          <div className="w-16 h-16 bg-[#00a884]/10 rounded-full flex items-center justify-center mb-4">
            <HeadphonesIcon className="w-8 h-8 text-[#00a884]" />
          </div>
          <h3 className="text-xl font-light text-gray-700 mb-2">{t("chatSelectConversation")}</h3>
          <p className="text-sm text-gray-400">{t("chatSelectPrompt")}</p>
        </div>
      </div>
    );
  }

  return <ActiveChat conversation={conversation} onClose={onClose} />;
}

/* ────────────────────────────────────────────────────────────
   ActiveChat — full WhatsApp Web chat pane
   ──────────────────────────────────────────────────────────── */
interface Agent { id: number; name: string; email: string; is_active: boolean; }

function ActiveChat({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const { data: messages = [], isLoading } = useMessages(conversation.customer_phone);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  // ESCALATION — hidden for now
  // const { mutate: closeEscalation, isPending: isClosing } = useCloseEscalation();
  const { isAdmin } = useAuth();
  const { toast } = useToast();

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

  // ESCALATION — hidden for now
  // const handleReassign = async (agentId: string) => {
  //   setReassigning(true);
  //   try {
  //     await fetch(`/api/escalations/${encodeURIComponent(conversation.customer_phone)}/assign`, {
  //       method: "PATCH",
  //       headers: { "Content-Type": "application/json" },
  //       credentials: "include",
  //       body: JSON.stringify({ agentId: agentId === "unassign" ? null : Number(agentId) }),
  //     });
  //   } finally {
  //     setReassigning(false);
  //   }
  // };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isSending) return;
    sendMessage(
      { customer_phone: conversation.customer_phone, message: text },
      {
        onSuccess: () => setText(""),
        onError: (err: Error) => {
          toast({
            title: "Message not sent",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  // ESCALATION — hidden for now
  // const handleClose = () => {
  //   if (confirm(t("chatConfirmResolve"))) {
  //     closeEscalation(conversation.customer_phone, { onSuccess: onClose });
  //   }
  // };

  const isOpen = conversation.escalation_status !== "closed";
  const phoneStr = conversation.customer_phone;
  const avatarInitials = phoneStr.startsWith("+") ? phoneStr.slice(1, 3) : phoneStr.slice(-2);

  return (
    <div className="flex-1 flex flex-col h-full relative">
      {/* ─── WhatsApp green header bar ─── */}
      <div className="px-4 py-2 bg-[#008069] flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full bg-[#DFE5E7] flex items-center justify-center">
            <span className="text-sm font-bold text-[#54656f]">{avatarInitials}</span>
          </div>
          {/* Name + status */}
          <div>
            <div className="text-[15px] font-medium text-white leading-tight">{conversation.customer_phone}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn(
                "w-2 h-2 rounded-full",
                isOpen ? "bg-[#25D366]" : "bg-gray-400"
              )} />
              <span className="text-[12px] text-white/70">
                {isOpen ? t("chatStatusOnline") : t("chatStatusOffline")}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* ESCALATION — hidden for now */}
          {/* Admin reassign */}
          {/* {isAdmin && agents.length > 0 && (
            <div className="flex items-center gap-1.5 mr-2">
              <UserCheck className="w-4 h-4 text-white/60" />
              <select
                disabled={reassigning}
                value={conversation.assigned_agent_id ?? "unassign"}
                onChange={e => handleReassign(e.target.value)}
                className="text-xs border border-white/20 rounded-lg px-2 py-1 bg-white/10 text-white focus:outline-none disabled:opacity-50"
              >
                <option value="unassign" className="text-gray-800">{t("chatUnassigned")}</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id} className="text-gray-800">{a.name}</option>
                ))}
              </select>
            </div>
          )} */}
          {/* Resolve button */}
          {/* {isOpen && (
            <button
              onClick={handleClose}
              disabled={isClosing}
              className="flex items-center gap-1.5 text-xs font-medium text-white border border-white/30 px-3 py-1.5 rounded-lg hover:bg-white/10 disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t("chatResolveIssue")}
            </button>
          )} */}
          <button className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
            <Search className="w-[18px] h-[18px] text-white/80" />
          </button>
          <button className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
            <MoreVertical className="w-[18px] h-[18px] text-white/80" />
          </button>
        </div>
      </div>

      {/* ESCALATION — hidden for now */}
      {/* {conversation.escalation_reason && (
        <div className="bg-[#FFF3CD] border-b border-[#FFE69C] px-4 py-2 flex gap-3 text-sm shrink-0 z-10">
          <Info className="w-4 h-4 text-[#997404] shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-[#664D03]">{t("chatEscalationReason")} </span>
            <span className="text-[#664D03]/80">{conversation.escalation_reason}</span>
          </div>
        </div>
      )} */}

      {/* ─── Messages area with wallpaper ─── */}
      <div
        className="flex-1 overflow-y-auto px-[6%] md:px-[10%] lg:px-[14%] py-3"
        style={{ background: WA_WALLPAPER, backgroundSize: "400px 400px" }}
      >
        {messages.map((msg, idx) => {
          const msgDate = new Date(msg.created_at!);
          const prevDate = idx > 0 ? new Date(messages[idx - 1].created_at!) : null;
          const showDateSep = idx === 0 || (prevDate && !isSameDay(msgDate, prevDate));
          const isFirst = idx === 0 || messages[idx - 1].sender !== msg.sender || !!showDateSep;
          return (
            <div key={msg.id}>
              {showDateSep && (
                <div className="flex justify-center my-3">
                  <span className="text-[11px] font-medium text-[#54656f] bg-white rounded-lg px-3 py-1.5 shadow-sm">
                    {formatDateSeparator(msgDate)}
                  </span>
                </div>
              )}
              <MessageBubble message={msg} showTail={isFirst} />
            </div>
          );
        })}

        {/* Loading indicator */}
        {isLoading && messages.length === 0 && (
          <div className="flex justify-center py-8">
            <div className="bg-white rounded-lg px-4 py-2 shadow-sm flex gap-1.5">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* ─── Composer — WhatsApp Web style ─── */}
      <div className="bg-[#F0F2F5] border-t border-[#E9EDEF] px-3 py-2 shrink-0">
        <form onSubmit={handleSend} className="flex items-center gap-2">
          {/* Emoji icon */}
          <button type="button" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors shrink-0">
            <Smile className="w-[22px] h-[22px] text-[#54656f]" />
          </button>
          {/* Attachment icon */}
          <button type="button" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors shrink-0">
            <Paperclip className="w-[22px] h-[22px] text-[#54656f] rotate-45" />
          </button>
          {/* Text input */}
          <div className="flex-1 bg-white rounded-lg px-3 py-2 shadow-sm">
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={t("chatReplyPlaceholder")}
              className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-[15px] text-[#111b21] placeholder:text-[#667781]"
              disabled={isSending}
            />
          </div>
          {/* Send / Mic icon */}
          {text.trim() ? (
            <button
              type="submit"
              disabled={isSending}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors shrink-0"
            >
              <Send className="w-[22px] h-[22px] text-[#54656f]" />
            </button>
          ) : (
            <button type="button" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors shrink-0">
              <Mic className="w-[22px] h-[22px] text-[#54656f]" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   MessageBubble — WhatsApp Web identical
   ──────────────────────────────────────────────────────────── */
function MessageBubble({ message, showTail }: { message: Message; showTail: boolean }) {
  const { t, isRTL } = useLanguage();
  const isCustomer = message.sender === "customer";
  const isAI = message.sender === "ai";
  const isVoiceNote = message.media_type === "audio";

  const bubbleColor = isCustomer ? "#FFFFFF" : "#D9FDD3";
  const time = format(new Date(message.created_at!), "h:mm a");

  return (
    <div className={cn(
      "flex w-full",
      isCustomer ? "justify-start" : "justify-end",
      showTail ? "mt-2" : "mt-[2px]"
    )}>
      <div className={cn("relative max-w-[65%]", showTail ? (isCustomer ? "ml-0" : "mr-0") : (isCustomer ? "ml-2" : "mr-2"))}>
        {/* Tail */}
        {showTail && <BubbleTail side={isCustomer ? "left" : "right"} color={bubbleColor} />}

        {/* Bubble */}
        <div
          className={cn(
            "rounded-lg px-2.5 pb-1 pt-1.5 shadow-sm relative",
            isCustomer
              ? "rounded-tl-none"
              : "rounded-tr-none"
          )}
          style={{ backgroundColor: bubbleColor }}
        >
          {/* Sender label for AI / Agent */}
          {!isCustomer && showTail && (
            <div className={cn(
              "text-[12px] font-medium mb-0.5 leading-tight",
              isAI ? "text-[#00a884]" : "text-[#1FA855]"
            )}>
              {isAI && <Bot className="w-3 h-3 inline mr-0.5 -mt-0.5" />}
              {isAI ? t("chatSenderAI") : t("chatSenderYou")}
            </div>
          )}

          {/* Content */}
          {isVoiceNote ? (
            <VoiceNotePlayer message={message} isCustomer={isCustomer} />
          ) : (
            <span
              className="text-[14.2px] leading-[19px] text-[#111b21] whitespace-pre-wrap break-words block"
              dir={isRTL ? "rtl" : "ltr"}
              style={isRTL ? { textAlign: "right" } : undefined}
            >
              {message.message_text}
            </span>
          )}

          {/* Inline timestamp + read receipts — bottom right inside bubble */}
          <span className="float-right flex items-center gap-0.5 mt-1 ml-3 -mb-0.5 relative top-[3px]">
            <span className="text-[11px] text-[#667781] leading-none">{time}</span>
            <ReadReceipt isCustomer={isCustomer} />
          </span>
          {/* Clear float */}
          <span className="clear-both block h-0" />
        </div>
      </div>
    </div>
  );
}
