import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useLanguage } from "@/lib/language-context";
import {
  User, Building2, MessageSquare, Bot, Users, Rocket,
  Check, ChevronRight, ChevronLeft, Eye, EyeOff, Globe,
  Plus, Trash2, Sparkles, Briefcase, MessageCircle, Zap,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

interface FAQ { question: string; answer: string }
interface AgentInvite { name: string; email: string }

interface FormData {
  // Step 1
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone: string;
  // Step 2
  businessName: string;
  industry: string;
  country: string;
  website: string;
  teamSize: string;
  // Step 3
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  whatsappVerified: boolean;
  whatsappDisplayName: string;
  // Step 4
  botName: string;
  greeting: string;
  tone: string;
  faqs: FAQ[];
  // Step 5
  agents: AgentInvite[];
}

const INITIAL_FORM: FormData = {
  firstName: "", lastName: "", email: "", password: "", confirmPassword: "", phone: "",
  businessName: "", industry: "", country: "", website: "", teamSize: "",
  phoneNumberId: "", wabaId: "", accessToken: "", whatsappVerified: false, whatsappDisplayName: "",
  botName: "", greeting: "", tone: "friendly", faqs: [{ question: "", answer: "" }],
  agents: [{ name: "", email: "" }],
};

/* ═══════════════════════════════════════════════════════════════════════════
   STEP SIDEBAR
   ═══════════════════════════════════════════════════════════════════════════ */

const STEP_ICONS = [User, Building2, MessageSquare, Bot, Users, Rocket];

function StepSidebar({
  currentStep, t, isRtl,
}: {
  currentStep: number;
  t: (key: string) => string;
  isRtl: boolean;
}) {
  const steps = [
    { key: "regStep1", desc: "regStep1Desc" },
    { key: "regStep2", desc: "regStep2Desc" },
    { key: "regStep3", desc: "regStep3Desc" },
    { key: "regStep4", desc: "regStep4Desc" },
    { key: "regStep5", desc: "regStep5Desc" },
    { key: "regStep6", desc: "regStep6Desc" },
  ];

  return (
    <div className="hidden lg:flex flex-col w-[40%] bg-[#0F510F] text-white p-8 min-h-screen relative">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-12">
        <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center text-white font-bold text-lg">
          W
        </div>
        <span className="font-bold text-lg">WAK Solutions</span>
      </div>

      {/* Steps */}
      <div className="flex-1 flex flex-col gap-1">
        {steps.map((step, i) => {
          const stepNum = i + 1;
          const Icon = STEP_ICONS[i];
          const isActive = stepNum === currentStep;
          const isCompleted = stepNum < currentStep;

          return (
            <div key={i} className="flex items-start gap-4">
              {/* Line + circle */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-all ${
                    isCompleted
                      ? "bg-white text-[#0F510F]"
                      : isActive
                        ? "bg-white/20 text-white ring-2 ring-white"
                        : "bg-white/10 text-white/40"
                  }`}
                >
                  {isCompleted ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                {i < 5 && (
                  <div
                    className={`w-0.5 h-10 my-1 ${
                      stepNum < currentStep ? "bg-white/50" : "bg-white/10"
                    }`}
                  />
                )}
              </div>

              {/* Label */}
              <div className="pt-2">
                <p
                  className={`text-sm font-semibold ${
                    isActive ? "text-white" : isCompleted ? "text-white/80" : "text-white/40"
                  }`}
                >
                  {t(step.key)}
                </p>
                {isActive && (
                  <p className="text-xs text-white/60 mt-0.5">{t(step.desc)}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom branding */}
      <p className="text-xs text-white/30 mt-auto pt-8">
        © {new Date().getFullYear()} WAK Solutions
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MOBILE STEP BAR
   ═══════════════════════════════════════════════════════════════════════════ */

function MobileStepBar({ currentStep, t }: { currentStep: number; t: (key: string) => string }) {
  return (
    <div className="lg:hidden bg-[#0F510F] px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 bg-white/15 rounded-lg flex items-center justify-center text-white font-bold text-sm">
          W
        </div>
        <span className="font-semibold text-white text-sm">WAK Solutions</span>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-all ${
              s < currentStep
                ? "bg-white"
                : s === currentStep
                  ? "bg-white/60"
                  : "bg-white/15"
            }`}
          />
        ))}
      </div>
      <p className="text-white/70 text-xs mt-2">
        {t("regStepOf").replace("{current}", String(currentStep)).replace("{total}", "6")}
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED FORM COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

function FormField({
  label, hint, children, className = "",
}: {
  label: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
        {hint && <span className="text-xs text-gray-400 font-normal ms-1.5">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0F510F]/20 focus:border-[#0F510F]/40 transition-colors";
const selectClass =
  "w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0F510F]/20 focus:border-[#0F510F]/40 transition-colors appearance-none";

/* ═══════════════════════════════════════════════════════════════════════════
   STEP 1: ACCOUNT
   ═══════════════════════════════════════════════════════════════════════════ */

function Step1({ form, setForm, t }: { form: FormData; setForm: (f: FormData) => void; t: (k: string) => string }) {
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t("regFirstName")}>
          <input
            className={inputClass}
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            autoFocus
          />
        </FormField>
        <FormField label={t("regLastName")}>
          <input
            className={inputClass}
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </FormField>
      </div>

      <FormField label={t("regEmail")}>
        <input
          type="email"
          className={inputClass}
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </FormField>

      <FormField label={t("regPassword")} hint={t("regPasswordHint")}>
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            className={inputClass + " pe-10"}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </FormField>

      <FormField label={t("regConfirmPassword")}>
        <div className="relative">
          <input
            type={showConfirm ? "text" : "password"}
            className={`${inputClass} pe-10 ${
              form.confirmPassword && form.password !== form.confirmPassword
                ? "border-red-300 focus:ring-red-200 focus:border-red-400"
                : ""
            }`}
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
          />
          <button
            type="button"
            onClick={() => setShowConfirm(!showConfirm)}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {form.confirmPassword && form.password !== form.confirmPassword && (
          <p className="text-xs text-red-500 mt-1">{t("regPasswordMismatch")}</p>
        )}
      </FormField>

      <FormField label={t("regPhone")} hint={t("regPhoneHint")}>
        <input
          type="tel"
          className={`${inputClass} ${
            form.phone && !/^\+[0-9]{9,14}$/.test(form.phone)
              ? "border-red-300 focus:ring-red-200 focus:border-red-400"
              : ""
          }`}
          placeholder="+966501234567"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        {form.phone && !/^\+[0-9]{9,14}$/.test(form.phone) && (
          <p className="text-xs text-red-500 mt-1">
            Phone must start with + and contain 10–15 digits (e.g. +966501234567)
          </p>
        )}
      </FormField>

      <div className="pt-2">
        <p className="text-sm text-gray-500">
          {t("regAlreadyHaveAccount")}{" "}
          <Link href="/login" className="text-[#0F510F] font-semibold hover:underline">
            {t("regSignIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEP 2: BUSINESS
   ═══════════════════════════════════════════════════════════════════════════ */

function Step2({ form, setForm, t }: { form: FormData; setForm: (f: FormData) => void; t: (k: string) => string }) {
  const industries = [
    { value: "technology", label: t("regIndustryTech") },
    { value: "retail", label: t("regIndustryRetail") },
    { value: "healthcare", label: t("regIndustryHealthcare") },
    { value: "education", label: t("regIndustryEducation") },
    { value: "finance", label: t("regIndustryFinance") },
    { value: "real_estate", label: t("regIndustryRealEstate") },
    { value: "hospitality", label: t("regIndustryHospitality") },
    { value: "other", label: t("regIndustryOther") },
  ];

  const countries = [
    { value: "SA", label: t("regCountrySA") },
    { value: "AE", label: t("regCountryAE") },
    { value: "KW", label: t("regCountryKW") },
    { value: "BH", label: t("regCountryBH") },
    { value: "QA", label: t("regCountryQA") },
    { value: "OM", label: t("regCountryOM") },
    { value: "EG", label: t("regCountryEG") },
    { value: "JO", label: t("regCountryJO") },
    { value: "other", label: t("regCountryOther") },
  ];

  const teamSizes = [
    { value: "1-5", label: t("regTeam1_5") },
    { value: "6-20", label: t("regTeam6_20") },
    { value: "21-50", label: t("regTeam21_50") },
    { value: "51-200", label: t("regTeam51_200") },
    { value: "200+", label: t("regTeam200") },
  ];

  return (
    <div className="space-y-5">
      <FormField label={t("regBusinessName")}>
        <input
          className={inputClass}
          value={form.businessName}
          onChange={(e) => setForm({ ...form, businessName: e.target.value })}
          autoFocus
        />
      </FormField>

      <FormField label={t("regIndustry")}>
        <select
          className={selectClass}
          value={form.industry}
          onChange={(e) => setForm({ ...form, industry: e.target.value })}
        >
          <option value="">{t("regSelectIndustry")}</option>
          {industries.map((i) => (
            <option key={i.value} value={i.value}>{i.label}</option>
          ))}
        </select>
      </FormField>

      <FormField label={t("regCountry")}>
        <select
          className={selectClass}
          value={form.country}
          onChange={(e) => setForm({ ...form, country: e.target.value })}
        >
          <option value="">{t("regSelectCountry")}</option>
          {countries.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </FormField>

      <FormField label={t("regWebsite")} hint={t("regWebsiteOptional")}>
        <input
          type="url"
          className={inputClass}
          placeholder="https://"
          value={form.website}
          onChange={(e) => setForm({ ...form, website: e.target.value })}
        />
      </FormField>

      <FormField label={t("regTeamSize")}>
        <select
          className={selectClass}
          value={form.teamSize}
          onChange={(e) => setForm({ ...form, teamSize: e.target.value })}
        >
          <option value="">{t("regSelectTeamSize")}</option>
          {teamSizes.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </FormField>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEP 3: WHATSAPP
   ═══════════════════════════════════════════════════════════════════════════ */

function Step3({ form, setForm, t }: { form: FormData; setForm: (f: FormData) => void; t: (k: string) => string }) {
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyError("");
    try {
      const resp = await fetch("/api/register/whatsapp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phoneNumberId: form.phoneNumberId,
          accessToken: form.accessToken,
        }),
      });
      const data = await resp.json();
      if (data.verified) {
        setForm({ ...form, whatsappVerified: true, whatsappDisplayName: data.displayName });
      } else {
        setVerifyError(data.error || t("regVerifyFailed"));
      }
    } catch {
      setVerifyError(t("regVerifyFailed"));
    } finally {
      setVerifying(false);
    }
  };

  const credentialsEmpty = !form.phoneNumberId && !form.accessToken;

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <p className="text-sm text-blue-700">{t("regWhatsAppHelp")}</p>
      </div>

      {credentialsEmpty && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800">
            ⚠️ Without WhatsApp credentials your chatbot will not work.
          </p>
          <p className="text-xs text-amber-700 mt-1">
            You can add these later in Settings, but the bot will be inactive until then.
          </p>
        </div>
      )}

      <FormField label={t("regPhoneNumberId")}>
        <input
          className={inputClass}
          value={form.phoneNumberId}
          onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value, whatsappVerified: false })}
          placeholder="e.g. 123456789012345"
          autoFocus
        />
      </FormField>

      <FormField label={t("regWabaId")}>
        <input
          className={inputClass}
          value={form.wabaId}
          onChange={(e) => setForm({ ...form, wabaId: e.target.value })}
          placeholder="e.g. 123456789012345"
        />
      </FormField>

      <FormField label={t("regAccessToken")}>
        <input
          type="password"
          className={inputClass}
          value={form.accessToken}
          onChange={(e) => setForm({ ...form, accessToken: e.target.value, whatsappVerified: false })}
          placeholder="EAAx..."
        />
      </FormField>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleVerify}
          disabled={!form.phoneNumberId || !form.accessToken || verifying}
          className="inline-flex items-center gap-2 bg-[#0F510F] text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-[#0d4510] transition-colors"
        >
          {verifying ? (
            <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("regVerifying")}</>
          ) : form.whatsappVerified ? (
            <><Check className="w-4 h-4" />{t("regVerified")}</>
          ) : (
            t("regVerify")
          )}
        </button>
        {form.whatsappVerified && (
          <span className="text-sm text-green-600 font-medium">{form.whatsappDisplayName}</span>
        )}
      </div>
      {verifyError && <p className="text-sm text-red-500">{verifyError}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEP 4: CHATBOT
   ═══════════════════════════════════════════════════════════════════════════ */

const TONES = [
  { value: "professional", icon: Briefcase, key: "regToneProfessional", desc: "regToneProfessionalDesc" },
  { value: "friendly", icon: MessageCircle, key: "regToneFriendly", desc: "regToneFriendlyDesc" },
  { value: "concise", icon: Zap, key: "regToneConcise", desc: "regToneConciseDesc" },
  { value: "enthusiastic", icon: Sparkles, key: "regToneEnthusiastic", desc: "regToneEnthusiasticDesc" },
];

function Step4({ form, setForm, t }: { form: FormData; setForm: (f: FormData) => void; t: (k: string) => string }) {
  const updateFaq = (index: number, field: "question" | "answer", value: string) => {
    const faqs = [...form.faqs];
    faqs[index] = { ...faqs[index], [field]: value };
    setForm({ ...form, faqs });
  };

  const addFaq = () => setForm({ ...form, faqs: [...form.faqs, { question: "", answer: "" }] });
  const removeFaq = (i: number) => setForm({ ...form, faqs: form.faqs.filter((_, j) => j !== i) });

  return (
    <div className="space-y-6">
      <FormField label={t("regBotName")}>
        <input
          className={inputClass}
          value={form.botName}
          onChange={(e) => setForm({ ...form, botName: e.target.value })}
          placeholder={form.businessName || "WAK Solutions"}
          autoFocus
        />
      </FormField>

      <FormField label={t("regGreeting")}>
        <input
          className={inputClass}
          value={form.greeting}
          onChange={(e) => setForm({ ...form, greeting: e.target.value })}
          placeholder={t("regGreetingPlaceholder")}
        />
      </FormField>

      {/* Tone selector cards */}
      <FormField label={t("regTone")}>
        <div className="grid grid-cols-2 gap-3">
          {TONES.map(({ value, icon: Icon, key, desc }) => (
            <button
              key={value}
              type="button"
              onClick={() => setForm({ ...form, tone: value })}
              className={`flex items-start gap-3 p-3.5 rounded-xl border-2 text-start transition-all ${
                form.tone === value
                  ? "border-[#0F510F] bg-[#0F510F]/5"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${form.tone === value ? "text-[#0F510F]" : "text-gray-400"}`} />
              <div>
                <p className={`text-sm font-medium ${form.tone === value ? "text-[#0F510F]" : "text-gray-700"}`}>{t(key)}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t(desc)}</p>
              </div>
            </button>
          ))}
        </div>
      </FormField>

      {/* FAQs */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-3">{t("regFaqs")}</p>
        <div className="space-y-3">
          {form.faqs.map((faq, i) => (
            <div key={i} className="flex gap-2">
              <div className="flex-1 space-y-2">
                <input
                  className={inputClass}
                  placeholder={t("regFaqQuestion")}
                  value={faq.question}
                  onChange={(e) => updateFaq(i, "question", e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder={t("regFaqAnswer")}
                  value={faq.answer}
                  onChange={(e) => updateFaq(i, "answer", e.target.value)}
                />
              </div>
              {form.faqs.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeFaq(i)}
                  className="text-gray-300 hover:text-red-400 transition-colors self-center"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addFaq}
          className="text-sm text-[#0F510F] font-medium mt-3 hover:underline flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />{t("regAddFaq")}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEP 5: INVITE AGENTS
   ═══════════════════════════════════════════════════════════════════════════ */

function Step5({ form, setForm, t }: { form: FormData; setForm: (f: FormData) => void; t: (k: string) => string }) {
  const updateAgent = (index: number, field: "name" | "email", value: string) => {
    const agents = [...form.agents];
    agents[index] = { ...agents[index], [field]: value };
    setForm({ ...form, agents });
  };

  const addAgent = () => setForm({ ...form, agents: [...form.agents, { name: "", email: "" }] });
  const removeAgent = (i: number) => setForm({ ...form, agents: form.agents.filter((_, j) => j !== i) });

  return (
    <div className="space-y-5">
      <div className="bg-[#0F510F]/5 border border-[#0F510F]/10 rounded-xl p-4">
        <p className="text-sm text-[#0F510F]">{t("regInviteNote")}</p>
      </div>

      <div className="space-y-4">
        {form.agents.map((agent, i) => (
          <div key={i} className="flex gap-3 items-start">
            <div className="flex-1 grid grid-cols-2 gap-3">
              <input
                className={inputClass}
                placeholder={t("regAgentName")}
                value={agent.name}
                onChange={(e) => updateAgent(i, "name", e.target.value)}
              />
              <input
                type="email"
                className={inputClass}
                placeholder={t("regAgentEmail")}
                value={agent.email}
                onChange={(e) => updateAgent(i, "email", e.target.value)}
              />
            </div>
            <span className="text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full mt-2 shrink-0">
              {t("regAgentRole")}
            </span>
            {form.agents.length > 1 && (
              <button
                type="button"
                onClick={() => removeAgent(i)}
                className="text-gray-300 hover:text-red-400 transition-colors mt-2.5"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addAgent}
        className="text-sm text-[#0F510F] font-medium hover:underline flex items-center gap-1"
      >
        <Plus className="w-3.5 h-3.5" />{t("regAddAgent")}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEP 6: GO LIVE
   ═══════════════════════════════════════════════════════════════════════════ */

function Step6({ currentStep, t }: { currentStep: number; t: (k: string) => string }) {
  const checks = [
    { key: "regChecklist1", done: currentStep >= 2 },
    { key: "regChecklist2", done: currentStep >= 3 },
    { key: "regChecklist3", done: currentStep >= 4 },
    { key: "regChecklist4", done: currentStep >= 5 },
    { key: "regChecklist5", done: currentStep >= 6 },
  ];

  return (
    <div className="flex flex-col items-center text-center py-8">
      <div className="w-20 h-20 bg-[#0F510F]/10 rounded-full flex items-center justify-center mb-6">
        <Rocket className="w-10 h-10 text-[#0F510F]" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900">{t("regGoLiveTitle")}</h2>
      <p className="text-gray-500 mt-2 mb-8">{t("regGoLiveSubtitle")}</p>

      <div className="w-full max-w-sm space-y-3 text-start">
        {checks.map((c, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 rounded-xl bg-green-50 border border-green-100"
          >
            <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm text-green-800 font-medium">{t(c.key)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export default function RegisterPage() {
  const { t: rawT, lang, toggleLang } = useLanguage();
  const t = rawT as unknown as (key: string) => string;
  const isRtl = lang === "ar";
  const [, setLocation] = useLocation();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [phoneError, setPhoneError] = useState("");

  const validatePhone = (phone: string): boolean => {
    if (!phone) return true; // optional field
    return /^\+[0-9]{9,14}$/.test(phone);
  };

  /* ─── Validation ───────────────────────────────────────────────── */
  const canContinue = (): boolean => {
    switch (step) {
      case 1:
        return !!(
          form.firstName &&
          form.lastName &&
          form.email &&
          form.password.length >= 8 &&
          form.password === form.confirmPassword &&
          validatePhone(form.phone)
        );
      case 2:
        return !!(form.businessName && form.industry && form.country);
      case 3:
        return true; // skippable
      case 4:
        return true; // minimal config is fine
      case 5:
        return true; // skippable
      case 6:
        return true;
      default:
        return false;
    }
  };

  /* ─── Step handlers ────────────────────────────────────────────── */
  const handleNext = async () => {
    setError("");
    setLoading(true);

    try {
      if (step === 1) {
        const resp = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            firstName: form.firstName,
            lastName: form.lastName,
            email: form.email,
            password: form.password,
            phone: form.phone,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          setError(data.error || "Registration failed");
          setLoading(false);
          return;
        }
      } else if (step === 2) {
        const resp2 = await fetch("/api/register/business", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            businessName: form.businessName,
            industry: form.industry,
            country: form.country,
            website: form.website,
            teamSize: form.teamSize,
          }),
        });
        if (!resp2.ok) {
          const d = await resp2.json().catch(() => ({}));
          setError(d.error || "Failed to save business details. Please try again.");
          setLoading(false);
          return;
        }
      } else if (step === 3) {
        if (form.phoneNumberId || form.accessToken) {
          const resp3 = await fetch("/api/register/whatsapp", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              phoneNumberId: form.phoneNumberId,
              wabaId: form.wabaId,
              accessToken: form.accessToken,
            }),
          });
          if (!resp3.ok) {
            const d = await resp3.json().catch(() => ({}));
            setError(d.error || "Failed to save WhatsApp credentials. Please try again.");
            setLoading(false);
            return;
          }
        }
      } else if (step === 4) {
        const resp4 = await fetch("/api/register/chatbot", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            botName: form.botName || form.businessName,
            greeting: form.greeting,
            tone: form.tone,
            faqs: form.faqs.filter((f) => f.question && f.answer),
          }),
        });
        if (!resp4.ok) {
          const d = await resp4.json().catch(() => ({}));
          setError(d.error || "Failed to save chatbot config. Please try again.");
          setLoading(false);
          return;
        }
      } else if (step === 5) {
        const validAgents = form.agents.filter((a) => a.name && a.email);
        if (validAgents.length > 0) {
          const resp5 = await fetch("/api/register/invite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ agents: validAgents }),
          });
          if (!resp5.ok) {
            const d = await resp5.json().catch(() => ({}));
            setError(d.error || "Failed to invite agents. Please try again.");
            setLoading(false);
            return;
          }
        }
      } else if (step === 6) {
        await fetch("/api/register/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        setLocation("/dashboard");
        return;
      }

      setStep(step + 1);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
    setError("");
  };

  /* ─── Render ───────────────────────────────────────────────────── */
  const stepTitles: Record<number, string> = {
    1: t("regStep1"),
    2: t("regStep2"),
    3: t("regStep3"),
    4: t("regStep4"),
    5: t("regStep5"),
    6: t("regStep6"),
  };

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-screen flex flex-col lg:flex-row bg-white font-sans antialiased">
      {/* Desktop sidebar */}
      <StepSidebar currentStep={step} t={t} isRtl={isRtl} />

      {/* Mobile top bar */}
      <MobileStepBar currentStep={step} t={t} />

      {/* Right panel */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 lg:px-10 py-4 border-b border-gray-100">
          <div className="lg:hidden" />
          <div className="hidden lg:block" />
          <button
            onClick={toggleLang}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <Globe className="w-4 h-4" />
            {lang === "en" ? "العربية" : "English"}
          </button>
        </div>

        {/* Form area */}
        <div className="flex-1 overflow-y-auto px-6 lg:px-10 py-8">
          <div className="max-w-xl mx-auto">
            {/* Step title */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">{stepTitles[step]}</h2>
              {step === 1 && (
                <p className="text-gray-500 mt-1">{t("regSubtitle")}</p>
              )}
            </div>

            {/* Step content */}
            {step === 1 && <Step1 form={form} setForm={setForm} t={t} />}
            {step === 2 && <Step2 form={form} setForm={setForm} t={t} />}
            {step === 3 && <Step3 form={form} setForm={setForm} t={t} />}
            {step === 4 && <Step4 form={form} setForm={setForm} t={t} />}
            {step === 5 && <Step5 form={form} setForm={setForm} t={t} />}
            {step === 6 && <Step6 currentStep={step} t={t} />}

            {/* Error */}
            {error && (
              <div className="mt-4 bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-gray-100 px-6 lg:px-10 py-4">
          <div className="max-w-xl mx-auto flex items-center justify-between">
            {/* Back */}
            <div>
              {step > 1 && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors font-medium"
                >
                  {isRtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                  {t("regBack")}
                </button>
              )}
            </div>

            {/* Step indicator */}
            <span className="text-xs text-gray-400">
              {t("regStepOf").replace("{current}", String(step)).replace("{total}", "6")}
            </span>

            {/* Continue */}
            <button
              type="button"
              onClick={handleNext}
              disabled={!canContinue() || loading}
              className="inline-flex items-center gap-2 bg-[#0F510F] text-white px-6 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-[#0d4510] transition-colors"
            >
              {loading ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("regSaving")}</>
              ) : step === 6 ? (
                <>{t("regOpenDashboard")} {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</>
              ) : step === 3 || step === 5 ? (
                // Show skip or continue
                canContinue() ? (
                  <>{t("regContinue")} {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</>
                ) : (
                  <>{t("regSkipForNow")} {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</>
                )
              ) : (
                <>{t("regContinue")} {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
