import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useConversations } from "@/hooks/use-conversations";
import { useVisibilityRefetch } from "@/hooks/use-visibility-refetch";
import DashboardLayout from "@/components/DashboardLayout";
import { Sidebar } from "@/components/sidebar";
import { ChatArea } from "@/components/chat-area";

function BrandingWarning() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    fetch("/api/settings/branding", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((data: { brandName: string } | null) => {
        if (data && !data.brandName) setShow(true);
      })
      .catch(() => {});
  }, []);

  if (!show) return null;
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800 flex items-center gap-2">
      <span>⚠</span>
      <span>
        Please set your Brand Name in{" "}
        <a href="/settings" className="underline font-medium">Settings → Branding</a>.
      </span>
    </div>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { data: conversations = [], isLoading: isEscalationsLoading } = useConversations();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);

  useVisibilityRefetch();

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthLoading, isAuthenticated, setLocation]);

  useEffect(() => {
    if (!selectedPhone || !isAuthenticated) return;
    fetch(`/api/notifications/mark-read/${encodeURIComponent(selectedPhone)}`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
  }, [selectedPhone, isAuthenticated]);

  const selectedConversation = conversations.find(c => c.customer_phone === selectedPhone) ?? null;

  return (
    <DashboardLayout noPadding>
      <BrandingWarning />
      <div className="flex h-full overflow-hidden">
        {/* Conversation list */}
        <div className={`${selectedPhone ? "hidden md:flex" : "flex w-full md:w-80"} md:w-80 h-full shrink-0`}>
          {isEscalationsLoading ? (
            <div className="w-full h-full border-e border-gray-200 bg-white flex flex-col">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-4 border-b border-gray-100 animate-pulse flex gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-100 shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                    <div className="h-2 bg-gray-100 rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Sidebar
              conversations={conversations}
              selectedPhone={selectedPhone}
              onSelect={setSelectedPhone}
            />
          )}
        </div>
        {/* Chat area */}
        <div className={`${selectedPhone ? "flex" : "hidden md:flex"} flex-1 min-w-0`}>
          <ChatArea
            conversation={selectedConversation}
            onClose={() => setSelectedPhone(null)}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
