import { useState, useEffect } from "react";
import { MessageSquare, Eye, EyeOff, Check, AlertCircle, Lock, Building2 } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useLanguage } from "@/lib/language-context";

/* ─────────────────────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────────────────────── */

interface WhatsAppCredentials {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type VerifyStatus = "idle" | "verifying" | "verified" | "error";

/* ─────────────────────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────────────────────── */

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 4) return "••••";
  return "••••••••••" + token.slice(-4);
}

const inputClass =
  "w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0F510F]/20 focus:border-[#0F510F]/40 transition-colors";

/* ─────────────────────────────────────────────────────────────────────────────
   WhatsApp Panel
───────────────────────────────────────────────────────────────────────────── */

function WhatsAppPanel({ t }: { t: (k: string) => string }) {
  const [creds, setCreds] = useState<WhatsAppCredentials>({ phoneNumberId: "", wabaId: "", accessToken: "", appSecret: "" });
  const [revealToken, setRevealToken] = useState(false);
  const [revealSecret, setRevealSecret] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyError, setVerifyError] = useState("");
  const [verifiedName, setVerifiedName] = useState("");

  // Reset verified state when phone/waba/token credentials change (not appSecret —
  // verify doesn't test it, so don't invalidate verification on secret changes).
  const updateCreds = (patch: Partial<WhatsAppCredentials>) => {
    setCreds(prev => ({ ...prev, ...patch }));
    const verifyInvalidating = 'phoneNumberId' in patch || 'wabaId' in patch || 'accessToken' in patch;
    if (verifyInvalidating) {
      setVerifyStatus("idle");
      setVerifiedName("");
    }
    setSaveStatus("idle");
  };

  useEffect(() => {
    fetch("/api/settings/whatsapp", { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: WhatsAppCredentials) => setCreds(data))
      .catch(() => setLoadError(t("settingsLoadError")));
  }, []);

  const handleVerify = async () => {
    setVerifyStatus("verifying");
    setVerifyError("");
    setVerifiedName("");
    setSaveStatus("idle");
    setSaveError("");
    try {
      const resp = await fetch("/api/register/whatsapp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phoneNumberId: creds.phoneNumberId,
          wabaId: creds.wabaId,
          accessToken: creds.accessToken,
        }),
      });
      const data = await resp.json();
      if (!data.verified) {
        setVerifyStatus("error");
        setVerifyError(data.wabaError || data.error || t("settingsLoadError"));
        return;
      }
      setVerifyStatus("verified");
      setVerifiedName(data.displayName ?? "");

      // Auto-save on successful verify — no separate Save button.
      setSaveStatus("saving");
      const saveResp = await fetch("/api/settings/whatsapp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(creds),
      });
      if (!saveResp.ok) {
        const d = await saveResp.json().catch(() => ({}));
        throw new Error(d.message || t("settingsSaveError"));
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err: any) {
      if (verifyStatus === "verifying") {
        setVerifyStatus("error");
        setVerifyError(t("settingsLoadError"));
      } else {
        setSaveStatus("error");
        setSaveError(err.message || t("settingsSaveError"));
      }
    }
  };

  const canVerify = !!(creds.phoneNumberId && creds.wabaId && creds.accessToken);

  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-4">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {loadError}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Panel header */}
      <div className="px-6 py-5 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">{t("settingsWhatsApp")}</h2>
        <p className="text-sm text-gray-500 mt-1">{t("settingsWhatsAppDesc")}</p>
      </div>

      <div className="px-6 py-6 space-y-5 max-w-lg">
        {/* Phone Number ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {t("settingsPhoneNumberId")}
            <span className="text-xs text-gray-400 font-normal ms-1.5">({t("settingsPhoneNumberIdHint")})</span>
          </label>
          <input
            className={inputClass}
            value={creds.phoneNumberId}
            onChange={e => updateCreds({ phoneNumberId: e.target.value })}
            placeholder="e.g. 123456789012345"
          />
        </div>

        {/* WABA ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {t("settingsWabaId")}
          </label>
          <input
            className={inputClass}
            value={creds.wabaId}
            onChange={e => updateCreds({ wabaId: e.target.value })}
            placeholder="e.g. 123456789012345"
          />
        </div>

        {/* Access Token */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {t("settingsAccessToken")}
            <span className="text-xs text-gray-400 font-normal ms-1.5">({t("settingsAccessTokenHint")})</span>
          </label>
          <div className="relative">
            <input
              type={revealToken ? "text" : "password"}
              className={inputClass + " pe-24"}
              value={creds.accessToken}
              onChange={e => updateCreds({ accessToken: e.target.value })}
              placeholder={creds.accessToken ? maskToken(creds.accessToken) : "EAAx..."}
            />
            {creds.accessToken && (
              <button
                type="button"
                onClick={() => setRevealToken(v => !v)}
                className="absolute end-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors"
              >
                {revealToken
                  ? <><EyeOff className="w-3.5 h-3.5" />{t("settingsHide")}</>
                  : <><Eye className="w-3.5 h-3.5" />{t("settingsReveal")}</>
                }
              </button>
            )}
          </div>
        </div>

        {/* App Secret */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            App Secret
            <span className="text-xs text-gray-400 font-normal ms-1.5">(Meta Developer → App Settings → Basic → App Secret)</span>
          </label>
          <div className="relative">
            <input
              type={revealSecret ? "text" : "password"}
              className={inputClass + " pe-24"}
              value={creds.appSecret}
              onChange={e => updateCreds({ appSecret: e.target.value })}
              placeholder={creds.appSecret ? maskToken(creds.appSecret) : "32-char hex string"}
            />
            {creds.appSecret && (
              <button
                type="button"
                onClick={() => setRevealSecret(v => !v)}
                className="absolute end-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors"
              >
                {revealSecret
                  ? <><EyeOff className="w-3.5 h-3.5" />{t("settingsHide")}</>
                  : <><Eye className="w-3.5 h-3.5" />{t("settingsReveal")}</>
                }
              </button>
            )}
          </div>
          <p className="text-xs text-amber-700 mt-1.5">Required for Meta to send messages to your bot. Without this, the signature check will reject all incoming messages.</p>
        </div>

        {/* Verify row */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleVerify}
            disabled={!canVerify || verifyStatus === "verifying"}
            className="inline-flex items-center gap-2 bg-[#0F510F] text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-[#0d4510] transition-colors"
          >
            {verifyStatus === "verifying" ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("settingsVerifying")}</>
            ) : verifyStatus === "verified" ? (
              <><Check className="w-4 h-4" />{t("settingsVerified")}</>
            ) : (
              t("settingsVerify")
            )}
          </button>
          {verifyStatus === "verified" && verifiedName && (
            <span className="text-sm text-green-600 font-medium">{verifiedName}</span>
          )}
          {verifyStatus === "error" && (
            <span className="text-sm text-red-500">{verifyError}</span>
          )}
          {saveStatus === "saving" && (
            <span className="text-sm text-gray-500 inline-flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
              {t("settingsSaving")}
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-sm text-green-600 font-medium inline-flex items-center gap-1">
              <Check className="w-4 h-4" />{t("settingsSaved")}
            </span>
          )}
          {saveStatus === "error" && saveError && (
            <span className="text-sm text-red-500">{saveError}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Branding Panel
───────────────────────────────────────────────────────────────────────────── */

function BrandingPanel({ t }: { t: (k: string) => string }) {
  const [brandName, setBrandName] = useState("");
  const [appUrl, setAppUrl] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [urlError, setUrlError] = useState("");

  useEffect(() => {
    fetch("/api/settings/branding", { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: { brandName: string; appUrl: string }) => {
        setBrandName(data.brandName || "");
        setAppUrl(data.appUrl || "");
      })
      .catch(() => setLoadError(t("settingsLoadError")));
  }, []);

  const handleSave = async () => {
    setUrlError("");
    setSaveError("");
    if (appUrl && !appUrl.startsWith("http://") && !appUrl.startsWith("https://")) {
      setUrlError(t("settingsAppUrlInvalid"));
      return;
    }
    setSaveStatus("saving");
    try {
      const resp = await fetch("/api/settings/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ brandName, appUrl }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.message || t("settingsSaveError"));
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err: any) {
      setSaveStatus("error");
      setSaveError(err.message || t("settingsSaveError"));
    }
  };

  const canSave = !!(brandName.trim() && appUrl.trim()) && saveStatus !== "saving";

  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-4">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {loadError}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">{t("settingsBranding")}</h2>
        <p className="text-sm text-gray-500 mt-1">{t("settingsBrandingDesc")}</p>
      </div>

      <div className="px-6 py-6 space-y-5 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {t("settingsBrandName")}
          </label>
          <input
            className={inputClass}
            value={brandName}
            onChange={e => { setBrandName(e.target.value); setSaveStatus("idle"); }}
            placeholder="e.g. Acme Corp"
          />
          <p className="text-xs text-gray-400 mt-1">{t("settingsBrandNameHint")}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {t("settingsAppUrl")}
          </label>
          <input
            className={inputClass}
            value={appUrl}
            onChange={e => { setAppUrl(e.target.value); setSaveStatus("idle"); setUrlError(""); }}
            placeholder="https://app.example.com"
          />
          <p className="text-xs text-gray-400 mt-1">{t("settingsAppUrlHint")}</p>
          {urlError && <p className="text-xs text-red-500 mt-1">{urlError}</p>}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="inline-flex items-center gap-2 bg-[#0F510F] text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-[#0d4510] transition-colors"
          >
            {saveStatus === "saving" ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("settingsSaving")}</>
            ) : saveStatus === "saved" ? (
              <><Check className="w-4 h-4" />{t("settingsSaved")}</>
            ) : (
              t("settingsSave")
            )}
          </button>
          {saveStatus === "error" && saveError && (
            <span className="text-sm text-red-500">{saveError}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Settings Sections (left nav)
───────────────────────────────────────────────────────────────────────────── */

type SectionId = "whatsapp" | "branding" | "password";

interface Section {
  id: SectionId;
  icon: React.ReactNode;
  labelKey: string;
}

const SECTIONS: Section[] = [
  { id: "whatsapp", icon: <MessageSquare className="w-4 h-4" />, labelKey: "settingsWhatsApp" },
  { id: "branding", icon: <Building2 className="w-4 h-4" />, labelKey: "settingsBranding" },
  { id: "password", icon: <Lock className="w-4 h-4" />, labelKey: "settingsChangePassword" },
];

/* ─────────────────────────────────────────────────────────────────────────────
   Change Password Panel
───────────────────────────────────────────────────────────────────────────── */

function ChangePasswordPanel({ t }: { t: (k: string) => string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    newPassword !== currentPassword &&
    status !== "saving";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) { setError(t("settingsPasswordTooShort")); return; }
    if (newPassword !== confirmPassword) { setError(t("settingsPasswordMismatch")); return; }
    if (newPassword === currentPassword) { setError(t("settingsPasswordSameAsOld")); return; }

    setStatus("saving");
    try {
      const resp = await fetch("/api/settings/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setStatus("error");
        setError(data.message || t("settingsPasswordError"));
        return;
      }
      setStatus("saved");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setStatus("error");
      setError(t("settingsPasswordError"));
    }
  };

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#0F510F]/10 flex items-center justify-center">
          <Lock className="w-5 h-5 text-[#0F510F]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t("settingsChangePassword")}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{t("settingsChangePasswordSub")}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1.5 block">{t("settingsCurrentPassword")}</label>
          <div className="relative">
            <input
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={e => { setCurrentPassword(e.target.value); setStatus("idle"); setError(""); }}
              autoComplete="current-password"
              className={inputClass}
            />
            <button type="button" onClick={() => setShowCurrent(s => !s)} className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1.5 block">{t("settingsNewPassword")}</label>
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={e => { setNewPassword(e.target.value); setStatus("idle"); setError(""); }}
              autoComplete="new-password"
              className={inputClass}
            />
            <button type="button" onClick={() => setShowNew(s => !s)} className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">{t("settingsPasswordHint")}</p>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1.5 block">{t("settingsConfirmPassword")}</label>
          <input
            type={showNew ? "text" : "password"}
            value={confirmPassword}
            onChange={e => { setConfirmPassword(e.target.value); setStatus("idle"); setError(""); }}
            autoComplete="new-password"
            className={inputClass}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {status === "saved" && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{t("settingsPasswordUpdated")}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="bg-[#0F510F] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#0d4510] disabled:opacity-50 transition-colors"
        >
          {status === "saving" ? t("settingsPasswordSaving") : t("settingsChangePassword")}
        </button>
      </form>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Page
───────────────────────────────────────────────────────────────────────────── */

export default function SettingsPage() {
  const { t: rawT, lang } = useLanguage();
  const t = rawT as unknown as (key: string) => string;
  const isRtl = lang === "ar";
  const [activeSection, setActiveSection] = useState<SectionId>("whatsapp");

  return (
    <DashboardLayout>
      <div dir={isRtl ? "rtl" : "ltr"} className="max-w-5xl mx-auto">
        {/* Page title */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{t("settings")}</h1>
        </div>

        <div className="flex gap-6 items-start">
          {/* Left section nav */}
          <nav className="w-44 shrink-0">
            <ul className="space-y-0.5">
              {SECTIONS.map(s => (
                <li key={s.id}>
                  <button
                    onClick={() => setActiveSection(s.id)}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors text-start ${
                      activeSection === s.id
                        ? "bg-[#0F510F]/10 text-[#0F510F]"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    <span className={activeSection === s.id ? "text-[#0F510F]" : "text-gray-400"}>
                      {s.icon}
                    </span>
                    {t(s.labelKey)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Right panel */}
          <div className="flex-1 min-w-0">
            {activeSection === "whatsapp" && <WhatsAppPanel t={t} />}
            {activeSection === "branding" && <BrandingPanel t={t} />}
            {activeSection === "password" && <ChangePasswordPanel t={t} />}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
