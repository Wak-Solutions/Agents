import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import {
  X, ArrowRight, ArrowLeft, Inbox, MessageCircle, Calendar,
  TrendingUp, BarChart3, Bot, Users, Mic, ChevronRight,
  Send, Phone, Clock, CheckCheck, Star, AlertCircle,
  Video, FileText, Upload, Plus, Monitor,
} from "lucide-react";

/* ─── Brand ───────────────────────────────────────────────────── */
const G = "#0F510F";
const G2 = "#408440";
const CR = "#F5F2EC";

/* ─── Types ───────────────────────────────────────────────────── */
interface Screen {
  id: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  mobile?: boolean;
}

const SCREENS: Screen[] = [
  { id: "inbox", title: "Inbox", desc: "See all customer conversations in one place with real-time updates.", icon: <Inbox className="w-4 h-4" />, mobile: true },
  { id: "live-chat", title: "Live Chat with Bot", desc: "Watch the AI assistant handle conversations and hand off to agents.", icon: <MessageCircle className="w-4 h-4" /> },
  { id: "meetings", title: "Meetings", desc: "Schedule, track, and join customer meetings from the dashboard.", icon: <Calendar className="w-4 h-4" /> },
  { id: "journey", title: "Customer Journey", desc: "Visualize every touchpoint from first contact to resolution.", icon: <TrendingUp className="w-4 h-4" /> },
  { id: "stats", title: "Statistics", desc: "Track key metrics and agent performance at a glance.", icon: <BarChart3 className="w-4 h-4" />, mobile: true },
  { id: "chatbot", title: "Chatbot Config", desc: "Configure your AI assistant's personality, FAQs, and rules.", icon: <Bot className="w-4 h-4" /> },
  { id: "contacts", title: "Contacts", desc: "Manage your customer database and bulk import contacts.", icon: <Users className="w-4 h-4" /> },
];

/* ─── Helpers ─────────────────────────────────────────────────── */
const Badge = ({ children, color = "bg-red-500" }: { children: React.ReactNode; color?: string }) => (
  <span className={`${color} text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1`}>{children}</span>
);

const StatusDot = ({ color }: { color: string }) => (
  <span className={`w-2 h-2 rounded-full ${color} inline-block`} />
);

/* ═══════════════════════════════════════════════════════════════ */
/*  SCREEN COMPONENTS                                              */
/* ═══════════════════════════════════════════════════════════════ */

/* ─── Screen 1: Inbox ─────────────────────────────────────────── */
const inboxConvos = [
  { phone: "+966 5** ***4821", name: "Ahmed Al-Rashid", last: "Thank you, I'll be there!", time: "2m ago", unread: 0, active: true },
  { phone: "+966 5** ***7734", name: "Sara Mohammed", last: "🎤 Voice note (0:12)", time: "8m ago", unread: 2, active: false },
  { phone: "+966 5** ***9102", name: "Khalid Omar", last: "Can I reschedule my appointment?", time: "23m ago", unread: 1, active: false },
  { phone: "+966 5** ***3356", name: "Fatima Hassan", last: "Bot: How can I help you today?", time: "1h ago", unread: 0, active: false },
  { phone: "+966 5** ***6601", name: "Yousef Nasser", last: "I need to speak with a manager", time: "3h ago", unread: 0, active: false },
];

const inboxMessages = [
  [
    { from: "customer", text: "Hello, I booked a meeting for tomorrow at 10 AM", time: "10:02 AM" },
    { from: "bot", text: "Hi Ahmed! 👋 I can see your booking for tomorrow, Sunday at 10:00 AM with Agent Nora. Is there anything you'd like to change?", time: "10:02 AM", label: "AI Assistant" },
    { from: "customer", text: "No, just confirming the location", time: "10:03 AM" },
    { from: "agent", text: "Hi Ahmed, this is Nora. Your meeting will be via video call. I'll send you the link 30 minutes before. See you tomorrow!", time: "10:05 AM", label: "Agent Nora" },
    { from: "customer", text: "Thank you, I'll be there!", time: "10:06 AM" },
  ],
  [
    { from: "customer", text: "مرحبا، عندي سؤال عن الخدمة", time: "10:14 AM" },
    { from: "bot", text: "أهلاً سارة! 👋 كيف أقدر أساعدك؟", time: "10:14 AM", label: "AI Assistant" },
    { from: "customer", text: "🎤 Voice note (0:12)", time: "10:15 AM", voice: true, transcription: "أبي أعرف أسعار الباقات والخدمات المتوفرة عندكم" },
    { from: "bot", text: "تم تفريغ رسالتك الصوتية. عندنا ثلاث باقات: المبتدئ ٢٩٩ ر.س، النمو ٧٩٩ ر.س، والمؤسسات بسعر مخصص. أيها يناسبك؟", time: "10:15 AM", label: "AI Assistant" },
  ],
];

