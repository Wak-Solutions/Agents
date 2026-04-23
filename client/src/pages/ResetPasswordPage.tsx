import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { Lock, Eye, EyeOff, Check, AlertCircle } from "lucide-react";

const inputClass =
  "w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0F510F]/20 focus:border-[#0F510F]/40 transition-colors";

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const [, setLocation] = useLocation();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const canSubmit =
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    status !== "saving";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setError("New password and confirmation do not match."); return; }

    setStatus("saving");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setError(data.message || "Could not reset password.");
        return;
      }
      setStatus("saved");
    } catch {
      setStatus("error");
      setError("Network error. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
        </div>

        <section className="bg-white border border-gray-200 rounded-2xl p-6 max-w-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[#0F510F]/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-[#0F510F]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Choose a new password</h2>
              <p className="text-xs text-gray-500 mt-0.5">Enter your new password below to regain access to your account.</p>
            </div>
          </div>

          {status === "saved" ? (
            <div className="space-y-4 max-w-md">
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>Password updated successfully.</span>
              </div>
              <button
                onClick={() => setLocation("/login")}
                className="bg-[#0F510F] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#0d4510] transition-colors"
              >
                Go to login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1.5 block">New password</label>
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
                <p className="text-[11px] text-gray-500 mt-1">At least 8 characters.</p>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 mb-1.5 block">Confirm new password</label>
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

              <button
                type="submit"
                disabled={!canSubmit}
                className="bg-[#0F510F] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#0d4510] disabled:opacity-50 transition-colors inline-flex items-center gap-2"
              >
                {status === "saving" && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {status === "saving" ? "Saving…" : "Reset password"}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
