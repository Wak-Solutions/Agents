import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Lock, Fingerprint, Mail, ArrowLeft } from "lucide-react";
import { useLogin } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

export default function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { mutate: login, isPending, error } = useLogin();
  const queryClient = useQueryClient();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricRegistered, setBiometricRegistered] = useState(false);
  const [biometricError, setBiometricError] = useState("");
  const [biometricPending, setBiometricPending] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [termsAccepting, setTermsAccepting] = useState(false);
  const { t, lang } = useLanguage();
  const isRtl = lang === "ar";

  // No auto-redirect: login page always shows the form.
  // Navigation only happens after explicit user action (login button / biometric).

  const handleAcceptTerms = async () => {
    setTermsAccepting(true);
    try {
      console.log("[login] submitting accept-terms");
      const res = await fetch("/api/agents/accept-terms", { method: "POST", credentials: "include" });
      console.log("[login] accept-terms response status:", res.status);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        console.log("[login] accept-terms data:", data);
        queryClient.setQueryData([api.auth.me.path], (prev: any) =>
          prev ? { ...prev, termsAcceptedAt: data.termsAcceptedAt ?? new Date().toISOString() } : prev
        );
        setLocation("/dashboard");
      } else {
        const body = await res.text().catch(() => "");
        console.error("[login] accept-terms failed:", res.status, body);
      }
    } catch (e) {
      console.error("[login] accept-terms exception:", e);
    }
    setTermsAccepting(false);
  };

  useEffect(() => {
    const check = async () => {
      if (!window.PublicKeyCredential) return;
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) return;
      setBiometricAvailable(true);
      const res = await fetch("/api/auth/webauthn/registered");
      const data = await res.json();
      setBiometricRegistered(data.registered);
    };
    check();
  }, []);

  const handleBiometricLogin = async () => {
    setBiometricError("");
    setBiometricPending(true);
    try {
      const optRes = await fetch("/api/auth/webauthn/login/options", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!optRes.ok) throw new Error(t("loginErrorNoBiometric"));
      const options = await optRes.json();
      const assertion = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch("/api/auth/webauthn/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
        credentials: "include",
      });
      if (!verifyRes.ok) throw new Error(t("loginErrorBiometricFailed"));
      const verifyData = await verifyRes.json();
      queryClient.setQueryData([api.auth.me.path], {
        authenticated: true,
        role: verifyData.role,
        agentId: verifyData.agentId,
        agentName: verifyData.agentName,
        termsAcceptedAt: verifyData.termsAcceptedAt ?? null,
      });
      if (!verifyData.termsAcceptedAt) {
        setShowTermsModal(true);
      } else {
        setLocation("/dashboard");
      }
    } catch (e: any) {
      setBiometricError(e.message || t("loginErrorBiometricLogin"));
    } finally {
      setBiometricPending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    console.log("[login] submitting login, identifier:", identifier ? "set" : "empty");
    login(
      { identifier: identifier.trim(), password },
      {
        onSuccess: (data) => {
          if (!data.termsAcceptedAt) {
            setShowTermsModal(true);
          } else {
            setLocation("/dashboard");
          }
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 relative overflow-hidden font-sans antialiased" dir={isRtl ? "rtl" : "ltr"}>
      {/* Terms modal */}
      {showTermsModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" dir={isRtl ? "rtl" : "ltr"}>
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">{t("termsModalTitle")}</h2>
              <p className="text-sm text-gray-500 mt-1">{t("termsModalSubtitle")}</p>
            </div>
            <div className="flex-1 overflow-y-auto mx-4 my-4 border border-gray-200 rounded-xl bg-[#F5F2EC] px-5 py-4 text-center min-h-0">
              <p className="text-sm text-gray-500 mb-3">{t("termsModalSubtitle")}</p>
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0F510F] underline underline-offset-2 hover:text-[#408440] transition-colors">
                {t("termsModalReadLink")}
              </a>
            </div>
            <div className="px-6 pb-6 pt-2 space-y-4">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={termsChecked} onChange={e => setTermsChecked(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#0F510F] shrink-0" />
                <span className="text-sm text-gray-700 leading-snug">{t("termsModalCheckbox")}</span>
              </label>
              <button
                disabled={!termsChecked || termsAccepting}
                onClick={handleAcceptTerms}
                className="w-full bg-[#0F510F] text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50 hover:bg-[#0d4510] transition-colors flex items-center justify-center gap-2"
              >
                {termsAccepting ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("termsModalAccepting")}</>
                ) : t("termsModalContinue")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back to home */}
      <div className={`absolute top-4 ${isRtl ? "right-4" : "left-4"} z-10`}>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-[#0F510F] transition-colors"
        >
          <ArrowLeft className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`} />
          Home
        </a>
      </div>

      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#0F510F]/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#408440]/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="WAK Solutions" className="h-14 w-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">WAK Solutions</h1>
          <p className="text-sm text-gray-500 mt-1">{t("loginTagline")}</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <div className="flex flex-col items-center text-center mb-7">
            <h2 className="text-lg font-semibold text-gray-900">{t("loginTitle")}</h2>
            <p className="text-sm text-gray-500 mt-1">{t("loginSubtitle")}</p>
          </div>

          {/* Biometric */}
          {biometricAvailable && biometricRegistered && (
            <div className="mb-5">
              <button
                type="button"
                onClick={handleBiometricLogin}
                disabled={biometricPending}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border-2 border-[#0F510F]/20 bg-[#0F510F]/5 hover:bg-[#0F510F]/10 transition-all text-sm font-medium text-[#0F510F] disabled:opacity-50"
              >
                {biometricPending
                  ? <><div className="w-4 h-4 border-2 border-[#0F510F]/30 border-t-[#0F510F] rounded-full animate-spin" />{t("loginVerifying")}</>
                  : <><Fingerprint className="w-5 h-5" />{t("loginSignInBiometric")}</>
                }
              </button>
              {biometricError && <p className="text-sm text-red-500 mt-2 text-center">{biometricError}</p>}
              <div className="flex items-center gap-3 mt-5 mb-1">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400">{t("loginDivider")}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-gray-400" />
                Email or Mobile Number
              </label>
              <input
                type="text"
                placeholder="email@example.com or +966501234567"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                disabled={isPending}
                autoComplete="username"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0F510F]/20 focus:border-[#0F510F]/40 disabled:opacity-50 bg-white"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-gray-400" />
                {t("loginPassword")}
              </label>
              <input
                data-testid="input-password"
                type="password"
                placeholder={t("loginPasswordPlaceholder")}
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={isPending}
                autoFocus={!identifier}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0F510F]/20 focus:border-[#0F510F]/40 disabled:opacity-50 bg-white"
              />
              {error && (
                <p data-testid="text-error" className="text-sm text-red-500 pt-1">
                  {error.message || t("loginErrorCredentials")}
                </p>
              )}
            </div>
            <button
              data-testid="button-login"
              type="submit"
              disabled={!password || isPending}
              className="w-full bg-[#0F510F] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#0d4510] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPending && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {t("loginSignIn")}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-5">
          Don't have an account?{" "}
          <a href="/register" className="font-medium text-[#0F510F] hover:text-[#0d4510] transition-colors">
            Start free trial
          </a>
        </p>

        <p className="text-center text-xs text-gray-400 mt-4">
          {t("loginCopyright")} &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
