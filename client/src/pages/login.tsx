import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { MessageSquareQuote, Lock, Fingerprint, Mail } from "lucide-react";
import { useAuth, useLogin } from "@/hooks/use-auth";
import { Card, Input, Button } from "@/components/ui-elements";
import { useLanguage } from "@/lib/language-context";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, termsAcceptedAt } = useAuth();
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

  useEffect(() => {
    if (isAuthenticated && !isAuthLoading) {
      if (termsAcceptedAt === null) {
        setShowTermsModal(true);
      } else {
        setLocation("/");
      }
    }
  }, [isAuthenticated, isAuthLoading, termsAcceptedAt, setLocation]);

  const handleAcceptTerms = async () => {
    setTermsAccepting(true);
    try {
      const res = await fetch("/api/agents/accept-terms", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setLocation("/");
      }
    } catch {}
    setTermsAccepting(false);
  };

  // Check if device supports platform biometrics and if one is registered
  useEffect(() => {
    const check = async () => {
      if (!window.PublicKeyCredential) return;
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) return;
      setBiometricAvailable(true);
      const res = await fetch('/api/auth/webauthn/registered');
      const data = await res.json();
      setBiometricRegistered(data.registered);
    };
    check();
  }, []);

  const handleBiometricLogin = async () => {
    setBiometricError("");
    setBiometricPending(true);
    try {
      const optRes = await fetch('/api/auth/webauthn/login/options', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!optRes.ok) throw new Error(t("loginErrorNoBiometric"));
      const options = await optRes.json();
      const assertion = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch('/api/auth/webauthn/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assertion),
        credentials: 'include',
      });
      if (!verifyRes.ok) throw new Error(t("loginErrorBiometricFailed"));
      // Invalidate auth query so useAuth refetches and the redirect useEffect handles terms check
      queryClient.invalidateQueries({ queryKey: [api.auth.me.path] });
    } catch (e: any) {
      setBiometricError(e.message || t("loginErrorBiometricLogin"));
    } finally {
      setBiometricPending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    // No onSuccess redirect — the useEffect watching termsAcceptedAt handles the redirect
    login({ email: email || undefined, password });
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden" dir={isRtl ? "rtl" : "ltr"}>

      {/* Terms Acceptance Modal — shown after login if terms not yet accepted */}
      {showTermsModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" dir={isRtl ? "rtl" : "ltr"}>
            {/* Modal header */}
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">{t("termsModalTitle")}</h2>
              <p className="text-sm text-gray-500 mt-1">{t("termsModalSubtitle")}</p>
            </div>
            {/* T&C link area */}
            <div className="flex-1 overflow-y-auto mx-4 my-4 border border-gray-200 rounded-xl bg-[#F5F2EC] px-5 py-4 text-center min-h-0">
              <p className="text-sm text-gray-500 mb-3">
                {t("termsModalSubtitle")}
              </p>
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0F510F] underline underline-offset-2 hover:text-[#408440] transition-colors"
              >
                {t("termsModalReadLink")}
              </a>
            </div>
            {/* Checkbox + button */}
            <div className="px-6 pb-6 pt-2 space-y-4">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={termsChecked}
                  onChange={(e) => setTermsChecked(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#0F510F] flex-shrink-0"
                />
                <span className="text-sm text-gray-700 leading-snug">{t("termsModalCheckbox")}</span>
              </label>
              <button
                disabled={!termsChecked || termsAccepting}
                onClick={handleAcceptTerms}
                className="w-full bg-[#0F510F] text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50 hover:bg-[#0d4510] transition-colors flex items-center justify-center gap-2"
              >
                {termsAccepting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t("termsModalAccepting")}
                  </>
                ) : t("termsModalContinue")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subtle background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/8 rounded-full blur-2xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-secondary/8 rounded-full blur-2xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo area */}
        <div className="flex flex-col items-center mb-8">
          <img
            src="/logo.png"
            alt="WAK Solutions"
            className="w-[180px] mb-4"
          />
          <h1 className="text-xl font-bold text-foreground tracking-tight">WAK Solutions</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("loginTagline")}</p>
        </div>

        <Card className="p-8 shadow-lg">
          <div className="flex flex-col items-center text-center mb-7">
            <div
              data-testid="img-login-icon"
              className="w-14 h-14 bg-primary rounded-xl flex items-center justify-center shadow-md mb-4"
            >
              <MessageSquareQuote className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">{t("loginTitle")}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t("loginSubtitle")}</p>
          </div>

          {/* Biometric login button */}
          {biometricAvailable && biometricRegistered && (
            <div className="mb-5">
              <button
                type="button"
                onClick={handleBiometricLogin}
                disabled={biometricPending}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border-2 border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all text-sm font-medium text-primary disabled:opacity-50"
              >
                <Fingerprint className="w-5 h-5" />
                {biometricPending ? t("loginVerifying") : t("loginSignInBiometric")}
              </button>
              {biometricError && (
                <p className="text-sm text-destructive mt-2 text-center">{biometricError}</p>
              )}
              <div className="flex items-center gap-3 mt-5 mb-1">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">{t("loginDivider")}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                {t("loginEmail")} <span className="text-xs text-muted-foreground font-normal">{t("loginEmailHint")}</span>
              </label>
              <Input
                type="email"
                placeholder={t("loginEmailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isPending}
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                {t("loginPassword")}
              </label>
              <Input
                data-testid="input-password"
                type="password"
                placeholder={t("loginPasswordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isPending}
                autoFocus={!email}
              />
              {error && (
                <p
                  data-testid="text-error"
                  className="text-sm text-destructive animate-in fade-in slide-in-from-top-1 pt-1"
                >
                  {error.message || t("loginErrorCredentials")}
                </p>
              )}
            </div>

            <Button
              data-testid="button-login"
              type="submit"
              className="w-full"
              size="lg"
              isLoading={isPending}
              disabled={!password || isPending}
            >
              {t("loginSignIn")}
            </Button>
          </form>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          {t("loginCopyright")} &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
