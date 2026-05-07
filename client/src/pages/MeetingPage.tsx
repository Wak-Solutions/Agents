import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { AlertCircle, CheckCircle2 } from "lucide-react";

interface MeetingData {
  meeting_link: string | null;
  scheduled_time: string | null;
  status: string;
}

type PageState = "loading" | "invalid" | "meeting" | "done";

function formatScheduledTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " AST";
}

export default function MeetingPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>("loading");
  const [meeting, setMeeting] = useState<MeetingData | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [meetingEnded, setMeetingEnded] = useState(false);

  // Fetch meeting details
  useEffect(() => {
    fetch(`/api/meeting/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErrorMsg(body.message || "This meeting link is not valid.");
          setState("invalid");
          return;
        }
        const data: MeetingData = await res.json();
        if (!data.meeting_link) {
          setErrorMsg("Meeting room has not been set up yet.");
          setState("invalid");
          return;
        }
        setMeeting(data);
        setState("meeting");
      })
      .catch(() => {
        setErrorMsg("Unable to load meeting. Please try again.");
        setState("invalid");
      });
  }, [token]);

  // Listen for Daily.co postMessage when call ends
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.action === "left-meeting") {
        setMeetingEnded(true);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Transition to done when call ends
  useEffect(() => {
    if (meetingEnded) setState("done");
  }, [meetingEnded]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (state === "loading") {
    return (
      <div className="min-h-screen bg-[#F5F2EC] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
      </div>
    );
  }

  // ── Invalid ──────────────────────────────────────────────────────────────────
  if (state === "invalid") {
    return (
      <div className="min-h-screen bg-[#F5F2EC] flex flex-col items-center justify-center px-4">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-sm border border-gray-100">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-lg font-semibold text-gray-800 mb-1 leading-snug" dir="rtl">
            هذا الرابط غير صالح.
          </p>
          <p className="text-lg font-semibold text-gray-800 mb-4">
            This meeting link is not valid.
          </p>
          {errorMsg && <p className="text-sm text-gray-400">{errorMsg}</p>}
        </div>
      </div>
    );
  }

  // ── Thank-you / Done ─────────────────────────────────────────────────────────
  if (state === "done") {
    return (
      <div className="min-h-screen bg-[#F5F2EC] flex flex-col items-center justify-center px-4">
        <div className="bg-white rounded-2xl p-10 max-w-md w-full text-center shadow-sm border border-gray-100">
          <div className="w-16 h-16 rounded-full bg-[#408440]/10 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-9 h-9 text-[#408440]" />
          </div>
          <p className="text-xl font-bold text-[#0F510F] mb-2" dir="rtl">
            شكراً لحضوركم
          </p>
          <p className="text-xl font-bold text-[#0F510F] mb-5">
            Thank you for joining
          </p>
          <p className="text-sm text-gray-600 leading-relaxed mb-1">
            We appreciate your time. Our team will follow up with you shortly.
          </p>
          <p className="text-sm text-gray-500 leading-relaxed" dir="rtl">
            نقدّر وقتكم. سيتواصل معكم فريقنا قريباً.
          </p>
        </div>
      </div>
    );
  }

  // ── Active meeting ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-[#F5F2EC]">
      {/* Branded header */}
      <header className="bg-[#0F510F] px-5 py-3 flex items-center justify-between flex-shrink-0 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">W</span>
          </div>
          <span className="text-white font-semibold text-sm">WAK Solutions</span>
        </div>
        {meeting?.scheduled_time && (
          <span className="text-white/70 text-xs hidden sm:block">
            {formatScheduledTime(meeting.scheduled_time)}
          </span>
        )}
      </header>

      {/* Daily.co iframe — fills remaining viewport */}
      <iframe
        src={meeting!.meeting_link!}
        allow="camera; microphone; fullscreen; speaker; display-capture"
        style={{ width: "100%", flex: 1, border: "none", minHeight: 0 }}
        title="WAK Solutions Meeting"
      />
    </div>
  );
}
