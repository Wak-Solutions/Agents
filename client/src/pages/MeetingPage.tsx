import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { AlertCircle } from "lucide-react";

interface MeetingData {
  meeting_link: string | null;
  scheduled_time: string | null;
  status: string;
}

type PageState = "loading" | "invalid";

export default function MeetingPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Fetch meeting details, then redirect straight to the Daily.co room.
  // We deliberately do NOT embed Daily in an iframe — mobile browsers
  // (especially the WhatsApp in-app browser and iOS Safari) frequently
  // block the cross-origin embed and render a blank page. Sending the
  // customer to the room URL directly is the most reliable path.
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
        window.location.href = data.meeting_link;
      })
      .catch(() => {
        setErrorMsg("Unable to load meeting. Please try again.");
        setState("invalid");
      });
  }, [token]);

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

  // ── Loading / redirecting to Daily.co room ──────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F5F2EC] flex flex-col items-center justify-center px-4">
      <div className="w-10 h-10 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin mb-4" />
      <p className="text-sm text-gray-600">Opening your meeting…</p>
    </div>
  );
}
