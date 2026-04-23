import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const [, setLocation] = useLocation();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const canSubmit =
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    status !== "saving";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="WAK Solutions" className="h-14 w-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900">WAK Solutions</h1>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          {status === "saved" ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-[#0F510F]/10 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-[#0F510F]" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Password updated</h2>
              <p className="text-sm text-gray-500">Your password has been reset successfully. You can now sign in with your new password.</p>
              <button
                onClick={() => setLocation("/login")}
                className="w-full bg-[#0F510F] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#0d4510] transition-colors"
              >
                Go to login
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center text-center mb-6">
                <h2 className="text-lg font-semibold text-gray-900">Choose a new password</h2>
                <p className="text-sm text-gray-500 mt-1">Enter your new password below.</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-1.5">
                    <Lock className="w-3.5 h-3.5 text-gray-400" />
                    New password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={e => { setNewPassword(e.target.value); setStatus("idle"); setError(""); }}
                      autoComplete="new-password"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0F510F]/20 focus:border-[#0F510F]/40 bg-white"
                    />
                    <button type="button" onClick={() => setShowPassword(s => !s)} className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">At least 8 characters.</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">Confirm new password</label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); setStatus("idle"); setError(""); }}
                    autoComplete="new-password"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0F510F]/20 focus:border-[#0F510F]/40 bg-white"
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
                  className="w-full bg-[#0F510F] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#0d4510] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {status === "saving" && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Reset password
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
