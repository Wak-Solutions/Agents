import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, X, BookOpen, Smartphone } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

// ── iOS install wizard ──────────────────────────────────────────────────────
const installSteps = [
  { img: "/guide/01.png", label: "Open the dashboard in Safari and tap the Share button at the bottom" },
  { img: "/guide/02.png", label: "Scroll down and tap Add to Home Screen" },
  { img: "/guide/03.png", label: "Tap Add in the top right corner to confirm" },
  { img: "/guide/04.png", label: "The WAK Agent app will now appear on your home screen — tap it to open" },
  { img: "/guide/05.png", label: "Sign in using your password or Face ID / Fingerprint" },
  { img: "/guide/06.png", label: "Once inside, tap Enable Notifications so you get alerted when customers message you" },
  { img: "/guide/07.png", label: "Tap Allow when your phone asks for permission — you are now fully set up" },
];

// ── Tiny helpers for the guide prose ────────────────────────────────────────
function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-lg font-bold text-foreground mt-10 mb-3 pb-1 border-b border-border scroll-mt-20">
      {children}
    </h2>
  );
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-foreground mt-6 mb-2">{children}</h3>;
}
function H4({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-semibold text-foreground mt-4 mb-1">{children}</h4>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-foreground/80 leading-relaxed mb-3">{children}</p>;
}
function Ol({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal list-outside ml-5 space-y-1 mb-3 text-sm text-foreground/80">{children}</ol>;
}
function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc list-outside ml-5 space-y-1 mb-3 text-sm text-foreground/80">{children}</ul>;
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="leading-relaxed">{children}</li>;
}
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-900">
      <span className="font-semibold">Tip: </span>{children}
    </div>
  );
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-sm text-blue-900">
      {children}
    </div>
  );
}
function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
        <thead className="bg-muted">
          <tr>
            {headers.map(h => (
              <th key={h} className="text-left px-3 py-2 font-semibold text-foreground border-b border-border">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/40"}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-foreground/80 border-b border-border/50">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Full guide content ───────────────────────────────────────────────────────
function UserGuide() {
  return (
    <article className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground mb-1">WAK Agent Dashboard — User Guide</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Everything you need to know to handle customer conversations, meetings, and team management — no technical knowledge needed.
      </p>

      {/* Table of contents */}
      <nav className="bg-muted/50 border border-border rounded-xl p-5 mb-10">
        <p className="text-sm font-semibold text-foreground mb-3">Contents</p>
        <ol className="list-decimal list-outside ml-5 space-y-1 text-sm">
          {[
            ["#dashboard", "The Dashboard (Chat View)"],
            ["#inbox", "Inbox"],
            ["#chat", "Reading and Replying to a Chat"],
            ["#meetings", "Meetings"],
            ["#agents", "Agents (Admin Only)"],
            ["#statistics", "Statistics"],
            ["#surveys", "Surveys"],
            ["#chatbot-config", "Chatbot Config (Admin Only)"],
            ["#workflows", "Common Workflows"],
            ["#mobile", "Mobile Use"],
          ].map(([href, label]) => (
            <li key={href}>
              <a href={href} className="text-[#0F510F] hover:underline">{label}</a>
            </li>
          ))}
        </ol>
      </nav>

      {/* ── 1. Dashboard ── */}
      <H2 id="dashboard">The Dashboard (Chat View)</H2>
      <P>This is the main working screen. On the left is a list of active conversations; on the right is the chat thread for whoever you have selected.</P>

      <H3>The header bar</H3>
      <P>The green bar at the top is visible on every page:</P>
      <Ul>
        <Li><strong>WAK Solutions logo</strong> — click to go back to the dashboard from any page.</Li>
        <Li><strong>Connection status</strong> — a green pulsing dot means you are online. A yellow dot means the connection is being re-established.</Li>
        <Li><strong>Navigation links</strong> — quick access to Inbox, Agents, Statistics, Meetings, Chatbot Config, Surveys, and this Guide. On mobile these collapse into a hamburger menu (☰).</Li>
        <Li><strong>Biometric</strong> — set up Face ID / fingerprint login.</Li>
        <Li><strong>Logout</strong> — ends your session.</Li>
      </Ul>

      <H3>The conversation sidebar (left panel)</H3>
      <Ul>
        <Li>Lists all open customer chats.</Li>
        <Li>Each card shows the customer's phone number, a short preview of the last message, and how long ago it arrived.</Li>
        <Li>Click any card to open that conversation on the right.</Li>
        <Li>On mobile, the sidebar fills the screen. Tap a conversation to open it. Tap the back arrow to return to the list.</Li>
      </Ul>
      <Tip>The sidebar refreshes automatically every few seconds. You do not need to reload the page.</Tip>

      {/* ── 2. Inbox ── */}
      <H2 id="inbox">Inbox</H2>
      <P>The Inbox is a structured view of everything that needs attention: unassigned customer chats, chats assigned to you, and upcoming meetings. Think of it as your to-do list for the day.</P>

      <H3>The three tabs</H3>
      <Table
        headers={["Tab", "What it shows"]}
        rows={[
          ["Shared Inbox", "Chats and meetings not yet assigned to any agent. Anyone can claim these."],
          ["My Chats", "Chats and meetings assigned specifically to you."],
          ["All (admin only)", "Every open chat and upcoming meeting across all agents."],
        ]}
      />

      <H3>Chat cards</H3>
      <P>Each chat card shows: customer phone number, status badge (Open, In Progress, Resolved), escalation reason, how long ago it started, and which agent it is assigned to.</P>

      <H3>Meeting cards</H3>
      <P>Meeting cards have a blue border and a 📅 calendar icon. Each shows the customer phone, meeting status, scheduled date/time in KSA time, and assigned agent. Click <strong>View</strong> to see full details and the meeting link.</P>

      <H3>Claiming a chat</H3>
      <Ol>
        <Li>In the <strong>Shared Inbox</strong> tab, click <strong>Claim</strong> on the chat you want.</Li>
        <Li>The chat moves to <strong>My Chats</strong>, assigned to you.</Li>
        <Li>Click <strong>Open</strong> to go directly to that conversation.</Li>
      </Ol>

      <H3>Linked meetings</H3>
      <P>If a customer has both an active chat and a booked meeting, a blue pill appears at the bottom of their chat card. Click it to see meeting details without leaving the inbox.</P>

      <Tip>Click the ↺ refresh button (top-right) to manually reload. The inbox also refreshes automatically every 15 seconds.</Tip>

      {/* ── 3. Chat ── */}
      <H2 id="chat">Reading and Replying to a Chat</H2>
      <P>The live chat view shows the customer's messages on the left and the bot's / agent's replies on the right.</P>

      <H3>Replying as an agent</H3>
      <Ol>
        <Li>Click the text input at the bottom of the chat.</Li>
        <Li>Type your message.</Li>
        <Li>Press <strong>Enter</strong> or click <strong>Send</strong>.</Li>
      </Ol>
      <P>Your reply goes to the customer via WhatsApp immediately, labelled with your name.</P>

      <H3>Taking over from the bot</H3>
      <P>When a chat appears in the dashboard the bot has already handed off. Simply start typing — your messages go directly to the customer.</P>

      <H3>Closing a conversation</H3>
      <Ol>
        <Li>Confirm nothing is outstanding by reading the conversation.</Li>
        <Li>Click <strong>Close</strong> / <strong>Resolve</strong> at the top of the chat panel.</Li>
        <Li>The chat status changes to Resolved and is removed from the active list.</Li>
        <Li>A satisfaction survey may be sent to the customer automatically.</Li>
      </Ol>

      <Tip>You can scroll up in the chat to read the full conversation history, including everything the bot said before you took over.</Tip>

      {/* ── 4. Meetings ── */}
      <H2 id="meetings">Meetings</H2>
      <P>The Meetings page shows all video meetings that customers have booked and lets you manage available time slots.</P>

      <H3>Meeting list — filters</H3>
      <Table
        headers={["Button", "What it shows"]}
        rows={[
          ["All", "Every meeting ever created"],
          ["Upcoming", "Meetings that are Pending or In Progress"],
          ["Completed", "Meetings that have been marked as done"],
        ]}
      />

      <H3>Meeting table columns</H3>
      <Table
        headers={["Column", "Meaning"]}
        rows={[
          ["Customer", "The customer's WhatsApp number"],
          ["Meeting Link", "Click to open the video room"],
          ["Scheduled (AST)", "Booked date and time in KSA / Arabian Standard Time"],
          ["Agent", "Which agent is handling this meeting, or \"Unassigned\""],
          ["Status", "Pending → In Progress → Completed"],
        ]}
      />

      <H3>Starting a meeting</H3>
      <Ol>
        <Li>Find the meeting row (use the <strong>Upcoming</strong> filter).</Li>
        <Li>Click <strong>Start</strong>.</Li>
        <Li>The status changes to In Progress and the meeting is assigned to you.</Li>
        <Li>Click the meeting link to open the video room in a new tab.</Li>
      </Ol>

      <H3>Marking a meeting as complete</H3>
      <Ol>
        <Li>Find the row (status: In Progress) and click <strong>Mark Complete</strong>.</Li>
        <Li>Confirm the prompt.</Li>
        <Li>Status changes to Completed and a satisfaction survey is sent to the customer.</Li>
      </Ol>

      <H3>Manage Availability</H3>
      <P>Below the meetings table is a weekly calendar grid showing which slots are open, blocked, or booked.</P>
      <Table
        headers={["Colour", "Meaning"]}
        rows={[
          ["Green (Open)", "Available for customers to book"],
          ["Red (Blocked)", "Manually blocked — customers cannot book"],
          ["Blue (Booked)", "A customer has already booked this slot"],
        ]}
      />
      <P>Click any <strong>Open</strong> slot to block it (turns red). Click any <strong>Blocked</strong> slot to re-open it. Use the ← → arrows to navigate between weeks.</P>
      <Tip>Block slots during team meetings, prayer times, or holidays. All times are in KSA time (UTC+3). Available hours are 07:00–00:00 daily, and 17:00–00:00 on Fridays.</Tip>

      {/* ── 5. Agents ── */}
      <H2 id="agents">Agents (Admin Only)</H2>
      <P>Admins use this page to create and manage agent accounts and see a workload overview of the whole team.</P>

      <H3>Agent table columns</H3>
      <Table
        headers={["Column", "Meaning"]}
        rows={[
          ["Agent", "Name and email address"],
          ["Role / Status", "Admin or Agent · Active or Inactive"],
          ["Chats Resolved", "Chats closed in the selected time period"],
          ["Meetings", "Total meetings completed (all-time)"],
          ["Rating", "Average survey score out of 5 (green ≥ 4, amber 2–3.9, red < 2)"],
          ["Last Login", "When the agent last signed in"],
          ["Actions", "Edit · Reset password · Deactivate / Activate"],
        ]}
      />

      <H3>Period filter</H3>
      <P>The <strong>Today / This Week / This Month / All Time</strong> pills above the table update the Chats Resolved count for every agent. Meetings completed and ratings always show all-time figures.</P>

      <H3>Creating a new agent</H3>
      <Ol>
        <Li>Click <strong>New Agent</strong> (top right).</Li>
        <Li>Fill in Full Name, Email, Password, and Role.</Li>
        <Li>Click <strong>Create Agent</strong>.</Li>
        <Li>A green box shows the new password — copy and share it securely. It is only shown once.</Li>
      </Ol>

      <H3>Editing / resetting password / deactivating</H3>
      <Ul>
        <Li><strong>Edit (✏):</strong> Change name, email, or role then click Save Changes.</Li>
        <Li><strong>Reset (🔑):</strong> Enter a new password (min 6 characters) and click Set New Password.</Li>
        <Li><strong>Deactivate (person ✗):</strong> Immediately signs the agent out. You cannot deactivate yourself or the last active admin.</Li>
        <Li><strong>Activate (person ✓):</strong> Restores access for an inactive agent.</Li>
      </Ul>

      <H3>Workload Overview</H3>
      <P>Below the agent table, a second table shows real-time stats per agent: Active Chats, Resolved Today, Resolved This Week, Total Resolved, and Meetings Done. Use this to spot who is overloaded.</P>

      {/* ── 6. Statistics ── */}
      <H2 id="statistics">Statistics</H2>
      <P>A bird's-eye view of how many customers the team has spoken to over time, with a daily chart and an AI-generated summary.</P>

      <H3>Time period buttons</H3>
      <Table
        headers={["Button", "What it covers"]}
        rows={[
          ["Today", "Since midnight"],
          ["This Week", "Since Monday"],
          ["This Month", "Since the 1st"],
          ["Custom", "Any start and end date you choose"],
        ]}
      />

      <H3>AI Conversation Summary</H3>
      <Ol>
        <Li>Click <strong>Generate Summary</strong>.</Li>
        <Li>Wait a few seconds while the AI reads the conversations from the selected period.</Li>
        <Li>A plain-English paragraph appears summarising common themes and notable patterns.</Li>
        <Li>Click <strong>Regenerate</strong> to get a fresh take, or change the date range and generate again.</Li>
      </Ol>
      <Tip>Use this after a busy week to write a quick team update or spot recurring issues you can fix proactively.</Tip>

      <H3>Survey Overview</H3>
      <P>A compact panel shows the active survey's performance: Sent this week, Submitted, and Avg rating. Click <strong>View Full Results →</strong> to jump to the Surveys page.</P>

      {/* ── 7. Surveys ── */}
      <H2 id="surveys">Surveys</H2>
      <P>Surveys are sent to customers automatically after a chat or meeting is closed. This page lets you create surveys, manage which one is active, and view results.</P>

      <H3>Survey list columns</H3>
      <Table
        headers={["Column", "Meaning"]}
        rows={[
          ["Title", "The survey name"],
          ["Qs", "Number of questions"],
          ["Sent", "How many times it has been sent"],
          ["Submitted", "How many customers filled it in"],
          ["Rate", "Submission rate (Submitted ÷ Sent)"],
          ["Status", "Active (green dot) or Inactive"],
        ]}
      />

      <H3>Creating a new survey</H3>
      <Ol>
        <Li>Click <strong>New Survey</strong> and enter a Title.</Li>
        <Li>Click <strong>Add Question</strong> and choose the question type: Rating (1–5), Yes/No, or Free Text.</Li>
        <Li>Use ↑ ↓ arrows to reorder; 🗑 to delete a question.</Li>
        <Li>Click <strong>Save Survey</strong>.</Li>
      </Ol>

      <H3>Activating a survey</H3>
      <P>Only one survey can be active at a time. Click the <strong>✓ tick</strong> icon on the survey you want — the previous active survey is deactivated automatically.</P>

      <H3>Viewing results</H3>
      <Ol>
        <Li>Click the <strong>📊 bar chart</strong> icon on any survey.</Li>
        <Li>See totals (Sent, Submitted, Response Rate) and per-question breakdowns.</Li>
        <Li>The <strong>Agent Satisfaction Breakdown</strong> shows average rating per agent.</Li>
      </Ol>

      {/* ── 8. Chatbot Config ── */}
      <H2 id="chatbot-config">Chatbot Config (Admin Only)</H2>
      <P>Control what the AI bot says and how it behaves in WhatsApp conversations. Changes take effect within <strong>60 seconds</strong> — no restart needed.</P>

      <H3>Business Identity</H3>
      <Table
        headers={["Field", "What to enter"]}
        rows={[
          ["Business Name", "The company name the bot introduces itself as"],
          ["Industry / Description", "One line describing what the company does"],
          ["Tone", "Professional, Friendly, Formal, or Custom"],
        ]}
      />
      <P>If you select <strong>Custom</strong> tone, a text box appears where you can describe the exact tone (e.g. "warm, concise, and empathetic").</P>

      <H3>Conversation Flow</H3>
      <Ul>
        <Li><strong>Greeting Message:</strong> The very first message the bot sends to every new customer.</Li>
        <Li><strong>Qualification Questions:</strong> An ordered list the bot walks customers through. Click <strong>Add Question</strong>, choose type (Free text, Yes/No, or Multiple choice), and drag the ⠿ grip to reorder.</Li>
        <Li><strong>Closing Message:</strong> What the bot says when wrapping up.</Li>
      </Ul>

      <H3>Knowledge Base (FAQ)</H3>
      <P>Question-and-answer pairs the bot uses to answer common customer questions. Click <strong>Add Q&amp;A Pair</strong>, type the question and answer, and use 🗑 to remove pairs.</P>

      <H3>Escalation Rules</H3>
      <P>Conditions that trigger a handover to a human agent. Click <strong>Add Rule</strong> and describe the condition (e.g. "Customer asks for a refund").</P>

      <H3>Saving</H3>
      <P>Click <strong>Save &amp; Apply</strong>. The bot picks up changes within 60 seconds. Click <strong>Reset to Default</strong> to revert to the original WAK Solutions defaults.</P>

      <H3>Advanced: Raw Prompt</H3>
      <P>Click <strong>Advanced: Raw Prompt</strong> at the bottom to expand a collapsible panel.</P>
      <Ul>
        <Li><strong>Raw Override OFF (default):</strong> Shows a read-only preview of exactly what the bot receives. Use this to verify everything looks correct.</Li>
        <Li><strong>Raw Override ON:</strong> A warning banner appears ("Structured fields are being ignored") and the text area becomes editable. What you type is sent directly to the AI, bypassing all structured fields.</Li>
      </Ul>
      <Note><strong>Tip for managers:</strong> Leave Raw Override OFF and use the structured fields. Raw override is for technical teams who need precise control.</Note>

      {/* ── 9. Workflows ── */}
      <H2 id="workflows">Common Workflows</H2>

      <H3>Taking over a chat from the bot</H3>
      <Ol>
        <Li>Go to <strong>Inbox → Shared Inbox</strong>.</Li>
        <Li>Find the chat card and click <strong>Claim</strong>.</Li>
        <Li>Click <strong>Open</strong>, read the conversation history, and reply.</Li>
        <Li>When resolved, close the chat.</Li>
      </Ol>

      <H3>Responding to an escalation</H3>
      <Ol>
        <Li>You will receive a push notification on your device.</Li>
        <Li>Open the dashboard and go to the Inbox.</Li>
        <Li>Claim the chat (if unassigned), read context, and reply to the customer.</Li>
      </Ol>

      <H3>Closing a case</H3>
      <Ol>
        <Li>Confirm the issue is fully resolved by reading the chat.</Li>
        <Li>Click <strong>Resolve / Close</strong> in the chat view.</Li>
        <Li>A survey is automatically sent to the customer.</Li>
      </Ol>

      <H3>Starting and completing a meeting</H3>
      <Ol>
        <Li>Go to <strong>Meetings → Upcoming</strong> filter.</Li>
        <Li>Click <strong>Start</strong> when it's time. This assigns the meeting to you.</Li>
        <Li>Click the meeting link to open the video room.</Li>
        <Li>After the call, click <strong>Mark Complete</strong>. The customer receives a survey automatically.</Li>
      </Ol>

      <H3>Blocking time off in the calendar</H3>
      <Ol>
        <Li>Go to <strong>Meetings → Manage Availability</strong>.</Li>
        <Li>Navigate to the correct week with the arrow buttons.</Li>
        <Li>Click each slot to block (turns red). Customers cannot book those slots.</Li>
      </Ol>

      <H3>Checking how the team is doing</H3>
      <Ol>
        <Li>Go to <strong>Statistics → This Week / This Month</strong>.</Li>
        <Li>Check Customers Contacted and the daily chart.</Li>
        <Li>Click <strong>Generate Summary</strong> for an AI overview of what customers were asking about.</Li>
        <Li>Go to <strong>Agents</strong> to see individual resolved chat counts and ratings.</Li>
        <Li>Go to <strong>Surveys → Results</strong> for detailed satisfaction scores.</Li>
      </Ol>

      <H3>Updating chatbot instructions</H3>
      <Ol>
        <Li>Go to <strong>Chatbot Config</strong>.</Li>
        <Li>Update the Greeting Message, Questions, FAQ, or Escalation Rules.</Li>
        <Li>Click <strong>Save &amp; Apply</strong>. The bot picks up changes within 60 seconds.</Li>
      </Ol>

      {/* ── 10. Mobile ── */}
      <H2 id="mobile">Mobile Use</H2>
      <P>The dashboard is fully usable on a phone browser or as an installed app (PWA).</P>

      <H3>Navigation on mobile</H3>
      <Ol>
        <Li>Tap <strong>☰</strong> to open the slide-in menu.</Li>
        <Li>Tap any page name to navigate there.</Li>
        <Li>Tap outside the menu or tap ✕ to close it.</Li>
      </Ol>

      <H3>Chat view on mobile</H3>
      <Ul>
        <Li>The sidebar fills the whole screen. Tap a conversation to open it.</Li>
        <Li>Tap the ← back arrow to return to the conversation list.</Li>
      </Ul>

      <H3>Push notifications</H3>
      <Ol>
        <Li>The first time you visit, a banner may appear asking to enable notifications.</Li>
        <Li>Click <strong>Enable Notifications</strong> and accept the browser prompt.</Li>
      </Ol>
      <Note><strong>iOS users:</strong> You must add the dashboard to your Home Screen first. Tap <strong>Share → Add to Home Screen</strong>, then open it from your Home Screen. See the <em>Setup</em> tab for a step-by-step visual guide.</Note>

      <H3>Setting up biometric login on mobile</H3>
      <Ol>
        <Li>Sign in with your password.</Li>
        <Li>Open ☰ menu → tap <strong>Biometric Setup</strong>.</Li>
        <Li>Follow your device's Face ID or fingerprint prompt.</Li>
        <Li>Next time, tap <strong>Sign in with Face ID / Fingerprint</strong> on the login screen.</Li>
      </Ol>

      <p className="text-xs text-muted-foreground mt-12 pt-4 border-t border-border">
        WAK Solutions Agent Portal — Internal Guide
      </p>
    </article>
  );
}

// ── Install wizard ───────────────────────────────────────────────────────────
function InstallGuide({ onLightbox }: { onLightbox: (src: string) => void }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-foreground mb-2">
        How to Install the App &amp; Enable Notifications
      </h1>
      <p className="text-sm text-muted-foreground mb-8">
        Follow these steps to install WAK Agent on your phone and turn on push notifications.
      </p>
      <ol className="space-y-10">
        {installSteps.map((step, i) => (
          <li key={i} className="flex flex-col items-center gap-3">
            <div className="w-full flex items-start gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#0F510F] text-white text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <p className="text-sm text-foreground leading-snug pt-1">{step.label}</p>
            </div>
            <button
              onClick={() => onLightbox(step.img)}
              className="block rounded-2xl overflow-hidden border border-border shadow-sm hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-[#0F510F]"
              aria-label={`View step ${i + 1} fullscreen`}
            >
              <img
                src={step.img}
                alt={`Step ${i + 1}`}
                className="w-[220px] object-contain"
                loading="lazy"
              />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
type Tab = "guide" | "setup";

export default function Guide() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("guide");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
  }, [isLoading, isAuthenticated, setLocation]);

  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="h-14 bg-[#0F510F] text-white flex items-center justify-between px-5 flex-shrink-0 z-20 shadow-md">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="WAK Solutions" className="h-[36px] shrink-0" />
          <div className="hidden sm:block">
            <span className="font-semibold text-sm text-white/90">WAK Solutions</span>
            <span className="text-white/40 mx-2">—</span>
            <span className="text-sm text-white/70">Help &amp; Guide</span>
          </div>
        </div>
        <Link href="/">
          <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Back to Dashboard</span>
            <span className="sm:hidden">Back</span>
          </a>
        </Link>
      </header>

      {/* Tab bar */}
      <div className="border-b border-border bg-card flex-shrink-0">
        <div className="max-w-3xl mx-auto px-4 flex gap-0">
          {([
            ["guide", BookOpen, "User Guide"],
            ["setup", Smartphone, "iOS Setup"],
          ] as const).map(([key, Icon, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? "border-[#0F510F] text-[#0F510F]"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        {tab === "guide" ? (
          <UserGuide />
        ) : (
          <InstallGuide onLightbox={setLightbox} />
        )}
      </main>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightbox}
            alt="Step fullscreen"
            className="max-h-[90vh] max-w-full rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