function ScreenInbox({ portrait = false }: { portrait?: boolean }) {
  const [selected, setSelected] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const msgs = inboxMessages[selected] ?? inboxMessages[0];

  const chatMessages = msgs.map((m, i) => (
    <div key={i} className={`flex ${m.from === "customer" ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[75%] rounded-xl px-3 py-2 shadow-sm ${
        m.from === "customer" ? "bg-white text-gray-800" :
        m.from === "bot" ? "bg-gray-100 text-gray-800 border border-gray-200" :
        "bg-[#DCF8C6] text-gray-800"
      }`}>
        {m.label && (
          <div className={`text-[10px] font-semibold mb-0.5 ${m.from === "bot" ? "text-[#408440]" : "text-blue-600"}`}>
            {m.from === "bot" && <Bot className="w-3 h-3 inline mr-0.5 -mt-0.5" />}
            {m.label}
          </div>
        )}
        {m.voice ? (
          <div>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 mb-1.5">
              <Mic className="w-4 h-4 text-[#0F510F] shrink-0" />
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full w-[70%] bg-[#0F510F] rounded-full" />
              </div>
              <span className="text-[10px] text-gray-500">0:12</span>
            </div>
            <div className="text-[10px] text-gray-500 italic bg-gray-50 rounded px-2 py-1">
              <FileText className="w-3 h-3 inline mr-0.5 -mt-0.5" /> Transcription: {m.transcription}
            </div>
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed">{m.text}</p>
        )}
        <div className="flex items-center justify-end gap-1 mt-0.5">
          <span className="text-[10px] text-gray-400">{m.time}</span>
          {m.from !== "customer" && <CheckCheck className="w-3 h-3 text-blue-400" />}
        </div>
      </div>
    </div>
  ));

  const chatInput = (
    <div className="bg-white border-t border-gray-200 px-4 py-2 flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-xs text-gray-400">Type a message...</div>
      <div className="w-8 h-8 bg-[#0F510F] rounded-full flex items-center justify-center">
        <Send className="w-3.5 h-3.5 text-white" />
      </div>
    </div>
  );

  /* ── Portrait mobile: single-panel (list → chat) ── */
  if (portrait) {
    if (chatOpen) {
      return (
        <div className="flex flex-col h-full bg-[#F0EDE8]">
          <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center gap-3">
            <button
              onClick={() => setChatOpen(false)}
              className="w-11 h-11 flex items-center justify-center -ms-2 text-[#0F510F]"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 rounded-full bg-[#0F510F]/10 flex items-center justify-center">
              <span className="text-xs font-bold text-[#0F510F]">{inboxConvos[selected]?.name?.charAt(0)}</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-800">{inboxConvos[selected]?.name}</div>
              <div className="text-[10px] text-gray-400">{inboxConvos[selected]?.phone}</div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">{chatMessages}</div>
          {chatInput}
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full bg-white">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/80">
          <div className="text-sm font-semibold text-gray-800">
            Inbox <span className="text-gray-400 font-normal">· 6 active conversations</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {inboxConvos.map((c, i) => (
            <button
              key={i}
              onClick={() => { setSelected(Math.min(i, 1)); setChatOpen(true); }}
              className="w-full text-start px-4 py-4 border-b border-gray-50 hover:bg-gray-50 transition-colors active:bg-gray-100"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-gray-400">{c.time}</span>
                  {c.unread > 0 && <Badge>{c.unread}</Badge>}
                </div>
              </div>
              <div className="text-xs text-gray-500 truncate">{c.last}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{c.phone}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* ── Desktop / landscape: two-panel ── */
  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-[280px] border-e border-gray-200 flex flex-col bg-white shrink-0">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/80">
          <div className="text-sm font-semibold text-gray-800">Inbox <span className="text-gray-400 font-normal">· 6 active conversations</span></div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {inboxConvos.map((c, i) => (
            <button
              key={i}
              onClick={() => setSelected(Math.min(i, 1))}
              className={`w-full text-start px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                (i === selected) ? "bg-[#0F510F]/5 border-s-2 border-s-[#0F510F]" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-gray-400">{c.time}</span>
                  {c.unread > 0 && <Badge>{c.unread}</Badge>}
                </div>
              </div>
              <div className="text-xs text-gray-500 truncate">{c.last}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{c.phone}</div>
            </button>
          ))}
        </div>
      </div>
      {/* Chat panel */}
      <div className="flex-1 flex flex-col bg-[#F0EDE8] min-w-0">
        <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#0F510F]/10 flex items-center justify-center">
            <span className="text-xs font-bold text-[#0F510F]">{inboxConvos[selected]?.name?.charAt(0)}</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">{inboxConvos[selected]?.name}</div>
            <div className="text-[10px] text-gray-400">{inboxConvos[selected]?.phone}</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">{chatMessages}</div>
        {chatInput}
      </div>
    </div>
  );
}

/* ─── Screen 2: Live Chat with Bot ────────────────────────────── */
function ScreenLiveChat() {
  const liveConvos = [
    { name: "Omar Saleh", phone: "+966 5** ***2288", last: "Bot: Here's your booking link!", time: "Just now", unread: 0 },
    { name: "Reem Al-Dosari", phone: "+966 5** ***5510", last: "What are your working hours?", time: "3m ago", unread: 1 },
    { name: "Majed Turki", phone: "+966 5** ***8847", last: "Bot: Your order #4521 is on the way", time: "12m ago", unread: 0 },
  ];
  const [sel, setSel] = useState(0);

  return (
    <div className="flex h-full">
      <div className="w-[280px] border-e border-gray-200 flex flex-col bg-white shrink-0">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/80">
          <div className="text-sm font-semibold text-gray-800">Inbox <span className="text-gray-400 font-normal">· 3 bot-active</span></div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {liveConvos.map((c, i) => (
            <button
              key={i}
              onClick={() => setSel(i)}
              className={`w-full text-start px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                i === sel ? "bg-[#0F510F]/5 border-s-2 border-s-[#0F510F]" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-gray-400">{c.time}</span>
                  {c.unread > 0 && <Badge>{c.unread}</Badge>}
                </div>
              </div>
              <div className="text-xs text-gray-500 truncate">{c.last}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{c.phone}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col bg-[#F0EDE8] min-w-0">
        <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#0F510F]/10 flex items-center justify-center">
            <span className="text-xs font-bold text-[#0F510F]">O</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">Omar Saleh</div>
            <div className="text-[10px] text-gray-400">+966 5** ***2288</div>
          </div>
          <div className="ms-auto flex items-center gap-1 text-[10px] text-[#408440] bg-green-50 px-2 py-1 rounded-full">
            <Bot className="w-3 h-3" /> AI handling
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {[
            { from: "customer", text: "مرحبا، أبي أحجز موعد", time: "11:20 AM" },
            { from: "bot", text: "أهلاً عمر! 👋 أقدر أساعدك بحجز موعد. متى يناسبك؟", time: "11:20 AM", label: "AI Assistant" },
            { from: "customer", text: "يوم الأحد إذا ممكن", time: "11:21 AM" },
            { from: "bot", text: "Would you like to book a meeting with one of our agents?", time: "11:21 AM", label: "AI Assistant" },
            { from: "customer", text: "Yes please", time: "11:22 AM" },
            { from: "bot", text: "Great! Here's your booking link:", time: "11:22 AM", label: "AI Assistant", hasLink: true },
          ].map((m, i) => (
            <div key={i} className={`flex ${m.from === "customer" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[75%] rounded-xl px-3 py-2 shadow-sm ${
                m.from === "customer" ? "bg-white text-gray-800" : "bg-gray-100 text-gray-800 border border-gray-200"
              }`}>
                {m.label && (
                  <div className="text-[10px] font-semibold text-[#408440] mb-0.5">
                    <Bot className="w-3 h-3 inline mr-0.5 -mt-0.5" />{m.label}
                  </div>
                )}
                <p className="text-[13px] leading-relaxed">{m.text}</p>
                {m.hasLink && (
                  <div className="mt-1.5 bg-white rounded-lg border border-[#0F510F]/20 px-3 py-2 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#0F510F]" />
                    <div>
                      <div className="text-xs font-medium text-[#0F510F]">Book a meeting</div>
                      <div className="text-[10px] text-gray-400">Sunday, 10:00 AM — Agent Nora</div>
                    </div>
                    <ChevronRight className="w-3 h-3 text-gray-400 ms-auto" />
                  </div>
                )}
                <span className="block text-[10px] text-gray-400 text-end mt-0.5">{m.time}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white border-t border-gray-200 px-4 py-2 flex items-center gap-2">
          <div className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-xs text-gray-400">Type a message...</div>
          <div className="w-8 h-8 bg-[#0F510F] rounded-full flex items-center justify-center">
            <Send className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Screen 3: Meetings ──────────────────────────────────────── */
function ScreenMeetings() {
  const rows = [
    { name: "Ahmed Al-Rashid", phone: "****4821", date: "Apr 6, 2026", time: "10:00 AM", status: "Scheduled", agent: "Nora", color: "bg-blue-100 text-blue-700" },
    { name: "Sara Mohammed", phone: "****7734", date: "Apr 6, 2026", time: "02:00 PM", status: "In Progress", agent: "Fahad", color: "bg-yellow-100 text-yellow-700" },
    { name: "Omar Saleh", phone: "****2288", date: "Apr 7, 2026", time: "11:00 AM", status: "Scheduled", agent: "Nora", color: "bg-blue-100 text-blue-700" },
    { name: "Khalid Omar", phone: "****9102", date: "Apr 5, 2026", time: "09:00 AM", status: "Completed", agent: "Maha", color: "bg-green-100 text-green-700" },
  ];

  return (
    <div className="h-full bg-gray-50 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Meetings</h2>
          <p className="text-sm text-gray-500">Upcoming and past meetings with customers</p>
        </div>
        <button className="bg-[#0F510F] text-white text-xs font-medium px-4 py-2 rounded-lg flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> New Meeting
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-start px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
              <th className="text-start px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="text-start px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
              <th className="text-start px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="text-start px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Agent</th>
              <th className="text-start px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-800">{r.name}</div>
                  <div className="text-[10px] text-gray-400">{r.phone}</div>
                </td>
                <td className="px-4 py-3 text-gray-600">{r.date}</td>
                <td className="px-4 py-3 text-gray-600">{r.time}</td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${r.color}`}>{r.status}</span>
                </td>
                <td className="px-4 py-3 text-gray-600">{r.agent}</td>
                <td className="px-4 py-3">
                  {r.status !== "Completed" && (
                    <button className={`text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1 ${
                      r.status === "In Progress" ? "bg-[#0F510F] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}>
                      <Video className="w-3 h-3" /> Join
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Screen 4: Customer Journey ──────────────────────────────── */
function ScreenJourney() {
  const customers = [
    { name: "Ahmed Al-Rashid", phone: "****4821", touchpoints: 6 },
    { name: "Sara Mohammed", phone: "****7734", touchpoints: 4 },
    { name: "Khalid Omar", phone: "****9102", touchpoints: 5 },
    { name: "Fatima Hassan", phone: "****3356", touchpoints: 2 },
  ];
  const [sel, setSel] = useState(0);

  const journeys = [
    [
      { label: "First contact via WhatsApp", time: "Mar 28, 10:02 AM", color: "bg-blue-500", icon: <MessageCircle className="w-3 h-3 text-white" /> },
      { label: "AI bot handled initial inquiry", time: "Mar 28, 10:02 AM", color: "bg-gray-400", icon: <Bot className="w-3 h-3 text-white" /> },
      { label: "Follow-up conversation", time: "Mar 30, 02:15 PM", color: "bg-gray-400", icon: <Bot className="w-3 h-3 text-white" /> },
      { label: "Escalated to Agent Nora", time: "Mar 30, 02:20 PM", color: "bg-orange-500", icon: <AlertCircle className="w-3 h-3 text-white" /> },
      { label: "Meeting booked — Apr 6, 10 AM", time: "Mar 30, 02:25 PM", color: "bg-teal-500", icon: <Calendar className="w-3 h-3 text-white" /> },
      { label: "Survey submitted — 5/5 stars", time: "Apr 6, 11:00 AM", color: "bg-green-500", icon: <Star className="w-3 h-3 text-white" /> },
    ],
    [
      { label: "First contact via WhatsApp", time: "Apr 1, 10:14 AM", color: "bg-blue-500", icon: <MessageCircle className="w-3 h-3 text-white" /> },
      { label: "AI bot handled pricing question", time: "Apr 1, 10:14 AM", color: "bg-gray-400", icon: <Bot className="w-3 h-3 text-white" /> },
      { label: "Voice note transcribed", time: "Apr 1, 10:15 AM", color: "bg-purple-500", icon: <Mic className="w-3 h-3 text-white" /> },
      { label: "Sent pricing details", time: "Apr 1, 10:15 AM", color: "bg-gray-400", icon: <Bot className="w-3 h-3 text-white" /> },
    ],
    [
      { label: "First contact via WhatsApp", time: "Mar 25, 09:30 AM", color: "bg-blue-500", icon: <MessageCircle className="w-3 h-3 text-white" /> },
      { label: "AI bot handled inquiry", time: "Mar 25, 09:30 AM", color: "bg-gray-400", icon: <Bot className="w-3 h-3 text-white" /> },
      { label: "Rescheduled appointment", time: "Apr 2, 11:00 AM", color: "bg-orange-500", icon: <AlertCircle className="w-3 h-3 text-white" /> },
      { label: "Meeting booked — Apr 8, 09 AM", time: "Apr 2, 11:05 AM", color: "bg-teal-500", icon: <Calendar className="w-3 h-3 text-white" /> },
      { label: "Awaiting meeting", time: "", color: "bg-gray-300", icon: <Clock className="w-3 h-3 text-white" /> },
    ],
    [
      { label: "First contact via WhatsApp", time: "Apr 3, 03:00 PM", color: "bg-blue-500", icon: <MessageCircle className="w-3 h-3 text-white" /> },
      { label: "AI bot greeting sent", time: "Apr 3, 03:00 PM", color: "bg-gray-400", icon: <Bot className="w-3 h-3 text-white" /> },
    ],
  ];

  return (
    <div className="flex h-full">
      <div className="w-[240px] border-e border-gray-200 bg-white flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/80">
          <div className="text-sm font-semibold text-gray-800">Customers</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {customers.map((c, i) => (
            <button
              key={i}
              onClick={() => setSel(i)}
              className={`w-full text-start px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                i === sel ? "bg-[#0F510F]/5 border-s-2 border-s-[#0F510F]" : ""
              }`}
            >
              <div className="text-sm font-medium text-gray-900">{c.name}</div>
              <div className="text-[10px] text-gray-400">{c.phone} · {c.touchpoints} touchpoints</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 bg-gray-50 overflow-y-auto p-6">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-gray-900">{customers[sel].name}</h3>
          <p className="text-xs text-gray-500">Customer journey — {customers[sel].touchpoints} touchpoints</p>
        </div>
        <div className="relative ms-4">
          <div className="absolute start-[11px] top-3 bottom-3 w-0.5 bg-gray-200" />
          <div className="space-y-5">
            {(journeys[sel] ?? []).map((j, i) => (
              <div key={i} className="flex items-start gap-4 relative">
                <div className={`w-6 h-6 rounded-full ${j.color} flex items-center justify-center z-10 shrink-0 shadow-sm`}>
                  {j.icon}
                </div>
                <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5 shadow-sm flex-1">
                  <div className="text-sm font-medium text-gray-800">{j.label}</div>
                  {j.time && <div className="text-[10px] text-gray-400 mt-0.5">{j.time}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Screen 5: Statistics ────────────────────────────────────── */
function ScreenStats({ portrait = false }: { portrait?: boolean }) {
  const metrics = [
    { label: "Total Conversations", value: "1,247", change: "+12%", up: true },
    { label: "Resolved", value: "1,089", change: "+8%", up: true },
    { label: "Avg Response Time", value: "2.4s", change: "-18%", up: true },
    { label: "Meetings Booked", value: "84", change: "+23%", up: true },
  ];
  const days = [
    { label: "Mon", val: 65 },
    { label: "Tue", val: 82 },
    { label: "Wed", val: 71 },
    { label: "Thu", val: 93 },
    { label: "Fri", val: 45 },
    { label: "Sat", val: 58 },
    { label: "Sun", val: 76 },
  ];
  const maxVal = Math.max(...days.map(d => d.val));
  const agents = [
    { name: "Nora Alshahrani", convos: 142, resolved: 138, time: "1.8s" },
    { name: "Fahad Al-Qahtani", convos: 118, resolved: 110, time: "2.1s" },
    { name: "Maha Sultan", convos: 96, resolved: 91, time: "2.6s" },
  ];

  return (
    <div className="h-full bg-gray-50 overflow-y-auto p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Statistics</h2>
        <p className="text-sm text-gray-500">Last 30 days performance overview</p>
      </div>
      {/* Metric cards */}
      <div className={`grid gap-4 mb-6 ${portrait ? "grid-cols-2" : "grid-cols-4"}`}>
        {metrics.map((m, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500 mb-1">{m.label}</div>
            <div className="text-2xl font-bold text-gray-900">{m.value}</div>
            <div className={`text-xs font-medium mt-1 ${m.up ? "text-green-600" : "text-red-600"}`}>{m.change} this month</div>
          </div>
        ))}
      </div>
      {/* Bar chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="text-sm font-semibold text-gray-800 mb-4">Conversations per day (this week)</div>
        <div className="flex items-end gap-3 h-36">
          {days.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-gray-500 font-medium">{d.val}</span>
              <div className="w-full rounded-t-md bg-[#0F510F]/80 transition-all" style={{ height: `${(d.val / maxVal) * 100}%` }} />
              <span className="text-[10px] text-gray-400">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Agent table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-sm font-semibold text-gray-800">Agent Performance</div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500">Agent</th>
              <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500">Conversations</th>
              <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500">Resolved</th>
              <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500">Avg Time</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-800">{a.name}</td>
                <td className="px-4 py-2.5 text-gray-600">{a.convos}</td>
                <td className="px-4 py-2.5 text-gray-600">{a.resolved}</td>
                <td className="px-4 py-2.5 text-gray-600">{a.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Screen 6: Chatbot Config ────────────────────────────────── */
function ScreenChatbot() {
  return (
    <div className="h-full bg-gray-50 overflow-y-auto p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Chatbot Configuration</h2>
        <p className="text-sm text-gray-500">Customize your AI assistant's behavior and responses</p>
      </div>
      <div className="flex gap-6">
        {/* Config form */}
        <div className="flex-1 space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1.5">Business Name</label>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800">WAK Solutions</div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1.5">Greeting Message</label>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 leading-relaxed">
                Hello! Welcome to WAK Solutions. I'm your AI assistant. How can I help you today?
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1.5">Tone</label>
              <div className="flex gap-2">
                {["Casual", "Professional", "Formal"].map((t, i) => (
                  <div key={t} className={`text-xs px-3 py-1.5 rounded-lg border cursor-pointer ${
                    i === 1 ? "bg-[#0F510F] text-white border-[#0F510F]" : "bg-white text-gray-600 border-gray-200"
                  }`}>{t}</div>
                ))}
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-sm font-semibold text-gray-800 mb-3">FAQ Pairs</div>
            <div className="space-y-3">
              {[
                { q: "What are your working hours?", a: "We're available Sun–Thu, 8 AM to 5 PM (Saudi time)." },
                { q: "How do I book an appointment?", a: "Just say 'I want to book a meeting' and I'll send you a booking link." },
                { q: "Do you offer home service?", a: "Yes! We offer home visits in Riyadh and Jeddah." },
              ].map((f, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div className="text-xs font-medium text-gray-700 mb-1">Q: {f.q}</div>
                  <div className="text-xs text-gray-500">A: {f.a}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-sm font-semibold text-gray-800 mb-3">Escalation Rules</div>
            <div className="space-y-2 text-xs text-gray-600">
              <div className="flex items-center gap-2"><StatusDot color="bg-orange-400" /> Escalate if customer asks for a human agent</div>
              <div className="flex items-center gap-2"><StatusDot color="bg-orange-400" /> Escalate if sentiment is negative for 3+ messages</div>
              <div className="flex items-center gap-2"><StatusDot color="bg-orange-400" /> Escalate if bot confidence is below 60%</div>
            </div>
          </div>
          <button className="bg-[#0F510F] text-white text-sm font-medium px-6 py-2.5 rounded-lg">Save configuration</button>
        </div>
        {/* Preview */}
        <div className="w-[220px] shrink-0">
          <div className="text-xs font-medium text-gray-500 mb-2">WhatsApp Preview</div>
          <div className="bg-[#ECE5DD] rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
            <div className="bg-[#075E54] text-white px-3 py-2 flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#128C7E] flex items-center justify-center text-[10px] font-bold">W</div>
              <div className="text-xs font-medium">WAK Solutions</div>
            </div>
            <div className="px-2 py-3 space-y-1.5">
              <div className="bg-white rounded-lg px-2.5 py-1.5 shadow-sm max-w-[90%]">
                <div className="text-[10px] text-[#408440] font-semibold mb-0.5">AI Assistant</div>
                <p className="text-[10px] text-gray-700 leading-relaxed">Hello! Welcome to WAK Solutions. I'm your AI assistant. How can I help you today?</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Screen 7: Contacts ──────────────────────────────────────── */
function ScreenContacts() {
  const contacts = [
    { name: "Ahmed Al-Rashid", phone: "+966 512 345 4821", source: "WhatsApp", date: "Mar 28, 2026" },
    { name: "Sara Mohammed", phone: "+966 501 234 7734", source: "WhatsApp", date: "Apr 1, 2026" },
    { name: "Khalid Omar", phone: "+966 555 678 9102", source: "CSV Import", date: "Mar 20, 2026" },
    { name: "Fatima Hassan", phone: "+966 503 456 3356", source: "WhatsApp", date: "Apr 3, 2026" },
    { name: "Yousef Nasser", phone: "+966 544 789 6601", source: "Manual", date: "Mar 15, 2026" },
    { name: "Reem Al-Dosari", phone: "+966 509 123 5510", source: "CSV Import", date: "Mar 20, 2026" },
    { name: "Majed Turki", phone: "+966 531 456 8847", source: "WhatsApp", date: "Apr 4, 2026" },
  ];
  const srcColor: Record<string, string> = {
    WhatsApp: "bg-green-100 text-green-700",
    "CSV Import": "bg-purple-100 text-purple-700",
    Manual: "bg-gray-100 text-gray-700",
  };

  return (
    <div className="h-full bg-gray-50 overflow-y-auto p-6">
      {/* Import banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5 flex items-center gap-3">
        <FileText className="w-4 h-4 text-blue-500 shrink-0" />
        <div className="text-xs text-blue-700">
          <span className="font-medium">Last import:</span> 47 added, 3 skipped, 2 duplicates
          <span className="text-blue-400 ms-1">· Mar 20, 2026</span>
        </div>
      </div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Contacts</h2>
          <p className="text-sm text-gray-500">{contacts.length} contacts in database</p>
        </div>
        <div className="flex gap-2">
          <button className="bg-white border border-gray-200 text-gray-700 text-xs font-medium px-4 py-2 rounded-lg flex items-center gap-1.5 hover:bg-gray-50">
            <Upload className="w-3.5 h-3.5" /> Upload CSV
          </button>
          <button className="bg-[#0F510F] text-white text-xs font-medium px-4 py-2 rounded-lg flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add contact
          </button>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-start px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="text-start px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
              <th className="text-start px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
              <th className="text-start px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Date Added</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{c.phone}</td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${srcColor[c.source]}`}>{c.source}</span>
                </td>
                <td className="px-4 py-3 text-gray-500">{c.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  MAIN DEMO OVERLAY                                              */
/* ═══════════════════════════════════════════════════════════════ */
const SCREEN_COMPONENTS = [
  ScreenInbox, ScreenLiveChat, ScreenMeetings, ScreenJourney, ScreenStats, ScreenChatbot, ScreenContacts,
];

export default function ProductDemo({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState(0);
  const [fade, setFade] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      setCurrent(0);
      setFade(true);
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const maxIdx = isMobile ? 1 : SCREENS.length - 1;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goTo(Math.min(current + 1, maxIdx));
      if (e.key === "ArrowLeft") goTo(Math.max(current - 1, 0));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, current, isMobile]);

  const goTo = useCallback((idx: number) => {
    if (idx === current) return;
    setFade(false);
    setTimeout(() => {
      setCurrent(idx);
      setFade(true);
    }, 150);
  }, [current]);

  if (!open) return null;

  const mobileScreens = SCREENS.filter(s => s.mobile);
  const visibleScreens = isMobile ? mobileScreens : SCREENS;
  const visibleComponents = isMobile ? [ScreenInbox, ScreenStats] : SCREEN_COMPONENTS;
  const maxIdx = visibleScreens.length - 1;
  const screen = visibleScreens[current] ?? visibleScreens[0];
  const ScreenComponent = visibleComponents[current] ?? visibleComponents[0];

  const isPortrait = isMobile && !isLandscape;
  const isMobileLandscape = isMobile && isLandscape;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diffX = touchStartX.current - e.changedTouches[0].clientX;
    const diffY = touchStartY.current - e.changedTouches[0].clientY;
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
      if (diffX > 0) goTo(Math.min(current + 1, maxIdx));
      else goTo(Math.max(current - 1, 0));
    }
  };

  const navArrows = (
    <div className="flex items-center gap-1 shrink-0">
      <button
        onClick={() => goTo(Math.max(current - 1, 0))}
        disabled={current === 0}
        className="w-11 h-11 flex items-center justify-center rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <span className="text-xs text-gray-400 font-mono tabular-nums min-w-[36px] text-center">
        {current + 1} / {visibleScreens.length}
      </span>
      <button
        onClick={() => goTo(Math.min(current + 1, maxIdx))}
        disabled={current === maxIdx}
        className="w-11 h-11 flex items-center justify-center rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );

  /* ══════════════════════════════════════════════════════════
     PORTRAIT MOBILE — full-screen, no chrome bar, swipeable
     ══════════════════════════════════════════════════════════ */
  if (isPortrait) {
    return (
      <div className="fixed inset-0 z-[100]">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div
          className="relative w-full h-full flex flex-col bg-gray-100 animate-in fade-in duration-200"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Floating close button */}
          <button
            onClick={onClose}
            className="absolute top-3 end-3 z-20 w-11 h-11 flex items-center justify-center bg-black/30 backdrop-blur-sm rounded-full text-white"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Screen content */}
          <div className={`flex-1 min-h-0 transition-opacity duration-150 ${fade ? "opacity-100" : "opacity-0"}`}>
            <div className="h-full overflow-hidden">
              {current === 0 ? <ScreenInbox portrait /> : <ScreenStats portrait />}
            </div>
          </div>

          {/* Slimmed bottom bar */}
          <div className="bg-white border-t border-gray-200 px-3 py-1.5 flex items-center gap-2 shrink-0">
            {navArrows}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-800 truncate">{screen.title}</div>
              <div className="text-[10px] text-gray-400 flex items-center gap-1">
                <Monitor className="w-3 h-3" /> View full demo on desktop
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     LANDSCAPE MOBILE — compact chrome, no sidebar, swipeable
     ══════════════════════════════════════════════════════════ */
  if (isMobileLandscape) {
    return (
      <div className="fixed inset-0 z-[100]">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div
          className="relative w-full h-full flex flex-col bg-gray-100 animate-in fade-in duration-200"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Compact browser chrome */}
          <div className="bg-[#E8E6E3] px-3 py-1 flex items-center gap-3 shrink-0 border-b border-gray-300">
            <div className="flex gap-1.5">
              <button onClick={onClose} className="w-3 h-3 rounded-full bg-[#FF5F57] hover:brightness-90 transition-all" title="Close" />
              <div className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
              <div className="w-3 h-3 rounded-full bg-[#28C840]" />
            </div>
            <div className="flex-1 max-w-xs mx-auto bg-white/80 rounded px-3 py-0.5 text-[10px] text-gray-500 text-center font-mono">
              app.waksolutions.com/{screen.id}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Screen content — full width, no sidebar */}
          <div className={`flex-1 min-h-0 transition-opacity duration-150 ${fade ? "opacity-100" : "opacity-0"}`}>
            <div className="h-full overflow-hidden">
              <ScreenComponent />
            </div>
          </div>

          {/* Bottom bar */}
          <div className="bg-white border-t border-gray-200 px-3 py-1 flex items-center gap-2 shrink-0">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-800 truncate">{screen.title}</div>
            </div>
            {navArrows}
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     DESKTOP — original layout, fully unchanged
     ══════════════════════════════════════════════════════════ */
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-6xl h-[calc(100vh-24px)] sm:h-[calc(100vh-48px)] max-h-[800px] flex flex-col rounded-2xl overflow-hidden shadow-2xl bg-gray-100 animate-in fade-in zoom-in-95 duration-300">

        {/* ── Browser chrome ── */}
        <div className="bg-[#E8E6E3] px-4 py-2.5 flex items-center gap-3 shrink-0 border-b border-gray-300">
          <div className="flex gap-1.5">
            <button onClick={onClose} className="w-3 h-3 rounded-full bg-[#FF5F57] hover:brightness-90 transition-all" title="Close" />
            <div className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
            <div className="w-3 h-3 rounded-full bg-[#28C840]" />
          </div>
          <div className="flex-1 max-w-md mx-auto bg-white/80 rounded-md px-3 py-1 text-xs text-gray-500 text-center font-mono">
            app.waksolutions.com/{screen.id}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 min-h-0">

          {/* Sidebar nav */}
          <div className="hidden md:flex flex-col w-[200px] bg-[#0F510F] shrink-0">
            <div className="px-4 py-4 flex items-center gap-2 border-b border-white/10">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center text-white font-bold text-sm">W</div>
              <span className="text-white/90 font-semibold text-sm">WAK Solutions</span>
            </div>
            <nav className="flex-1 py-2 space-y-0.5 px-2 overflow-y-auto">
              {SCREENS.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => goTo(i)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    i === current
                      ? "bg-white/20 text-white"
                      : "text-white/60 hover:text-white/90 hover:bg-white/10"
                  }`}
                >
                  {s.icon}
                  {s.title}
                </button>
              ))}
            </nav>
          </div>

          {/* Screen content */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className={`flex-1 min-h-0 transition-opacity duration-150 ${fade ? "opacity-100" : "opacity-0"}`}>
              <div className="h-full overflow-hidden">
                <ScreenComponent />
              </div>
            </div>
          </div>
        </div>

        {/* ── Bottom bar ── */}
        <div className="bg-white border-t border-gray-200 px-4 py-2.5 flex items-center gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-800 truncate">{screen.title}</div>
            <div className="text-[11px] text-gray-500 truncate">{screen.desc}</div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => goTo(Math.max(current - 1, 0))}
              disabled={current === 0}
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <span className="text-xs text-gray-400 font-mono tabular-nums min-w-[36px] text-center">
              {current + 1} / {visibleScreens.length}
            </span>
            <button
              onClick={() => goTo(Math.min(current + 1, maxIdx))}
              disabled={current === maxIdx}
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Next <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <Link href="/register">
            <a className="bg-[#0F510F] text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#0d440d] transition-colors flex items-center gap-1.5 shrink-0">
              Start free trial <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </Link>
        </div>
      </div>
    </div>
  );
}
