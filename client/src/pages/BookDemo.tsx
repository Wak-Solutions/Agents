import { useState, useEffect, useRef } from "react";
import { nameError } from "@/lib/validate-name";
import { Video, CalendarDays, Clock, CheckCircle2, ChevronLeft, AlertCircle } from "lucide-react";

interface DaySlots {
  date: string;
  label: string;
  slots: string[];
}

type PageState = "form" | "loading" | "error" | "picking" | "confirming" | "success";

export default function BookDemo() {
  const [state, setState] = useState<PageState>("form");
  const [errorMsg, setErrorMsg] = useState("");
  const [days, setDays] = useState<DaySlots[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [bookedLabel, setBookedLabel] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [formError, setFormError] = useState("");
  const submittingRef = useRef(false);
  const confirmingRef = useRef(false);

  const handleFormSubmit = async () => {
    if (submittingRef.current) return;
    if (!customerName.trim()) { setFormError("Please enter your name."); return; }
    const nameErr = nameError(customerName);
    if (nameErr) { setFormError(nameErr); return; }
    if (!customerPhone.trim()) { setFormError("Please enter your phone number."); return; }
    const cleanPhone = customerPhone.trim().replace(/[\s\-().]/g, '');
    if (!/^\+?\d{7,15}$/.test(cleanPhone)) {
      setFormError("Please enter a valid phone number (e.g. +966501234567).");
      return;
    }
    if (customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) {
      setFormError("Please enter a valid email address.");
      return;
    }
    submittingRef.current = true;
    setFormError("");
    setState("loading");
    try {
      const r = await fetch("/api/book-demo");
      const data = await r.json();
      if (!r.ok) { setState("error"); setErrorMsg(data.message || "Something went wrong."); return; }
      setDays(data.days || []);
      setState("picking");
    } catch {
      setState("error");
      setErrorMsg("Failed to load available slots. Please try again.");
    } finally {
      submittingRef.current = false;
    }
  };

  const handleConfirm = async () => {
    if (!selectedDate || !selectedTime) return;
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setConfirming(true);
    try {
      const res = await fetch("/api/book-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate, time: selectedTime, customerName, customerPhone, customerEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.message || "Booking failed. Please try another slot.");
        setSelectedTime(null);
        setConfirming(false);
        return;
      }
      setBookedLabel(data.ksa_label || `${selectedDate} at ${selectedTime}`);
      setState("success");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setConfirming(false);
      confirmingRef.current = false;
    }
  };

  const selectedDayData = days.find(d => d.date === selectedDate);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0F510F]/5 to-background flex flex-col">
      {/* Header */}
      <header className="bg-[#0F510F] text-white px-5 py-4 flex items-center gap-3 shadow-md">
        <Video className="w-5 h-5" />
        <div>
          <p className="font-semibold text-sm">WAK Solutions</p>
          <p className="text-xs text-white/70">Book a Live Demo</p>
        </div>
      </header>

      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-8">

        {/* Contact form */}
        {state === "form" && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-bold text-foreground">Book a demo</h1>
              <p className="text-sm text-muted-foreground mt-1">Enter your details and pick a time that works for you.</p>
            </div>
            {formError && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">{formError}</p>
            )}
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Full name</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="e.g. Ahmed Al-Rashid"
                  className={`w-full border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0F510F]/30 focus:border-[#0F510F] ${nameError(customerName) ? "border-red-300 focus:ring-red-200" : "border-border"}`}
                />
                {nameError(customerName) && <p className="text-xs text-red-500 mt-1">{nameError(customerName)}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">WhatsApp number</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  placeholder="e.g. +966501234567"
                  className="w-full border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0F510F]/30 focus:border-[#0F510F]"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">
                  Email address <span className="text-muted-foreground font-normal text-xs">(optional — for booking confirmation)</span>
                </label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={e => setCustomerEmail(e.target.value)}
                  placeholder="e.g. ahmed@company.com"
                  className="w-full border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0F510F]/30 focus:border-[#0F510F]"
                />
              </div>
              <button
                onClick={handleFormSubmit}
                disabled={submittingRef.current}
                className="w-full bg-[#0F510F] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#0d4510] disabled:opacity-60 transition-colors"
              >
                See available times →
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {state === "loading" && (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
          </div>
        )}

        {/* Error */}
        {state === "error" && (
          <div className="bg-card border border-border rounded-xl p-6 text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
            <p className="font-semibold text-foreground">Unable to load booking page</p>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <button onClick={() => { setState("form"); setErrorMsg(""); }} className="text-sm text-[#0F510F] font-medium hover:underline">
              Try again
            </button>
          </div>
        )}

        {/* Date/time picker */}
        {state === "picking" && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-bold text-foreground">Choose a time</h1>
              <p className="text-sm text-muted-foreground mt-1">All times shown in Saudi Arabia time (AST, UTC+3).</p>
            </div>

            {errorMsg && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">{errorMsg}</p>
            )}

            {days.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
                No available slots in the next 30 days. Please contact WAK Solutions directly.
              </div>
            ) : !selectedDate ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <CalendarDays className="w-4 h-4 text-[#0F510F]" />
                  Select a date
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {days.map(d => (
                    <button
                      key={d.date}
                      onClick={() => { setSelectedDate(d.date); setSelectedTime(null); setErrorMsg(""); }}
                      className="bg-card border border-border hover:border-[#0F510F] hover:bg-[#0F510F]/5 text-left px-4 py-3 rounded-xl transition-colors"
                    >
                      <p className="font-semibold text-sm text-foreground">{d.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{d.slots.length} slot{d.slots.length !== 1 ? "s" : ""}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <button
                  onClick={() => { setSelectedDate(null); setSelectedTime(null); setErrorMsg(""); }}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {selectedDayData?.label}
                </button>

                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Clock className="w-4 h-4 text-[#0F510F]" />
                  Select a time
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {selectedDayData?.slots.map(slot => (
                    <button
                      key={slot}
                      onClick={() => { setSelectedTime(slot); setErrorMsg(""); }}
                      className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                        selectedTime === slot
                          ? "bg-[#0F510F] text-white border-[#0F510F]"
                          : "bg-card border-border hover:border-[#0F510F] hover:bg-[#0F510F]/5 text-foreground"
                      }`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>

                {selectedTime && (
                  <div className="bg-[#0F510F]/5 border border-[#0F510F]/20 rounded-xl p-4 space-y-3">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">Selected:</span> {selectedDayData?.label} at {selectedTime} KSA time
                    </p>
                    <button
                      onClick={handleConfirm}
                      disabled={confirming}
                      className="w-full bg-[#0F510F] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#0d4510] disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                    >
                      {confirming ? (
                        <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Confirming…</>
                      ) : (
                        "Confirm Meeting"
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Success */}
        {state === "success" && (
          <div className="bg-card border border-border rounded-xl p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-[#0F510F]/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-[#0F510F]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Meeting confirmed!</h2>
              <p className="text-sm text-muted-foreground mt-1">Your slot has been reserved.</p>
            </div>
            <div className="bg-muted rounded-xl px-5 py-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Date & Time (KSA)</p>
              <p className="font-semibold text-foreground">{bookedLabel}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              You will receive your meeting link via WhatsApp 15 minutes before the meeting starts. See you then!
            </p>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-muted-foreground border-t border-border/50">
        © 2026 WAK Solutions ·{" "}
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors underline underline-offset-2">
          Terms &amp; Conditions
        </a>
      </footer>
    </div>
  );
}
