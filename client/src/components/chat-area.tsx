import { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { Send, CheckCircle2, User, Bot, HeadphonesIcon, Info, ArrowLeft } from "lucide-react";
import { Button } from "./ui-elements";
import { cn } from "@/lib/utils";
import type { Message, Conversation } from "@shared/schema";
import { useSendMessage, useMessages } from "@/hooks/use-messages";
import { useCloseEscalation } from "@/hooks/use-escalations";

export function ChatArea({
  conversation,
  onClose
}: {
  conversation: Conversation | null;
  onClose: () => void
}) {
  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background text-muted-foreground">
        <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-border flex items-center justify-center mb-4">
          <HeadphonesIcon className="w-8 h-8 text-primary/40" />
        </div>
        <h3 className="text-xl font-medium text-foreground mb-2">Select a conversation</h3>
        <p className="text-sm">Choose a conversation from the sidebar to view messages and reply.</p>
      </div>
    );
  }

  return <ActiveChat conversation={conversation} onClose={onClose} />;
}

function ActiveChat({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const { data: messages = [], isLoading } = useMessages(conversation.customer_phone);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const { mutate: closeEscalation, isPending: isClosing } = useCloseEscalation();

  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isSending) return;
    sendMessage(
      { customer_phone: conversation.customer_phone, message: text },
      { onSuccess: () => setText("") }
    );
  };

  const handleClose = () => {
    if (confirm("Are you sure you want to close this conversation?")) {
      closeEscalation(conversation.customer_phone, {
        onSuccess: onClose
      });
    }
  };

  const isOpen = conversation.escalation_status !== 'closed';

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F7F9F7] relative">
      {/* Header */}
      <div className="h-16 px-6 border-b border-border/60 bg-white/50 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-inner shrink-0">
            <User className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground text-sm">{conversation.customer_phone}</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span className={cn("w-2 h-2 rounded-full", isOpen ? "bg-green-500" : "bg-gray-400")} />
              {isOpen ? 'Active' : 'Resolved'}
            </div>
          </div>
        </div>

        {isOpen && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            isLoading={isClosing}
            className="text-primary hover:text-primary hover:bg-primary/5 border-primary/20"
          >
            <CheckCircle2 className="w-4 h-4 mr-1.5" />
            Resolve Issue
          </Button>
        )}
      </div>

      {/* Escalation Reason Banner (only shown when there is an escalation record) */}
      {conversation.escalation_reason && (
        <div className="bg-orange-50 border-b border-orange-100 px-6 py-3 flex gap-3 text-sm">
          <Info className="w-5 h-5 text-orange-400 shrink-0" />
          <div>
            <span className="font-semibold text-orange-800">Escalation Reason: </span>
            <span className="text-orange-700">{conversation.escalation_reason}</span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg, idx) => {
          const showDate = idx === 0 ||
            new Date(msg.created_at!).getTime() - new Date(messages[idx-1].created_at!).getTime() > 1000 * 60 * 30;

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex justify-center mb-6 mt-2">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider bg-black/5 px-2 py-1 rounded-full">
                    {format(new Date(msg.created_at!), "MMM d, h:mm a")}
                  </span>
                </div>
              )}
              <MessageBubble message={msg} />
            </div>
          );
        })}
        {isLoading && messages.length === 0 && (
          <div className="flex justify-center">
            <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce mx-1" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce mx-1" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce mx-1" style={{ animationDelay: '300ms' }} />
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Composer — always visible so agent can reply regardless of status */}
      <div className="p-4 bg-white border-t border-border shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
          <form onSubmit={handleSend} className="max-w-4xl mx-auto flex gap-3 bg-muted/30 p-2 rounded-2xl border border-border/50 focus-within:border-primary/30 focus-within:bg-white transition-all">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onTouchEnd={(e) => (e.currentTarget as HTMLInputElement).focus()}
              placeholder="Reply to customer..."
              className="flex-1 bg-transparent border-none focus:ring-0 px-4 text-sm"
              disabled={isSending}
            />
            <Button
              type="submit"
              size="icon"
              className="w-10 h-10 rounded-xl flex-shrink-0"
              disabled={!text.trim() || isSending}
            >
              <Send className="w-4 h-4 ml-0.5" />
            </Button>
          </form>
          <div className="text-center mt-2 text-[10px] text-muted-foreground">
            Sending as Agent • <span className="font-medium text-primary">SMS Message</span>
          </div>
        </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isCustomer = message.sender === 'customer';
  const isAI = message.sender === 'ai';
  const isAgent = message.sender === 'agent';

  return (
    <div className={cn(
      "flex w-full mb-2",
      isCustomer ? "justify-start" : "justify-end"
    )}>
      <div className={cn(
        "max-w-[75%] flex flex-col",
        isCustomer ? "items-start" : "items-end"
      )}>
        <div className="flex items-center gap-1.5 mb-1.5 px-1">
          {isAI && <Bot className="w-3 h-3 text-secondary" />}
          {isAgent && <HeadphonesIcon className="w-3 h-3 text-primary" />}
          <span className="text-[11px] font-medium text-muted-foreground">
            {isCustomer ? 'Customer' : isAI ? 'AI Assistant' : 'You'}
          </span>
        </div>

        <div className={cn(
          "px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed shadow-sm",
          isCustomer
            ? "bg-white text-foreground border border-border/40 rounded-tl-sm"
            : isAI
              ? "bg-secondary text-white rounded-tr-sm"
              : "bg-primary text-white rounded-tr-sm"
        )}>
          {message.message_text}
        </div>
        <span className="text-[10px] text-muted-foreground mt-1 px-1">
          {format(new Date(message.created_at!), "h:mm a")}
        </span>
      </div>
    </div>
  );
}
