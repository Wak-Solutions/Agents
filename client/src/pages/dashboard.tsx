import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { LogOut, Wifi, WifiOff, Fingerprint, Bell, Share, X, BookOpen, BarChart2, Bot, Video, ClipboardList, Inbox, Users, Menu } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { useConversations } from "@/hooks/use-conversations";
import { usePushNotifications } from "@/hooks/use-push";
import { Sidebar } from "@/components/sidebar";
import { ChatArea } from "@/components/chat-area";

export default function Dashboard() {
  const [location, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin } = useAuth();
  const { mutate: logout } = useLogout();
  const { data: conversations = [], isLoading: isEscalationsLoading, isFetching } = useConversations();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

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

  // When an agent opens a chat, clear the push-notification "already notified" flag
  // so they'll be notified again if new messages arrive after they leave.
  useEffect(() => {
    if (!selectedPhone || !isAuthenticated) return;
    fetch(`/api/notifications/mark-read/${encodeURIComponent(selectedPhone)}`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
  }, [selectedPhone, isAuthenticated]);

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

        {/* Right side: status + nav + logout/hamburger */}
        <div className="flex items-center gap-2">
          {/* Connection status — always visible */}
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

          {/* Nav links — desktop only */}
          <div className="hidden md:flex items-center gap-1">
            <Link href="/inbox">
              <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
                <Inbox className="w-3.5 h-3.5" /><span>Inbox</span>
              </a>
            </Link>
            {isAdmin && (
              <Link href="/agents">
                <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
                  <Users className="w-3.5 h-3.5" /><span>Agents</span>
                </a>
              </Link>
            )}
            <Link href="/statistics">
              <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
                <BarChart2 className="w-3.5 h-3.5" /><span>Statistics</span>
              </a>
            </Link>
            <Link href="/meetings">
              <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
                <Video className="w-3.5 h-3.5" /><span>Meetings</span>
              </a>
            </Link>
            <Link href="/chatbot-config">
              <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
                <Bot className="w-3.5 h-3.5" /><span>Chatbot Config</span>
              </a>
            </Link>
            <Link href="/surveys">
              <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
                <ClipboardList className="w-3.5 h-3.5" /><span>Surveys</span>
              </a>
            </Link>
            <Link href="/guide">
              <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
                <BookOpen className="w-3.5 h-3.5" /><span>Guide</span>
              </a>
            </Link>
            <button
              onClick={handleRegisterBiometric}
              title="Set up Face ID / Fingerprint login"
              className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10"
            >
              <Fingerprint className="w-3.5 h-3.5" /><span>Biometric</span>
            </button>
          </div>

          {/* Logout — always visible */}
          <button
            data-testid="button-logout"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Logout</span>
          </button>

          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMenuOpen(true)}
            className="md:hidden flex items-center justify-center p-2 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Mobile nav menu overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={() => setMenuOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" />

          {/* Drawer — slides in from the right */}
          <div
            className="absolute top-0 right-0 h-full w-72 bg-white shadow-xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="h-14 bg-[#0F510F] flex items-center justify-between px-5">
              <span className="text-white font-semibold text-sm">Menu</span>
              <button
                onClick={() => setMenuOpen(false)}
                className="text-white/70 hover:text-white p-1 rounded transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nav items */}
            <nav className="flex-1 overflow-y-auto py-2">
              {(
                [
                  { href: "/inbox",         icon: <Inbox className="w-5 h-5" />,        label: "Inbox" },
                  ...(isAdmin ? [{ href: "/agents", icon: <Users className="w-5 h-5" />, label: "Agents" }] : []),
                  { href: "/statistics",    icon: <BarChart2 className="w-5 h-5" />,     label: "Statistics" },
                  { href: "/meetings",      icon: <Video className="w-5 h-5" />,          label: "Meetings" },
                  { href: "/chatbot-config",icon: <Bot className="w-5 h-5" />,            label: "Chatbot Config" },
                  { href: "/surveys",       icon: <ClipboardList className="w-5 h-5" />,  label: "Surveys" },
                  { href: "/guide",         icon: <BookOpen className="w-5 h-5" />,       label: "Guide" },
                ] as { href: string; icon: React.ReactNode; label: string }[]
              ).map(item => (
                <Link key={item.href} href={item.href}>
                  <a
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-4 px-5 py-3.5 text-sm font-medium transition-colors min-h-[48px] ${
                      location === item.href
                        ? "bg-[#0F510F]/10 text-[#0F510F] border-l-4 border-[#0F510F]"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <span className={location === item.href ? "text-[#0F510F]" : "text-muted-foreground"}>
                      {item.icon}
                    </span>
                    {item.label}
                  </a>
                </Link>
              ))}

              {/* Biometric button */}
              <button
                onClick={() => { handleRegisterBiometric(); setMenuOpen(false); }}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[48px]"
              >
                <span className="text-muted-foreground"><Fingerprint className="w-5 h-5" /></span>
                Biometric Setup
              </button>
            </nav>
          </div>
        </div>
      )}

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
