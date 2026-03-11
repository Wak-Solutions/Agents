import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Escalation } from "@shared/schema";

interface SidebarProps {
  escalations: Escalation[];
  selectedPhone: string | null;
  onSelect: (phone: string) => void;
}

export function Sidebar({ escalations, selectedPhone, onSelect }: SidebarProps) {
  const openEscalations = escalations.filter(e => e.status === 'open');
  const closedEscalations = escalations.filter(e => e.status === 'closed');

  return (
    <div className="w-full md:w-80 h-full bg-card border-r border-border flex flex-col z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
      <div className="p-4 border-b border-border/50 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Inbox className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">Inbox</h2>
          <p className="text-xs text-muted-foreground">{openEscalations.length} open escalations</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {escalations.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm mt-10">
            <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-20" />
            No conversations yet
          </div>
        ) : (
          <>
            {openEscalations.length > 0 && (
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-2">
                Needs Attention
              </div>
            )}
            {openEscalations.map(esc => (
              <ConversationItem 
                key={esc.customer_phone} 
                escalation={esc} 
                isSelected={selectedPhone === esc.customer_phone}
                onClick={() => onSelect(esc.customer_phone)}
              />
            ))}

            {closedEscalations.length > 0 && (
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-6">
                Resolved
              </div>
            )}
            {closedEscalations.map(esc => (
              <ConversationItem 
                key={esc.customer_phone} 
                escalation={esc} 
                isSelected={selectedPhone === esc.customer_phone}
                onClick={() => onSelect(esc.customer_phone)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ConversationItem({ escalation, isSelected, onClick }: { escalation: Escalation, isSelected: boolean, onClick: () => void }) {
  const timeAgo = escalation.created_at 
    ? formatDistanceToNow(new Date(escalation.created_at), { addSuffix: true }) 
    : '';

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-xl transition-all duration-200 group flex gap-3 relative",
        isSelected ? "bg-primary/5 border-primary/20 border" : "hover:bg-muted border border-transparent"
      )}
    >
      {escalation.status === 'open' && !isSelected && (
        <span className="absolute top-4 right-4 w-2 h-2 rounded-full bg-primary" />
      )}
      
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center flex-shrink-0 border border-primary/10">
        <span className="text-primary font-medium text-sm">
          {escalation.customer_phone.slice(-2)}
        </span>
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline mb-0.5">
          <span className={cn(
            "text-sm font-semibold truncate block",
            isSelected ? "text-primary" : "text-foreground"
          )}>
            {escalation.customer_phone}
          </span>
          <span className="text-[10px] text-muted-foreground flex-shrink-0 whitespace-nowrap ml-2">
            {timeAgo}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate line-clamp-1 group-hover:text-foreground/70 transition-colors">
          {escalation.escalation_reason}
        </p>
      </div>
    </button>
  );
}
