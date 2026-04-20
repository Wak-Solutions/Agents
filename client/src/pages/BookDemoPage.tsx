import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { CalendarDays, Clock, CheckCircle2, ChevronLeft, AlertCircle, Video } from "lucide-react";

interface DaySlots {
  date: string;
  label: string;
  slots: string[];
}

type PageState = "loading" | "error" | "picking" | "confirming" | "success";

export default function BookDemoPage() {
  const [state, setState] = useState<PageState>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [days, setDays] = useState<DaySlots[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [bookedLabel, setBookedLabel] = useState("");
  const [meetingLink, setMeetingLink] = useState("");

  useEffect(() => {
    fetch("/api/demo-booking/slots", { credentials: "include" })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) { setState("error"); setErrorMsg(data.message || "Failed to load slots."); return; }
        setDays(data.days || []);
        setState("picking");
      })
      .catch(() => { setState("error"); setErrorMsg("Network error. Please try again."); });
  }, []);

  const handleConfirm = async () => {
    if (!selectedDate || !selectedTime) return;
    setConfirming(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/demo-booking/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ date: selectedDate, time: selectedTime }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.message || "Booking failed. Please try another slot.");
        setSelectedTime(null);
        setConfirming(false);
        return;
      }
      setBookedLabel(data.ksa_label || `${selectedDate} at ${selectedTime}`);
      setMeetingLink(data.meeting_link || "");
      setState("success");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setConfirming(false);
    }
  };

  const selectedDayData = days.find(d => d.date === selectedDate);

  return (
    <DashboardLayout>
      <div className="max-w-lg mx-auto space-y-6">

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Book a Demo</h1>
          <p className="text-sm text-gray-500 mt-1">Pick a time and we'll set up a video call. All times are KSA (UTC+3).</p>
        </div>

        {/* Loading */}
        {state === "loading" && (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
          </div>
        )}

        {/* Error */}
        {state === "error" && (
          <div className="bg-white border border-border rounded-xl p-6 text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
            <p className="font-semibold text-gray-900">Unable to load booking slots</p>
            <p className="text-sm text-gray-500">{errorMsg}</p>
          </div>
        )}

        {/* Picking */}
        {state === "picking" && (
          <div className="space-y-6">
            {errorMsg && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
                {errorMsg}
              </p>
            )}

            {days.length === 0 ? (
              <div className="bg-white border border-border rounded-xl p-8 text-center text-gray-500 text-sm">
                No available slots in the next 30 days. Please check back later.
              </div>
            ) : !selectedDate ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <CalendarDays className="w-4 h-4 text-[#0F510F]" />
                  Select a date
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {days.map(d => (
                    <button
                      key={d.date}
                      onClick={() => { setSelectedDate(d.date); setSelectedTime(null); setErrorMsg(""); }}
                      className="bg-white border border-border hover:border-[#0F510F] hover:bg-[#0F510F]/5 text-left px-4 py-3 rounded-xl transition-colors"
                    >
                      <p className="font-semibold text-sm text-gray-900">{d.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{d.slots.length} slot{d.slots.length !== 1 ? "s" : ""} available</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <button
                  onClick={() => { setSelectedDate(null); setSelectedTime(null); setErrorMsg(""); }}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {selectedDayData?.label}
                </button>

                <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
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
                          : "bg-white border-border hover:border-[#0F510F] hover:bg-[#0F510F]/5 text-gray-900"
                      }`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>

                {selectedTime && (
                  <div className="bg-[#0F510F]/5 border border-[#0F510F]/20 rounded-xl p-4 space-y-3">
                    <p className="text-sm text-gray-700">
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
                        "Confirm Demo"
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
          <div className="bg-white border border-border rounded-xl p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-[#0F510F]/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-[#0F510F]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Demo confirmed!</h2>
              <p className="text-sm text-gray-500 mt-1">Your slot has been reserved.</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-5 py-4 space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Date & Time (KSA)</p>
              <p className="font-semibold text-gray-900">{bookedLabel}</p>
            </div>
            {meetingLink && (
              <a
                href={meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[#0F510F] text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-[#0d4510] transition-colors"
              >
                <Video className="w-4 h-4" /> Join Meeting
              </a>
            )}
            <p className="text-sm text-gray-500">
              A confirmation email has been sent to your registered address.
            </p>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
