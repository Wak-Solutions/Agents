import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import {
  Inbox, Users, BookUser, ContactRound, BarChart3, Video, Bot,
  ClipboardList, BookOpen, LogOut, Globe, Fingerprint, Menu, X,
  Bell, Share, TrendingUp,
} from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import { usePushNotifications } from "@/hooks/use-push";

interface NavItem {
  href: string;
  icon: React.ReactNode;
  label: string;
  adminOnly?: boolean;
}

/**
 * Shared dashboard layout — dark green sidebar + white content area.
 * Wraps every authenticated dashboard page.
 *
 * Props:
 *  - children: page content
 *  - noPadding: skip the default p-6 on the content area (for full-bleed pages like inbox/chat)
 */
export default function DashboardLayout({
  children,
  noPadding = false,
}: {
  children: React.ReactNode;
  noPadding?: boolean;
}) {
  const [location, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin } = useAuth();
  const { mutate: logout } = useLogout();
  const { lang, toggleLang, t } = useLanguage();
  const isRtl = lang === "ar";
  const [mobileOpen, setMobileOpen] = useState(false);
  const { showBanner, showInstallPrompt, enableNotifications, dismissInstallPrompt } = usePushNotifications(isAuthenticated, isAuthLoading);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthLoading, isAuthenticated, setLocation]);

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
      </div>
    );
  }

  const handleLogout = () => {
    logout(undefined, { onSuccess: () => setLocation("/login") });
  };

  const handleRegisterBiometric = async () => {
    try {
      const optRes = await fetch("/api/auth/webauthn/register/options", { method: "POST", credentials: "include" });
      if (!optRes.ok) return alert("Failed to start biometric registration");
      const options = await optRes.json();
      const attResp = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attResp),
        credentials: "include",
      });
      if (verifyRes.ok) alert("Biometric registered! You can now log in with Face ID / fingerprint.");
      else alert("Registration failed. Please try again.");
    } catch (e: any) {
      alert(e.message || "Biometric registration failed");
    }
  };

  const navItems: NavItem[] = [
    { href: "/dashboard",     icon: <Inbox className="w-4 h-4" />,        label: t("inbox") },
    { href: "/inbox",         icon: <TrendingUp className="w-4 h-4" />,   label: t("inboxTitle") ?? "Escalations" },
    { href: "/agents",        icon: <Users className="w-4 h-4" />,        label: t("agents"),    adminOnly: true },
    { href: "/contacts",      icon: <BookUser className="w-4 h-4" />,     label: t("contacts"),  adminOnly: true },
    { href: "/customers",     icon: <ContactRound className="w-4 h-4" />, label: t("customers"), adminOnly: true },
    { href: "/statistics",    icon: <BarChart3 className="w-4 h-4" />,    label: t("statistics") },
    { href: "/meetings",      icon: <Video className="w-4 h-4" />,        label: t("meetings") },
    { href: "/chatbot-config",icon: <Bot className="w-4 h-4" />,          label: t("chatbotConfig") },
    { href: "/surveys",       icon: <ClipboardList className="w-4 h-4" />,label: t("surveys") },
    { href: "/guide",         icon: <BookOpen className="w-4 h-4" />,     label: t("guide") },
  ];

  const visibleNav = navItems.filter(n => !n.adminOnly || isAdmin);

  const isActive = (href: string) => {
    if (href === "/dashboard") return location === "/dashboard" || location === "/";
    return location === href;
  };

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="flex h-screen overflow-hidden bg-white font-sans text-gray-900 antialiased">

      {/* ─── Desktop Sidebar ─── */}
      <aside className="hidden md:flex flex-col w-[220px] bg-[#0F510F] shrink-0">
        {/* Logo */}
        <div className="px-4 py-5 flex items-center gap-2.5 border-b border-white/10">
          <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm">W</div>
          <span className="text-white/90 font-semibold text-sm">WAK Solutions</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2.5 space-y-0.5 overflow-y-auto">
          {visibleNav.map(n => (
            <Link key={n.href} href={n.href}>
              <a className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                isActive(n.href)
                  ? "bg-white/20 text-white"
                  : "text-white/60 hover:text-white/90 hover:bg-white/10"
              }`}>
                {n.icon}
                {n.label}
              </a>
            </Link>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="px-2.5 pb-4 pt-2 border-t border-white/10 space-y-0.5">
          <button
            onClick={handleRegisterBiometric}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors"
          >
            <Fingerprint className="w-4 h-4" /> Biometric
          </button>
          <button
            onClick={toggleLang}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors"
          >
            <Globe className="w-4 h-4" /> {t("switchLang")}
          </button>
          <button
            onClick={handleLogout}
            data-testid="button-logout"
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white/60 hover:text-red-300 hover:bg-white/10 transition-colors"
          >
            <LogOut className="w-4 h-4" /> {t("logout")}
          </button>
        </div>
      </aside>

      {/* ─── Mobile header + menu ─── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-50 bg-[#0F510F] h-14 flex items-center justify-between px-4 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center text-white font-bold text-xs">W</div>
          <span className="text-white/90 font-semibold text-sm">WAK Solutions</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleLang} className="text-white/60 hover:text-white p-1.5 rounded transition-colors">
            <Globe className="w-4 h-4" />
          </button>
          <button onClick={() => setMobileOpen(true)} className="text-white/80 hover:text-white p-1.5 rounded transition-colors">
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[60] md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className={`absolute top-0 ${isRtl ? "left-0" : "right-0"} h-full w-72 bg-white shadow-xl flex flex-col`} onClick={e => e.stopPropagation()}>
            <div className="h-14 bg-[#0F510F] flex items-center justify-between px-5">
              <span className="text-white font-semibold text-sm">{t("menu")}</span>
              <button onClick={() => setMobileOpen(false)} className="text-white/70 hover:text-white p-1 rounded transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2">
              {visibleNav.map(item => (
                <Link key={item.href} href={item.href}>
                  <a
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-4 px-5 py-3.5 text-sm font-medium transition-colors min-h-[48px] ${
                      isActive(item.href)
                        ? "bg-[#0F510F]/10 text-[#0F510F] border-s-4 border-[#0F510F]"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className={isActive(item.href) ? "text-[#0F510F]" : "text-gray-400"}>{item.icon}</span>
                    {item.label}
                  </a>
                </Link>
              ))}
              <button
                onClick={() => { handleRegisterBiometric(); setMobileOpen(false); }}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors min-h-[48px]"
              >
                <span className="text-gray-400"><Fingerprint className="w-5 h-5" /></span>
                Biometric
              </button>
              <button
                onClick={() => { toggleLang(); setMobileOpen(false); }}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors min-h-[48px]"
              >
                <span className="text-gray-400"><Globe className="w-5 h-5" /></span>
                {t("switchLang")}
              </button>
              <button
                onClick={() => { handleLogout(); setMobileOpen(false); }}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors min-h-[48px]"
              >
                <span className="text-red-400"><LogOut className="w-5 h-5" /></span>
                {t("logout")}
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* ─── Main content ─── */}
      <div className="flex-1 flex flex-col min-w-0 md:min-h-screen">
        {/* Banners */}
        {showInstallPrompt && (
          <div className="bg-blue-50 border-b border-blue-200 px-5 py-2.5 flex items-center justify-between gap-3 shrink-0 md:flex">
            <div className="flex items-center gap-2 text-sm text-blue-800">
              <Share className="w-4 h-4 shrink-0" />
              <span>{t("iosInstallPrompt")}</span>
            </div>
            <button onClick={dismissInstallPrompt} className="shrink-0 text-blue-600 hover:text-blue-800 p-1 rounded transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {showBanner && (
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <Bell className="w-4 h-4 shrink-0" />
              <span>{t("enableNotificationsPrompt")}</span>
            </div>
            <button onClick={enableNotifications} className="shrink-0 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg transition-colors">
              {t("enableNotifications")}
            </button>
          </div>
        )}

        {/* Page content */}
        <main className={`flex-1 overflow-y-auto md:overflow-hidden pt-14 md:pt-0 ${noPadding ? "" : "p-6"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
