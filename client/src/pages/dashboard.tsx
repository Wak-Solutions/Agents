import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { LogOut, Wifi, WifiOff, Fingerprint, Bell, Share, X } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { useConversations } from "@/hooks/use-conversations";
import { usePushNotifications } from "@/hooks/use-push";
import { Sidebar } from "@/components/sidebar";
import { ChatArea } from "@/components/chat-area";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { mutate: logout } = useLogout();
  const { data: conversations = [], isLoading: isEscalationsLoading, isFetching } = useConversations();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);

  const { showBanner, showInstallPrompt, enableNotifications, dismissInstallPrompt } = usePushNotifications(isAuthenticated);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthLoading, isAuthenticated, setLocation]);

  // Track connection status based on fetch success
  useEffect(() => {
    setConnected(!isEscalationsLoading ? true : connected);
  }, [isFetching]);

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const selectedConversation = conversations.find(c => c.customer_phone === selectedPhone) ?? null;

  const handleLogout = () => {
    logout(undefined, { onSuccess: () => setLocation("/login") });
  };

  const handleRegisterBiometric = async () => {
    try {
      const optRes = await fetch('/api/auth/webauthn/register/options', { method: 'POST', credentials: 'include' });
      if (!optRes.ok) return alert("Failed to start biometric registration");
      const options = await optRes.json();
      const attResp = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch('/api/auth/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attResp),
        credentials: 'include',
      });
      if (verifyRes.ok) {
        alert("Biometric registered! You can now log in with Face ID / fingerprint.");
      } else {
        alert("Registration failed. Please try again.");
      }
    } catch (e: any) {
      alert(e.message || "Biometric registration failed");
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
      <header
        data-testid="header-main"
        className="h-14 bg-[#0F510F] text-white flex items-center justify-between px-5 flex-shrink-0 z-20 shadow-md"
      >
        {/* Logo + Brand */}
        <div className="flex items-center gap-4">
          <img
            data-testid="img-logo"
            src="/logo.png"
            alt="WAK Solutions"
            className="h-[36px] shrink-0"
          />
          <div className="hidden sm:block">
            <span className="font-semibold text-sm text-white/90">WAK Solutions</span>
            <span className="text-white/40 mx-2">—</span>
            <span className="text-sm text-white/70">Agent Dashboard</span>
          </div>
        </div>

        {/* Status + Logout */}
        <div className="flex items-center gap-4">
          <div
            data-testid="status-connection"
            className="flex items-center gap-1.5 text-xs"
          >
            {connected ? (
              <>
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-white/70 hidden sm:inline">Online</span>
                <Wifi className="w-3.5 h-3.5 text-green-400" />
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-yellow-400" />
                <span className="text-white/70 hidden sm:inline">Connecting...</span>
                <WifiOff className="w-3.5 h-3.5 text-yellow-400" />
              </>
            )}
          </div>

          <button
            onClick={handleRegisterBiometric}
            title="Set up Face ID / Fingerprint login"
            className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10"
          >
            <Fingerprint className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Biometric</span>
          </button>

          <button
            data-testid="button-logout"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* iOS PWA Install Prompt */}
      {showInstallPrompt && (
        <div className="bg-blue-50 border-b border-blue-200 px-5 py-2.5 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 text-sm text-blue-800">
            <Share className="w-4 h-4 flex-shrink-0" />
            <span>
              To receive notifications on iOS, tap{" "}
              <strong>Share</strong> → <strong>Add to Home Screen</strong>, then open from your Home Screen.
            </span>
          </div>
          <button
            onClick={dismissInstallPrompt}
            className="flex-shrink-0 text-blue-600 hover:text-blue-800 p-1 rounded transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Enable Notifications Banner */}
      {showBanner && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <Bell className="w-4 h-4 flex-shrink-0" />
            <span>Enable notifications to get alerted when customers message you.</span>
          </div>
          <button
            onClick={enableNotifications}
            className="flex-shrink-0 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            Enable Notifications
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar: full screen on mobile when no chat selected, fixed width on desktop */}
        <div className={`${selectedPhone ? 'hidden md:flex' : 'flex w-full md:w-80'} md:w-80 h-full flex-shrink-0`}>
          {isEscalationsLoading ? (
            <div className="w-full h-full border-r border-border bg-card flex flex-col">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-4 border-b border-border/40 animate-pulse flex gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex-shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3 bg-muted rounded w-1/2" />
                    <div className="h-2 bg-muted rounded w-3/4" />
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

        {/* Chat: full screen on mobile when chat selected, hidden when none */}
        <div className={`${selectedPhone ? 'flex' : 'hidden md:flex'} flex-1 min-w-0`}>
          <ChatArea
            conversation={selectedConversation}
            onClose={() => setSelectedPhone(null)}
          />
        </div>
      </main>
    </div>
  );
}
