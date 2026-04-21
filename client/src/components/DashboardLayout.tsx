import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import {
  Inbox, Users, BookUser, ContactRound, BarChart3, Video, Bot,
  ClipboardList, BookOpen, LogOut, Globe, Fingerprint, Menu, X,
  Bell, Share, Headphones, Settings, CalendarCheck, Infinity,
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
 *  - noPadding: skip the default p-8 on the content area (for full-bleed pages like inbox/chat)
 */
export default function DashboardLayout({
  children,
  noPadding = false,
}: {
  children: React.ReactNode;
  noPadding?: boolean;
}) {
  const [location, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin, agentName } = useAuth();
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
    { href: "/dashboard",     icon: <Inbox className="w-[18px] h-[18px]" />,        label: t("inbox") },
    { href: "/inbox",         icon: <Headphones className="w-[18px] h-[18px]" />,  label: t("inboxTitle") ?? "Escalations" },
    { href: "/agents",        icon: <Users className="w-[18px] h-[18px]" />,        label: t("agents"),    adminOnly: true },
    { href: "/contacts",      icon: <BookUser className="w-[18px] h-[18px]" />,     label: t("contacts"),  adminOnly: true },
    { href: "/customers",     icon: <ContactRound className="w-[18px] h-[18px]" />, label: t("customers"), adminOnly: true },
    { href: "/statistics",    icon: <BarChart3 className="w-[18px] h-[18px]" />,    label: t("statistics") },
    { href: "/meetings",      icon: <Video className="w-[18px] h-[18px]" />,        label: t("meetings") },
    { href: "/chatbot-config",icon: <Bot className="w-[18px] h-[18px]" />,          label: t("chatbotConfig") },
    { href: "/surveys",       icon: <ClipboardList className="w-[18px] h-[18px]" />,label: t("surveys") },
    { href: "/guide",         icon: <BookOpen className="w-[18px] h-[18px]" />,     label: t("guide") },
    { href: "/settings",      icon: <Settings className="w-[18px] h-[18px]" />,     label: t("settings"), adminOnly: true },
  ];

  const visibleNav = navItems.filter(n => !n.adminOnly || isAdmin);

  /* Split nav into main items and admin-only items for section divider */
  const mainNav = visibleNav.filter(n => !n.adminOnly);
  const adminNav = visibleNav.filter(n => n.adminOnly);

  const isActive = (href: string) => {
    if (href === "/dashboard") return location === "/dashboard" || location === "/";
    return location === href;
  };

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="flex h-screen overflow-hidden bg-white font-sans text-gray-900 antialiased">

      {/* ─── Desktop Sidebar ─── */}
      <aside className="hidden md:flex flex-col w-[232px] bg-[#0F510F] shrink-0">
        {/* Logo */}
        <div className="px-4 py-5 flex items-center gap-2.5 border-b border-white/10">
          <div className="bg-white rounded-lg px-2 py-1 shrink-0">
            <img src="/logo.png" alt="WAK Solutions" className="h-7 w-auto" />
          </div>
          <span className="text-white/90 font-semibold text-sm tracking-tight">WAK Solutions</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2.5 overflow-y-auto">
          {/* Main nav items (visible to all) */}
          <div className="space-y-0.5">
            {mainNav.map(n => (
              <Link key={n.href} href={n.href}>
                <a className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${
                  isActive(n.href)
                    ? "border-s-[3px] border-white bg-white/15 text-white shadow-sm"
                    : "text-white/55 hover:text-white/85 hover:bg-white/[0.08]"
                }`}>
                  {n.icon}
                  {n.label}
                </a>
              </Link>
            ))}
          </div>

          {/* Section divider between main and admin items */}
          {adminNav.length > 0 && (
            <>
              <div className="my-2.5 border-b border-white/[0.08]" />
              <div className="space-y-0.5">
                {adminNav.map(n => (
                  <Link key={n.href} href={n.href}>
                    <a className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${
                      isActive(n.href)
                        ? "border-s-[3px] border-white bg-white/15 text-white shadow-sm"
                        : "text-white/55 hover:text-white/85 hover:bg-white/[0.08]"
                    }`}>
                      {n.icon}
                      {n.label}
                    </a>
                  </Link>
                ))}
              </div>
            </>
          )}
        </nav>

        {/* Agent name */}
        {agentName && (
          <div className="px-5 py-3 border-t border-white/10 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <span className="text-white text-[11px] font-bold leading-none">
                {agentName.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
              </span>
            </div>
            <span className="text-white/80 text-[13px] font-medium truncate">{agentName}</span>
          </div>
        )}

        {/* Bottom actions */}
        <div className="px-3.5 pb-5 pt-3 border-t border-white/10 space-y-0.5">
          <button
            onClick={handleRegisterBiometric}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-[13.5px] font-medium text-white/55 hover:text-white/85 hover:bg-white/[0.08] transition-colors"
          >
            <Fingerprint className="w-[18px] h-[18px]" /> Biometric
          </button>
          <button
            onClick={toggleLang}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-[13.5px] font-medium text-white/55 hover:text-white/85 hover:bg-white/[0.08] transition-colors"
          >
            <Globe className="w-[18px] h-[18px]" /> {t("switchLang")}
          </button>
          <button
            onClick={handleLogout}
            data-testid="button-logout"
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-[13.5px] font-medium text-white/55 hover:text-red-300 hover:bg-white/[0.08] transition-colors"
          >
            <LogOut className="w-[18px] h-[18px]" /> {t("logout")}
          </button>
        </div>
      </aside>

      {/* ─── Mobile header + menu ─── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-50 bg-[#0F510F] h-[56px] flex items-center justify-between px-4 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="bg-white rounded-lg px-2 py-0.5 shrink-0">
            <img src="/logo.png" alt="WAK Solutions" className="h-6 w-auto" />
          </div>
          <span className="text-white/90 font-semibold text-sm">WAK Solutions</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/book-demo">
            <a className="inline-flex items-center gap-1 text-white/80 border border-white/30 hover:border-white/60 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors">
              <CalendarCheck className="w-3 h-3" /> Demo
            </a>
          </Link>
          <span className="inline-flex items-center gap-1 bg-amber-400/20 text-amber-200 text-[10px] font-semibold px-2 py-1 rounded-full border border-amber-300/30">
            <Infinity className="w-2.5 h-2.5" /> ∞
          </span>
          {agentName && (
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
              <span className="text-white text-[11px] font-bold leading-none">
                {agentName.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
              </span>
            </div>
          )}
          <button onClick={toggleLang} className="text-white/55 hover:text-white p-1.5 rounded transition-colors">
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
          <div className={`absolute top-0 ${isRtl ? "left-0" : "right-0"} h-full w-80 bg-white shadow-xl flex flex-col`} onClick={e => e.stopPropagation()}>
            <div className="h-[56px] bg-[#0F510F] flex items-center justify-between px-5">
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
        {/* Desktop top bar */}
        <div className="hidden md:flex items-center justify-end gap-3 px-6 py-2.5 border-b border-gray-100 bg-white shrink-0">
          <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold px-2.5 py-1 rounded-full">
            <Infinity className="w-3 h-3" /> Unlimited days remaining
          </span>
          <Link href="/book-demo">
            <a className="inline-flex items-center gap-1.5 text-[#0F510F] border border-[#0F510F]/40 hover:border-[#0F510F] hover:bg-[#0F510F]/5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
              <CalendarCheck className="w-3.5 h-3.5" /> Book a Demo
            </a>
          </Link>
        </div>

        {/* Banners — wrapped so portrait-mobile CSS can push them below the fixed navbar */}
        {(showInstallPrompt || showBanner) && (
          <div className="notification-banners">
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
          </div>
        )}

        {/* Page content */}
        <main className={`flex-1 overflow-y-auto md:overflow-hidden pt-14 md:pt-0 ${noPadding ? "" : "p-8"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
