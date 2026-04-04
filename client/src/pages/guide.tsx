import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, X, BookOpen, Globe } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";

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

const installStepsAr = [
  { img: "/guide/01.png", label: "افتح لوحة التحكم في Safari وانقر على زر المشاركة في الأسفل" },
  { img: "/guide/02.png", label: "مرّر للأسفل وانقر على إضافة إلى الشاشة الرئيسية" },
  { img: "/guide/03.png", label: "انقر على إضافة في الزاوية العلوية اليمنى للتأكيد" },
  { img: "/guide/04.png", label: "سيظهر تطبيق WAK Agent على شاشتك الرئيسية — انقر عليه لفتحه" },
  { img: "/guide/05.png", label: "سجّل الدخول بكلمة مرورك أو Face ID / بصمة الإصبع" },
  { img: "/guide/06.png", label: "بعد الدخول، انقر على تفعيل الإشعارات حتى تتلقى تنبيهات عند مراسلة العملاء" },
  { img: "/guide/07.png", label: "انقر على سماح عندما يطلب هاتفك الإذن — أنت الآن جاهز بالكامل" },
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
  return <ol className="list-decimal list-outside ms-5 space-y-1 mb-3 text-sm text-foreground/80">{children}</ol>;
}
function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc list-outside ms-5 space-y-1 mb-3 text-sm text-foreground/80">{children}</ul>;
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="leading-relaxed">{children}</li>;
}
function Tip({ children, label = "Tip" }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="my-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-900">
      <span className="font-semibold">{label}: </span>{children}
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
              <th key={h} className="text-start px-3 py-2 font-semibold text-foreground border-b border-border">{h}</th>
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

// ── Full guide content (English) ─────────────────────────────────────────────
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

// ── Full guide content (Arabic) ──────────────────────────────────────────────
function ArabicUserGuide() {
  return (
    <article dir="rtl" className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground mb-1">دليل المستخدم — لوحة تحكم وكلاء WAK</h1>
      <p className="text-sm text-muted-foreground mb-8">
        كل ما تحتاج معرفته للتعامل مع محادثات العملاء، الاجتماعات، وإدارة الفريق — لا حاجة لمعرفة تقنية.
      </p>

      {/* Table of contents */}
      <nav className="bg-muted/50 border border-border rounded-xl p-5 mb-10">
        <p className="text-sm font-semibold text-foreground mb-3">المحتويات</p>
        <ol className="list-decimal list-outside ms-5 space-y-1 text-sm">
          {[
            ["#dashboard", "لوحة التحكم (عرض المحادثة)"],
            ["#inbox", "صندوق الوارد"],
            ["#chat", "قراءة والرد على محادثة"],
            ["#meetings", "الاجتماعات"],
            ["#agents", "الوكلاء (للمدير فقط)"],
            ["#statistics", "الإحصائيات"],
            ["#surveys", "الاستطلاعات"],
            ["#chatbot-config", "إعدادات الشات بوت (للمدير فقط)"],
            ["#workflows", "سير العمل الشائع"],
            ["#mobile", "الاستخدام عبر الجوال"],
          ].map(([href, label]) => (
            <li key={href}>
              <a href={href} className="text-[#0F510F] hover:underline">{label}</a>
            </li>
          ))}
        </ol>
      </nav>

      {/* ── 1. Dashboard ── */}
      <H2 id="dashboard">لوحة التحكم (عرض المحادثة)</H2>
      <P>هذه هي الشاشة الرئيسية للعمل. على اليسار قائمة بالمحادثات النشطة؛ وعلى اليمين خيط المحادثة للشخص المحدد.</P>

      <H3>شريط الرأس</H3>
      <P>الشريط الأخضر في الأعلى ظاهر في كل صفحة:</P>
      <Ul>
        <Li><strong>شعار WAK Solutions</strong> — انقر للعودة إلى لوحة التحكم من أي صفحة.</Li>
        <Li><strong>حالة الاتصال</strong> — نقطة خضراء تومض تعني أنك متصل. نقطة صفراء تعني إعادة إنشاء الاتصال.</Li>
        <Li><strong>روابط التنقل</strong> — وصول سريع إلى صندوق الوارد، الوكلاء، الإحصائيات، الاجتماعات، إعدادات الشات بوت، الاستطلاعات، والدليل. على الجوال تتحول إلى قائمة ☰.</Li>
        <Li><strong>البيومتري</strong> — إعداد تسجيل الدخول ببصمة الوجه / الإصبع.</Li>
        <Li><strong>تسجيل الخروج</strong> — ينهي جلستك.</Li>
      </Ul>

      <H3>الشريط الجانبي للمحادثات (اللوحة اليسرى)</H3>
      <Ul>
        <Li>يعرض جميع محادثات العملاء المفتوحة.</Li>
        <Li>تُظهر كل بطاقة رقم هاتف العميل، معاينة قصيرة لآخر رسالة، ومنذ متى وصلت.</Li>
        <Li>انقر على أي بطاقة لفتح تلك المحادثة على اليمين.</Li>
        <Li>على الجوال، يملأ الشريط الجانبي الشاشة. انقر على محادثة لفتحها. انقر على سهم العودة للرجوع إلى القائمة.</Li>
      </Ul>
      <Tip label="تلميح">يتجدد الشريط الجانبي تلقائيًا كل بضع ثوانٍ. لا حاجة لإعادة تحميل الصفحة.</Tip>

      {/* ── 2. Inbox ── */}
      <H2 id="inbox">صندوق الوارد</H2>
      <P>صندوق الوارد هو عرض منظم لكل ما يحتاج إلى اهتمام: محادثات العملاء غير المعينة، المحادثات المعينة لك، والاجتماعات القادمة. فكّر فيه كقائمة مهامك اليومية.</P>

      <H3>التبويبات الثلاث</H3>
      <Table
        headers={["التبويب", "ما يعرضه"]}
        rows={[
          ["صندوق مشترك", "المحادثات والاجتماعات غير المعينة لأي وكيل. يمكن لأي شخص المطالبة بها."],
          ["محادثاتي", "المحادثات والاجتماعات المعينة لك تحديدًا."],
          ["الكل (للمدير فقط)", "جميع المحادثات المفتوحة والاجتماعات القادمة لجميع الوكلاء."],
        ]}
      />

      <H3>بطاقات المحادثة</H3>
      <P>تُظهر كل بطاقة: رقم هاتف العميل، شارة الحالة (مفتوح، قيد التنفيذ، محلول)، سبب التصعيد، منذ متى بدأت، وأي وكيل معين لها.</P>

      <H3>بطاقات الاجتماعات</H3>
      <P>بطاقات الاجتماعات لها حدود زرقاء وأيقونة 📅. تُظهر هاتف العميل، حالة الاجتماع، التاريخ/الوقت المحدد بتوقيت السعودية، والوكيل المعين. انقر على <strong>عرض</strong> لرؤية التفاصيل الكاملة ورابط الاجتماع.</P>

      <H3>المطالبة بمحادثة</H3>
      <Ol>
        <Li>في تبويب <strong>صندوق مشترك</strong>، انقر على <strong>استلام</strong> على المحادثة التي تريدها.</Li>
        <Li>تنتقل المحادثة إلى <strong>محادثاتي</strong>، معينة لك.</Li>
        <Li>انقر على <strong>فتح</strong> للذهاب مباشرة إلى تلك المحادثة.</Li>
      </Ol>

      <H3>الاجتماعات المرتبطة</H3>
      <P>إذا كان العميل لديه محادثة نشطة واجتماع محجوز، يظهر زر أزرق في أسفل بطاقة محادثته. انقر عليه لرؤية تفاصيل الاجتماع دون مغادرة صندوق الوارد.</P>

      <Tip label="تلميح">انقر على زر ↺ تحديث (أعلى اليمين) للتحديث يدويًا. يتجدد صندوق الوارد أيضًا تلقائيًا كل 15 ثانية.</Tip>

      {/* ── 3. Chat ── */}
      <H2 id="chat">قراءة والرد على محادثة</H2>
      <P>عرض المحادثة المباشر يُظهر رسائل العميل على اليسار وردود البوت/الوكيل على اليمين.</P>

      <H3>الرد كوكيل</H3>
      <Ol>
        <Li>انقر على مربع النص في أسفل المحادثة.</Li>
        <Li>اكتب رسالتك.</Li>
        <Li>اضغط <strong>Enter</strong> أو انقر <strong>إرسال</strong>.</Li>
      </Ol>
      <P>يذهب ردّك إلى العميل عبر واتساب فورًا، مع اسمك.</P>

      <H3>الاستلام من البوت</H3>
      <P>عندما تظهر محادثة في لوحة التحكم يكون البوت قد سلّمها بالفعل. فقط ابدأ الكتابة — رسائلك تذهب مباشرة إلى العميل.</P>

      <H3>إغلاق محادثة</H3>
      <Ol>
        <Li>تأكد أنه لا يوجد شيء معلق بقراءة المحادثة.</Li>
        <Li>انقر على <strong>إغلاق</strong> / <strong>حل</strong> في أعلى لوحة المحادثة.</Li>
        <Li>تتغير حالة المحادثة إلى محلول وتُزال من القائمة النشطة.</Li>
        <Li>قد يُرسل استطلاع رضا للعميل تلقائيًا.</Li>
      </Ol>

      <Tip label="تلميح">يمكنك التمرير لأعلى في المحادثة لقراءة تاريخها الكامل، بما في ذلك كل ما قاله البوت قبل أن تستلم.</Tip>

      {/* ── 4. Meetings ── */}
      <H2 id="meetings">الاجتماعات</H2>
      <P>تُظهر صفحة الاجتماعات جميع مكالمات الفيديو التي حجزها العملاء وتتيح لك إدارة الأوقات المتاحة.</P>

      <H3>فلاتر قائمة الاجتماعات</H3>
      <Table
        headers={["الزر", "ما يعرضه"]}
        rows={[
          ["الكل", "جميع الاجتماعات التي تم إنشاؤها"],
          ["القادمة", "الاجتماعات المعلقة أو قيد التنفيذ"],
          ["المكتملة", "الاجتماعات التي تم وضع علامة منجزة عليها"],
        ]}
      />

      <H3>أعمدة جدول الاجتماعات</H3>
      <Table
        headers={["العمود", "المعنى"]}
        rows={[
          ["العميل", "رقم واتساب للعميل"],
          ["رابط الاجتماع", "انقر لفتح غرفة الفيديو"],
          ["المحدد (AST)", "التاريخ والوقت المحجوز بتوقيت السعودية"],
          ["الوكيل", "الوكيل المسؤول عن هذا الاجتماع، أو «غير معين»"],
          ["الحالة", "معلق ← قيد التنفيذ ← مكتمل"],
        ]}
      />

      <H3>بدء اجتماع</H3>
      <Ol>
        <Li>ابحث عن صف الاجتماع (استخدم فلتر <strong>القادمة</strong>).</Li>
        <Li>انقر على <strong>بدء</strong>.</Li>
        <Li>تتغير الحالة إلى قيد التنفيذ ويُعيَّن الاجتماع لك.</Li>
        <Li>انقر على رابط الاجتماع لفتح غرفة الفيديو في تبويب جديد.</Li>
      </Ol>

      <H3>وضع علامة مكتمل على الاجتماع</H3>
      <Ol>
        <Li>ابحث عن الصف (الحالة: قيد التنفيذ) وانقر على <strong>وضع علامة مكتمل</strong>.</Li>
        <Li>أكّد الرسالة التأكيدية.</Li>
        <Li>تتغير الحالة إلى مكتمل ويُرسل استطلاع رضا للعميل.</Li>
      </Ol>

      <H3>إدارة التوافر</H3>
      <P>أسفل جدول الاجتماعات شبكة تقويم أسبوعية تُظهر الأوقات المتاحة، المحظورة، أو المحجوزة.</P>
      <Table
        headers={["اللون", "المعنى"]}
        rows={[
          ["أخضر (متاح)", "متاح للعملاء للحجز"],
          ["أحمر (محظور)", "محظور يدويًا — لا يمكن للعملاء الحجز"],
          ["أزرق (محجوز)", "حجز عميل هذا الوقت بالفعل"],
        ]}
      />
      <P>انقر على أي وقت <strong>متاح</strong> لحظره (يصبح أحمر). انقر على أي وقت <strong>محظور</strong> لإعادة فتحه. استخدم أسهم ← → للتنقل بين الأسابيع.</P>
      <Tip label="تلميح">احظر الأوقات خلال اجتماعات الفريق، أوقات الصلاة، أو العطلات. جميع الأوقات بتوقيت السعودية (UTC+3). ساعات العمل المتاحة 07:00–00:00 يوميًا، و17:00–00:00 يوم الجمعة.</Tip>

      {/* ── 5. Agents ── */}
      <H2 id="agents">الوكلاء (للمدير فقط)</H2>
      <P>يستخدم المديرون هذه الصفحة لإنشاء وإدارة حسابات الوكلاء ورؤية نظرة عامة على عبء العمل للفريق بأكمله.</P>

      <H3>أعمدة جدول الوكلاء</H3>
      <Table
        headers={["العمود", "المعنى"]}
        rows={[
          ["الوكيل", "الاسم وعنوان البريد الإلكتروني"],
          ["الدور / الحالة", "مدير أو وكيل · نشط أو غير نشط"],
          ["المحادثات المحلولة", "المحادثات المغلقة في الفترة الزمنية المحددة"],
          ["الاجتماعات", "إجمالي الاجتماعات المكتملة (طوال الوقت)"],
          ["التقييم", "متوسط درجة الاستطلاع من 5 (أخضر ≥ 4، كهرماني 2–3.9، أحمر < 2)"],
          ["آخر تسجيل دخول", "آخر مرة سجّل فيها الوكيل دخوله"],
          ["الإجراءات", "تعديل · إعادة تعيين كلمة المرور · إلغاء التفعيل / التفعيل"],
        ]}
      />

      <H3>فلتر الفترة</H3>
      <P>أزرار <strong>اليوم / هذا الأسبوع / هذا الشهر / كل الوقت</strong> فوق الجدول تُحدّث عدد المحادثات المحلولة لكل وكيل. الاجتماعات المكتملة والتقييمات تُظهر دائمًا الأرقام الكلية.</P>

      <H3>إنشاء وكيل جديد</H3>
      <Ol>
        <Li>انقر على <strong>وكيل جديد</strong> (أعلى اليمين).</Li>
        <Li>أدخل الاسم الكامل، البريد الإلكتروني، كلمة المرور، والدور.</Li>
        <Li>انقر على <strong>إنشاء وكيل</strong>.</Li>
        <Li>يعرض مربع أخضر كلمة المرور الجديدة — انسخها وشاركها بأمان. تُعرض مرة واحدة فقط.</Li>
      </Ol>

      <H3>التعديل / إعادة تعيين كلمة المرور / إلغاء التفعيل</H3>
      <Ul>
        <Li><strong>تعديل (✏):</strong> غيّر الاسم أو البريد الإلكتروني أو الدور ثم انقر حفظ التغييرات.</Li>
        <Li><strong>إعادة تعيين (🔑):</strong> أدخل كلمة مرور جديدة (6 أحرف على الأقل) وانقر تعيين كلمة مرور جديدة.</Li>
        <Li><strong>إلغاء التفعيل (شخص ✗):</strong> يُسجّل خروج الوكيل فورًا. لا يمكنك إلغاء تفعيل نفسك أو آخر مدير نشط.</Li>
        <Li><strong>تفعيل (شخص ✓):</strong> يُستعيد الوصول لوكيل غير نشط.</Li>
      </Ul>

      <H3>نظرة عامة على عبء العمل</H3>
      <P>أسفل جدول الوكلاء، جدول ثانٍ يُظهر إحصائيات في الوقت الفعلي لكل وكيل: المحادثات النشطة، المحلول اليوم، المحلول هذا الأسبوع، إجمالي المحلول، والاجتماعات المنجزة. استخدمه لمعرفة من يتحمل عبئًا زائدًا.</P>

      {/* ── 6. Statistics ── */}
      <H2 id="statistics">الإحصائيات</H2>
      <P>نظرة شاملة على عدد العملاء الذين تحدّث معهم الفريق عبر الزمن، مع مخطط يومي وملخص مولّد بالذكاء الاصطناعي.</P>

      <H3>أزرار الفترة الزمنية</H3>
      <Table
        headers={["الزر", "ما يغطيه"]}
        rows={[
          ["اليوم", "منذ منتصف الليل"],
          ["هذا الأسبوع", "منذ الاثنين"],
          ["هذا الشهر", "منذ الأول"],
          ["مخصص", "أي تاريخ بداية ونهاية تختاره"],
        ]}
      />

      <H3>ملخص محادثات الذكاء الاصطناعي</H3>
      <Ol>
        <Li>انقر على <strong>إنشاء ملخص</strong>.</Li>
        <Li>انتظر بضع ثوانٍ بينما يقرأ الذكاء الاصطناعي محادثات الفترة المحددة.</Li>
        <Li>تظهر فقرة نثرية تلخّص المواضيع الشائعة والأنماط الملحوظة.</Li>
        <Li>انقر على <strong>إعادة الإنشاء</strong> للحصول على تلخيص جديد، أو غيّر النطاق الزمني وأنشئ مرة أخرى.</Li>
      </Ol>
      <Tip label="تلميح">استخدم هذا بعد أسبوع مشغول لكتابة تحديث سريع للفريق أو اكتشاف المشكلات المتكررة التي يمكن معالجتها استباقيًا.</Tip>

      <H3>نظرة عامة على الاستطلاعات</H3>
      <P>لوحة مدمجة تُظهر أداء الاستطلاع النشط: أُرسل هذا الأسبوع، المقدَّم، ومتوسط التقييم. انقر على <strong>عرض النتائج الكاملة ←</strong> للانتقال إلى صفحة الاستطلاعات.</P>

      {/* ── 7. Surveys ── */}
      <H2 id="surveys">الاستطلاعات</H2>
      <P>تُرسل الاستطلاعات للعملاء تلقائيًا بعد إغلاق محادثة أو اجتماع. تتيح لك هذه الصفحة إنشاء الاستطلاعات، إدارة أيها نشط، وعرض النتائج.</P>

      <H3>أعمدة قائمة الاستطلاعات</H3>
      <Table
        headers={["العمود", "المعنى"]}
        rows={[
          ["العنوان", "اسم الاستطلاع"],
          ["الأسئلة", "عدد الأسئلة"],
          ["المُرسل", "كم مرة أُرسل"],
          ["المقدَّم", "كم عميل ملأه"],
          ["المعدل", "معدل التقديم (المقدَّم ÷ المُرسل)"],
          ["الحالة", "نشط (نقطة خضراء) أو غير نشط"],
        ]}
      />

      <H3>إنشاء استطلاع جديد</H3>
      <Ol>
        <Li>انقر على <strong>استطلاع جديد</strong> وأدخل عنوانًا.</Li>
        <Li>انقر على <strong>إضافة سؤال</strong> واختر نوع السؤال: تقييم (1–5)، نعم/لا، أو نص حر.</Li>
        <Li>استخدم أسهم ↑ ↓ لإعادة الترتيب؛ 🗑 لحذف سؤال.</Li>
        <Li>انقر على <strong>حفظ الاستطلاع</strong>.</Li>
      </Ol>

      <H3>تفعيل استطلاع</H3>
      <P>يمكن أن يكون استطلاع واحد فقط نشطًا في كل وقت. انقر على أيقونة <strong>✓ صح</strong> على الاستطلاع الذي تريده — يُلغى تفعيل الاستطلاع النشط السابق تلقائيًا.</P>

      <H3>عرض النتائج</H3>
      <Ol>
        <Li>انقر على أيقونة <strong>📊 مخطط شريطي</strong> على أي استطلاع.</Li>
        <Li>اطلع على الإجماليات (المُرسل، المقدَّم، معدل الاستجابة) والتفاصيل لكل سؤال.</Li>
        <Li>يُظهر <strong>تحليل رضا الوكلاء</strong> متوسط التقييم لكل وكيل.</Li>
      </Ol>

      {/* ── 8. Chatbot Config ── */}
      <H2 id="chatbot-config">إعدادات الشات بوت (للمدير فقط)</H2>
      <P>تحكم في ما يقوله بوت الذكاء الاصطناعي وكيفية تصرفه في محادثات واتساب. تسري التغييرات خلال <strong>60 ثانية</strong> — لا حاجة لإعادة تشغيل.</P>

      <H3>هوية العمل</H3>
      <Table
        headers={["الحقل", "ما تُدخله"]}
        rows={[
          ["اسم العمل", "اسم الشركة الذي يُعرّف بها البوت"],
          ["الصناعة / الوصف", "سطر واحد يصف ما تفعله الشركة"],
          ["النبرة", "احترافية، ودية، رسمية، أو مخصصة"],
        ]}
      />
      <P>إذا اخترت نبرة <strong>مخصصة</strong>، يظهر مربع نص يمكنك من خلاله وصف النبرة بالضبط (مثل «دافئة، موجزة، وتعاطفية»).</P>

      <H3>تدفق المحادثة</H3>
      <Ul>
        <Li><strong>رسالة الترحيب:</strong> أول رسالة يُرسلها البوت لكل عميل جديد.</Li>
        <Li><strong>أسئلة التأهيل:</strong> قائمة مرتبة يسير البوت مع العملاء خلالها. انقر على <strong>إضافة سؤال</strong>، اختر النوع (نص حر، نعم/لا، أو اختيار متعدد)، واسحب ⠿ لإعادة الترتيب.</Li>
        <Li><strong>رسالة الإغلاق:</strong> ما يقوله البوت عند إنهاء المحادثة.</Li>
      </Ul>

      <H3>قاعدة المعرفة (الأسئلة الشائعة)</H3>
      <P>أزواج أسئلة وأجوبة يستخدمها البوت للإجابة على الأسئلة الشائعة. انقر على <strong>إضافة زوج سؤال/جواب</strong>، اكتب السؤال والجواب، واستخدم 🗑 لإزالة الأزواج.</P>

      <H3>قواعد التصعيد</H3>
      <P>شروط تُشغّل التحويل لوكيل بشري. انقر على <strong>إضافة قاعدة</strong> وصف الشرط (مثل «العميل يطلب استردادًا»).</P>

      <H3>الحفظ</H3>
      <P>انقر على <strong>حفظ وتطبيق</strong>. يلتقط البوت التغييرات خلال 60 ثانية. انقر على <strong>إعادة التعيين للافتراضي</strong> للعودة إلى إعدادات WAK Solutions الأصلية.</P>

      <H3>متقدم: الرسالة الخام</H3>
      <P>انقر على <strong>متقدم: الرسالة الخام</strong> في الأسفل لتوسيع اللوحة.</P>
      <Ul>
        <Li><strong>التجاوز الخام OFF (افتراضي):</strong> يُظهر معاينة للقراءة فقط لما يتلقاه البوت بالضبط. استخدمها للتحقق من صحة كل شيء.</Li>
        <Li><strong>التجاوز الخام ON:</strong> يظهر شريط تحذير («يتم تجاهل الحقول المنظمة») ويصبح مربع النص قابلًا للتعديل. ما تكتبه يُرسل مباشرة للذكاء الاصطناعي، متجاوزًا جميع الحقول المنظمة.</Li>
      </Ul>
      <Note><strong>تلميح للمديرين:</strong> اتركوا التجاوز الخام OFF واستخدموا الحقول المنظمة. التجاوز الخام للفرق التقنية التي تحتاج تحكمًا دقيقًا.</Note>

      {/* ── 9. Workflows ── */}
      <H2 id="workflows">سير العمل الشائع</H2>

      <H3>الاستلام من البوت</H3>
      <Ol>
        <Li>اذهب إلى <strong>صندوق الوارد ← صندوق مشترك</strong>.</Li>
        <Li>ابحث عن بطاقة المحادثة وانقر على <strong>استلام</strong>.</Li>
        <Li>انقر على <strong>فتح</strong>، اقرأ تاريخ المحادثة، وردّ.</Li>
        <Li>عند الحل، أغلق المحادثة.</Li>
      </Ol>

      <H3>الرد على تصعيد</H3>
      <Ol>
        <Li>ستتلقى إشعار دفع على جهازك.</Li>
        <Li>افتح لوحة التحكم واذهب إلى صندوق الوارد.</Li>
        <Li>استلم المحادثة (إذا لم تكن معينة)، اقرأ السياق، وردّ على العميل.</Li>
      </Ol>

      <H3>إغلاق حالة</H3>
      <Ol>
        <Li>تأكد أن المشكلة محلولة بالكامل بقراءة المحادثة.</Li>
        <Li>انقر على <strong>حل / إغلاق</strong> في عرض المحادثة.</Li>
        <Li>يُرسل استطلاع للعميل تلقائيًا.</Li>
      </Ol>

      <H3>بدء واستكمال اجتماع</H3>
      <Ol>
        <Li>اذهب إلى <strong>الاجتماعات ← فلتر القادمة</strong>.</Li>
        <Li>انقر على <strong>بدء</strong> عند الوقت المناسب. يُعيَّن الاجتماع لك.</Li>
        <Li>انقر على رابط الاجتماع لفتح غرفة الفيديو.</Li>
        <Li>بعد المكالمة، انقر على <strong>وضع علامة مكتمل</strong>. يتلقى العميل استطلاعًا تلقائيًا.</Li>
      </Ol>

      <H3>حظر الوقت في التقويم</H3>
      <Ol>
        <Li>اذهب إلى <strong>الاجتماعات ← إدارة التوافر</strong>.</Li>
        <Li>انتقل إلى الأسبوع الصحيح باستخدام أزرار الأسهم.</Li>
        <Li>انقر على كل وقت تريد حظره (يصبح أحمر). لن يتمكن العملاء من حجز تلك الأوقات.</Li>
      </Ol>

      <H3>التحقق من أداء الفريق</H3>
      <Ol>
        <Li>اذهب إلى <strong>الإحصائيات ← هذا الأسبوع / هذا الشهر</strong>.</Li>
        <Li>تحقق من عدد العملاء الذين تواصلوا والمخطط اليومي.</Li>
        <Li>انقر على <strong>إنشاء ملخص</strong> للحصول على نظرة عامة بالذكاء الاصطناعي.</Li>
        <Li>اذهب إلى <strong>الوكلاء</strong> لرؤية أعداد المحادثات المحلولة الفردية والتقييمات.</Li>
        <Li>اذهب إلى <strong>الاستطلاعات ← النتائج</strong> للحصول على درجات الرضا التفصيلية.</Li>
      </Ol>

      <H3>تحديث تعليمات الشات بوت</H3>
      <Ol>
        <Li>اذهب إلى <strong>إعدادات الشات بوت</strong>.</Li>
        <Li>حدّث رسالة الترحيب، الأسئلة، الأسئلة الشائعة، أو قواعد التصعيد.</Li>
        <Li>انقر على <strong>حفظ وتطبيق</strong>. يلتقط البوت التغييرات خلال 60 ثانية.</Li>
      </Ol>

      {/* ── 10. Mobile ── */}
      <H2 id="mobile">الاستخدام عبر الجوال</H2>
      <P>لوحة التحكم قابلة للاستخدام الكامل على متصفح الهاتف أو كتطبيق مثبت (PWA).</P>

      <H3>التنقل على الجوال</H3>
      <Ol>
        <Li>انقر على <strong>☰</strong> لفتح القائمة المنزلقة.</Li>
        <Li>انقر على أي اسم صفحة للانتقال إليها.</Li>
        <Li>انقر خارج القائمة أو انقر ✕ لإغلاقها.</Li>
      </Ol>

      <H3>عرض المحادثة على الجوال</H3>
      <Ul>
        <Li>يملأ الشريط الجانبي الشاشة بالكامل. انقر على محادثة لفتحها.</Li>
        <Li>انقر على سهم ← العودة للرجوع إلى قائمة المحادثات.</Li>
      </Ul>

      <H3>إشعارات الدفع</H3>
      <Ol>
        <Li>في أول زيارة، قد يظهر شريط يطلب تفعيل الإشعارات.</Li>
        <Li>انقر على <strong>تفعيل الإشعارات</strong> وقبل رسالة المتصفح.</Li>
      </Ol>
      <Note><strong>مستخدمو iOS:</strong> يجب إضافة لوحة التحكم إلى الشاشة الرئيسية أولًا. انقر على <strong>مشاركة ← إضافة إلى الشاشة الرئيسية</strong>، ثم افتحها من الشاشة الرئيسية. اطلع على تبويب <em>الإعداد</em> للحصول على دليل مرئي خطوة بخطوة.</Note>

      <H3>إعداد تسجيل الدخول البيومتري على الجوال</H3>
      <Ol>
        <Li>سجّل الدخول بكلمة مرورك.</Li>
        <Li>افتح قائمة ☰ ← انقر على <strong>إعداد البيومتري</strong>.</Li>
        <Li>اتبع تعليمات Face ID أو بصمة الإصبع على جهازك.</Li>
        <Li>في المرة القادمة، انقر على <strong>تسجيل الدخول ببصمة الوجه / الإصبع</strong> في شاشة تسجيل الدخول.</Li>
      </Ol>

      <p className="text-xs text-muted-foreground mt-12 pt-4 border-t border-border">
        بوابة وكلاء WAK Solutions — دليل داخلي
      </p>
    </article>
  );
}

// ── Install wizard ───────────────────────────────────────────────────────────
function InstallGuide({
  onLightbox,
  steps,
  title,
  subtitle,
}: {
  onLightbox: (src: string) => void;
  steps: { img: string; label: string }[];
  title: string;
  subtitle: string;
}) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-foreground mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground mb-8">{subtitle}</p>
      <ol className="space-y-10">
        {steps.map((step, i) => (
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
  const { lang, isRTL } = useLanguage();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("guide");

  const isAr = lang === "ar";

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

  const tabs = [
    { key: "guide" as Tab, Icon: BookOpen, label: isAr ? "دليل المستخدم" : "User Guide" },
    { key: "setup" as Tab, Icon: Globe,    label: isAr ? "تطبيق الويب التقدمي" : "Progressive Web App" },
  ];

  return (
    <div dir={isRTL ? "rtl" : "ltr"} className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="h-14 bg-[#0F510F] text-white flex items-center justify-between px-5 flex-shrink-0 z-20 shadow-md">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="WAK Solutions" className="h-[36px] shrink-0" />
          <div className="hidden sm:block">
            <span className="font-semibold text-sm text-white/90">WAK Solutions</span>
            <span className="text-white/40 mx-2">—</span>
            <span className="text-sm text-white/70">
              {isAr ? "المساعدة والدليل" : "Help & Guide"}
            </span>
          </div>
        </div>
        <Link href="/dashboard">
          <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {isAr ? "العودة إلى لوحة التحكم" : "Back to Dashboard"}
            </span>
            <span className="sm:hidden">{isAr ? "عودة" : "Back"}</span>
          </a>
        </Link>
      </header>

      {/* Tab bar */}
      <div className="border-b border-border bg-card flex-shrink-0">
        <div className="max-w-3xl mx-auto px-4 flex gap-0">
          {tabs.map(({ key, Icon, label }) => (
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
          isAr ? <ArabicUserGuide /> : <UserGuide />
        ) : (
          <InstallGuide
            onLightbox={setLightbox}
            steps={isAr ? installStepsAr : installSteps}
            title={isAr ? "كيفية تثبيت التطبيق وتفعيل الإشعارات" : "How to Install the App & Enable Notifications"}
            subtitle={isAr
              ? "اتبع هذه الخطوات لتثبيت وكيل WAK على هاتفك وتشغيل إشعارات الدفع."
              : "Follow these steps to install WAK Agent on your phone and turn on push notifications."
            }
          />
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
