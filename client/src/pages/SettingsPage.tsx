import { useState, useEffect } from "react";
import { MessageSquare, Eye, EyeOff, Check, AlertCircle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useLanguage } from "@/lib/language-context";

/* ─────────────────────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────────────────────── */

interface WhatsAppCredentials {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
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
  const [creds, setCreds] = useState<WhatsAppCredentials>({ phoneNumberId: "", wabaId: "", accessToken: "" });
  const [revealToken, setRevealToken] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyError, setVerifyError] = useState("");
  const [verifiedName, setVerifiedName] = useState("");

  // Reset verified state when any credential changes
  const updateCreds = (patch: Partial<WhatsAppCredentials>) => {
    setCreds(prev => ({ ...prev, ...patch }));
    setVerifyStatus("idle");
    setVerifiedName("");
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
      if (data.verified) {
        setVerifyStatus("verified");
        setVerifiedName(data.displayName ?? "");
      } else {
        setVerifyStatus("error");
        setVerifyError(data.wabaError || data.error || t("settingsLoadError"));
      }
    } catch {
      setVerifyStatus("error");
      setVerifyError(t("settingsLoadError"));
    }
  };

  const handleSave = async () => {
    if (verifyStatus !== "verified") {
      setSaveError(t("settingsVerifyFirst"));
      return;
    }
    setSaveStatus("saving");
    setSaveError("");
    try {
      const resp = await fetch("/api/settings/whatsapp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(creds),
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
        </div>

        {/* Save row */}
        <div className="pt-2 border-t border-gray-100 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveStatus === "saving"}
            className="inline-flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-gray-700 transition-colors"
          >
            {saveStatus === "saving" ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("settingsSaving")}</>
            ) : saveStatus === "saved" ? (
              <><Check className="w-4 h-4" />{t("settingsSaved")}</>
            ) : (
              t("settingsSave")
            )}
          </button>
          {saveError && (
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

type SectionId = "whatsapp";

interface Section {
  id: SectionId;
  icon: React.ReactNode;
  labelKey: string;
}

const SECTIONS: Section[] = [
  { id: "whatsapp", icon: <MessageSquare className="w-4 h-4" />, labelKey: "settingsWhatsApp" },
];

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
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
