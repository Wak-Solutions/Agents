import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { MessageSquareQuote, Lock, Fingerprint, Mail } from "lucide-react";
import { useAuth, useLogin } from "@/hooks/use-auth";
import { Card, Input, Button } from "@/components/ui-elements";
import { useLanguage } from "@/lib/language-context";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { mutate: login, isPending, error } = useLogin();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricRegistered, setBiometricRegistered] = useState(false);
  const [biometricError, setBiometricError] = useState("");
  const [biometricPending, setBiometricPending] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    if (isAuthenticated && !isAuthLoading) {
      setLocation("/");
    }
  }, [isAuthenticated, isAuthLoading, setLocation]);

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
      setLocation("/");
    } catch (e: any) {
      setBiometricError(e.message || t("loginErrorBiometricLogin"));
    } finally {
      setBiometricPending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    login({ email: email || undefined, password }, {
      onSuccess: () => setLocation("/")
    });
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">

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
