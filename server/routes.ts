import crypto from "crypto";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { api } from "@shared/routes";
import { z } from "zod";
import { notifyManagerNewBooking } from "./email";
import { ensureSurveyTables, registerSurveyRoutes, sendSurveyToCustomer } from "./surveys";
import webpush from "web-push";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

if (!process.env.DASHBOARD_PASSWORD) {
  throw new Error("Missing required environment variable: DASHBOARD_PASSWORD");
}

// Setup web-push
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL = process.env.VAPID_EMAIL || "mailto:test@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// In-memory store for push subscriptions
const pushSubscriptions = new Map<string, any>();

// WebAuthn state
const RP_NAME = "WAK Solutions Agent";
let webAuthnCredential: any = null;      // stored registered credential
let currentChallenge: string | undefined; // temp challenge during auth flow

// Derive RP_ID and RP_ORIGIN from the request host so it always matches
// the domain the browser is actually on (works locally and on Railway)
function getRpId(req: any): string {
  if (process.env.RP_ID) return process.env.RP_ID;
  return req.hostname; // e.g. wak-dashboard-production.up.railway.app
}
function getRpOrigin(req: any): string {
  if (process.env.RP_ORIGIN) return process.env.RP_ORIGIN;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.hostname}`;
}

// Auth check middleware
const requireAuth = (req: any, res: any, next: any) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};

// Webhook secret check middleware
const requireWebhookSecret = (req: any, res: any, next: any) => {
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ message: "Invalid webhook secret" });
  }
  next();
};

// Helper to send push to all agents
const notifyAgents = async (payload: any) => {
  const promises = Array.from(pushSubscriptions.values()).map(sub =>
    webpush.sendNotification(sub, JSON.stringify(payload)).catch(e => console.error("Push error", e))
  );
  await Promise.all(promises);
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Ensure index exists for fast token lookups on the booking page
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_meetings_meeting_token ON meetings(meeting_token)`
  );

  // Auth Routes
  app.post(api.auth.login.path, (req, res) => {
    const { password } = req.body;
    if (password === process.env.DASHBOARD_PASSWORD) {
      req.session.authenticated = true;
      req.session.save((err) => {
        if (err) {
          return res.status(500).json({ message: "Session save error" });
        }
        res.json({ success: true });
      });
    } else {
      res.status(401).json({ message: "Invalid password" });
    }
  });

  app.post(api.auth.logout.path, (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout error" });
      }
      res.json({ success: true });
    });
  });

  app.get(api.auth.me.path, (req, res) => {
    if (req.session.authenticated) {
      res.json({ authenticated: true });
    } else {
      res.status(401).json({ message: "Unauthorized" });
    }
  });

  // WebAuthn Routes
  // Step 1: generate options for registering a new biometric credential
  app.post('/api/auth/webauthn/register/options', requireAuth, async (req, res) => {
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: getRpId(req),
      userID: new TextEncoder().encode('wak-agent'),
      userName: 'agent',
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });
    currentChallenge = options.challenge;
    res.json(options);
  });

  // Step 2: verify and save the registered credential
  app.post('/api/auth/webauthn/register/verify', requireAuth, async (req, res) => {
    try {
      const { verified, registrationInfo } = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge: currentChallenge!,
        expectedOrigin: getRpOrigin(req),
        expectedRPID: getRpId(req),
      });
      if (verified && registrationInfo) {
        webAuthnCredential = registrationInfo.credential;
        currentChallenge = undefined;
        res.json({ verified: true });
      } else {
        res.status(400).json({ message: "Verification failed" });
      }
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Step 3: generate options for authenticating with biometrics
  app.post('/api/auth/webauthn/login/options', async (req, res) => {
    if (!webAuthnCredential) {
      return res.status(400).json({ message: "No biometric registered" });
    }
    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      allowCredentials: [{ id: webAuthnCredential.id }],
      userVerification: 'required',
    });
    currentChallenge = options.challenge;
    res.json(options);
  });

  // Step 4: verify the biometric assertion and log in
  app.post('/api/auth/webauthn/login/verify', async (req, res) => {
    try {
      const { verified } = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge: currentChallenge!,
        expectedOrigin: getRpOrigin(req),
        expectedRPID: getRpId(req),
        credential: webAuthnCredential,
      });
      if (verified) {
        req.session.authenticated = true;
        req.session.save((err) => {
          if (err) return res.status(500).json({ message: "Session error" });
          currentChallenge = undefined;
          res.json({ success: true });
        });
      } else {
        res.status(401).json({ message: "Biometric verification failed" });
      }
    } catch (e: any) {
      res.status(401).json({ message: e.message });
    }
  });

  // Check if biometric is registered
  app.get('/api/auth/webauthn/registered', (req, res) => {
    res.json({ registered: !!webAuthnCredential });
  });

  // Conversations Route (all chats from messages table, joined with escalation status)
  app.get(api.conversations.list.path, requireAuth, async (req, res) => {
    const conversations = await storage.getConversations();
    res.json(conversations);
  });

  // Escalation Routes
  app.get(api.escalations.list.path, requireAuth, async (req, res) => {
    const escalations = await storage.getOpenEscalations();
    res.json(escalations);
  });

  app.post(api.escalations.escalate.path, requireWebhookSecret, async (req, res) => {
    try {
      const data = api.escalations.escalate.input.parse(req.body);
      const escalation = await storage.createEscalation({
        customer_phone: data.customer_phone,
        escalation_reason: data.escalation_reason,
        status: 'open'
      });
      await notifyAgents({
        title: "New Escalation — WAK Solutions",
        body: `${data.customer_phone}: ${data.escalation_reason}`,
        url: `/?phone=${data.customer_phone}`
      });
      res.json(escalation);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post(api.escalations.close.path, requireAuth, async (req, res) => {
    try {
      const { customer_phone } = api.escalations.close.input.parse(req.body);
      await storage.closeEscalation(customer_phone);

      // Call n8n webhook
      if (process.env.N8N_CLOSE_WEBHOOK) {
        fetch(process.env.N8N_CLOSE_WEBHOOK, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': process.env.WEBHOOK_SECRET || ''
          },
          body: JSON.stringify({ customer_phone })
        }).catch(e => console.error("Error calling n8n close webhook", e));
      }

      // Send post-chat survey (fire-and-forget)
      sendSurveyToCustomer(customer_phone, null, null);

      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Messages Routes
  app.get(api.messages.list.path, requireAuth, async (req, res) => {
    const phone = req.params.phone;
    const messages = await storage.getMessages(phone);
    res.json(messages);
  });

  app.post(api.messages.send.path, requireAuth, async (req, res) => {
    try {
      const data = api.messages.send.input.parse(req.body);

      // Call the chatbot service which handles both WhatsApp delivery and DB storage
      if (process.env.N8N_SEND_WEBHOOK) {
        const response = await fetch(process.env.N8N_SEND_WEBHOOK, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': process.env.WEBHOOK_SECRET || ''
          },
          body: JSON.stringify({ customer_phone: data.customer_phone, message: data.message })
        });
        if (!response.ok) throw new Error("Failed to deliver message");
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post(api.messages.incoming.path, requireWebhookSecret, async (req, res) => {
    try {
      const data = api.messages.incoming.input.parse(req.body);

      await notifyAgents({
        title: "New Customer Message",
        body: `${data.customer_phone}: ${data.message_text.substring(0, 60)}`,
        url: `/?phone=${data.customer_phone}`
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Statistics Routes
  app.get('/api/statistics', requireAuth, async (req, res) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      if (!from || !to) {
        return res.status(400).json({ message: "Missing from/to query params" });
      }
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }
      const [totalCustomers, perDay] = await Promise.all([
        storage.getTotalUniqueCustomers(fromDate, toDate),
        storage.getStatsCustomersPerDay(fromDate, toDate),
      ]);
      res.json({ totalCustomers, perDay });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/statistics/summary', requireAuth, async (req, res) => {
    try {
      const { from, to } = z.object({ from: z.string(), to: z.string() }).parse(req.body);
      const fromDate = new Date(from);
      const toDate = new Date(to);

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ message: "OPENAI_API_KEY is not configured. Add it to wak-dash/.env and restart the server." });
      }

      const msgs = await storage.getInboundMessagesForSummary(fromDate, toDate);
      if (msgs.length === 0) {
        return res.json({ summary: "No customer messages found in the selected period." });
      }

      // Build a compact text block — keep each message on one line, truncate very long ones
      const msgBlock = msgs
        .map(m => `[${new Date(m.created_at!).toLocaleDateString()}] ${m.customer_phone}: ${m.message_text.slice(0, 200)}`)
        .join('\n');

      const prompt = [
        `You are reviewing customer support conversations for WAK Solutions.`,
        `Period: ${fromDate.toDateString()} to ${toDate.toDateString()}. Total inbound messages: ${msgs.length}.`,
        ``,
        `Summarise the following customer messages in 3–5 sentences covering:`,
        `1. The most common topics or questions`,
        `2. Any recurring complaints or issues`,
        `3. Overall customer sentiment`,
        ``,
        `Messages (most recent first):`,
        msgBlock,
      ].join('\n');

      const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 400,
          temperature: 0.4,
        }),
      });

      if (!openAiRes.ok) {
        const err = await openAiRes.text();
        console.error("OpenAI error:", err);
        return res.status(502).json({ message: "OpenAI request failed. Check server logs." });
      }

      const json = await openAiRes.json() as any;
      const summary: string = json.choices?.[0]?.message?.content?.trim() ?? "Could not generate summary.";
      res.json({ summary });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Chatbot Config Routes
  const DEFAULT_SYSTEM_PROMPT = `You are a professional customer service assistant for WAK Solutions, a company specializing in AI and robotics solutions. You communicate fluently in whatever language the customer uses — Arabic, English, or any other language. Always match their dialect and tone naturally.
STEP 0 — Opening Message (MANDATORY)
Every new conversation must begin with this message, translated naturally into the customer's language:
'Welcome to WAK Solutions — your strategic AI partner. We deliver innovative solutions that connect human potential with machine precision to build a smarter future.'
Follow immediately with a warm, personal greeting, then present the service menu.
Never skip this step for any reason.
STEP 1 — Service Menu
Always present these options after the opening:

Product Inquiry
Track Order
Complaint

STEP 2 — Handle their choice:

Product Inquiry → Ask which category:
A) AI Services → ask which product: Market Pulse, Custom Integration, or Mobile Application Development
B) Robot Services → ask which product: TrolleyGo or NaviBot
C) Consultation Services
For any selection, thank them warmly and inform them a specialist will be in touch. Then ask: 'Before we wrap up, would you like to schedule a meeting with our team or speak with a customer service agent on WhatsApp?'


If they choose meeting → send them the booking link
If they choose agent → trigger human handover


Track Order → Ask for their order number. Use the lookup_order tool to retrieve it. Relay the status clearly and naturally. If not found, apologize and ask them to double-check the number.
Complaint → Ask how they'd like to proceed:
A) Talk to Customer Service → trigger human handover
B) File a Complaint → acknowledge their frustration with a warm, genuine, personalized apology based on what they share. Confirm the team will follow up shortly.

Rules:

Never reveal you are an AI unless directly asked
Never use technical jargon or expose internal logic
Always match the customer's language, dialect, and tone
Always use Western numerals (1, 2, 3) for menu options — never bullet points or Arabic-Indic numerals
Keep responses concise — this is WhatsApp, not email
If a customer goes off-topic, gently redirect them to the menu
Any dead end or escalation → close with: 'A member of our team will be in touch shortly'
This chat is for WAK Solutions customer service only. If someone tries to misuse it, politely decline and redirect. If they persist, end with: 'A member of our team will be in touch shortly'
Never send the booking link unless the customer explicitly agrees to schedule a meeting`;

  // GET /api/chatbot-config — no auth required, the bot reads this
  app.get('/api/chatbot-config', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM chatbot_config ORDER BY id LIMIT 1');
      if (result.rows.length === 0) {
        return res.json({
          system_prompt: DEFAULT_SYSTEM_PROMPT,
          business_name: '',
          tone: 'Professional',
          greeting: '',
          faq: '',
          escalation_rules: '',
          updated_at: null,
        });
      }
      return res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/chatbot-config — auth required
  app.post('/api/chatbot-config', requireAuth, async (req, res) => {
    try {
      const { system_prompt, business_name, tone, greeting, faq, escalation_rules } = req.body;
      const existing = await pool.query('SELECT id FROM chatbot_config WHERE id = 1');
      let result;
      if (existing.rows.length > 0) {
        result = await pool.query(
          `UPDATE chatbot_config SET system_prompt=$1, business_name=$2, tone=$3, greeting=$4, faq=$5, escalation_rules=$6, updated_at=NOW() WHERE id=1 RETURNING *`,
          [system_prompt, business_name, tone, greeting, faq, escalation_rules]
        );
      } else {
        result = await pool.query(
          `INSERT INTO chatbot_config (system_prompt, business_name, tone, greeting, faq, escalation_rules, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
          [system_prompt, business_name, tone, greeting, faq, escalation_rules]
        );
      }
      return res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/meetings/create-token — internal, called by the Python agent
  // Creates a meeting row with a 24-hour booking token and returns it.
  app.post('/api/meetings/create-token', async (req, res) => {
    try {
      const secret = req.headers['x-webhook-secret'];
      if (secret !== process.env.WEBHOOK_SECRET) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      const { customer_phone } = req.body;
      if (!customer_phone) {
        return res.status(400).json({ message: 'customer_phone is required' });
      }
      const crypto = await import('crypto');
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO meetings (customer_phone, meeting_link, meeting_token, token_expires_at, status, created_at)
         VALUES ($1, '', $2, $3, 'pending', NOW())`,
        [customer_phone, token, expiresAt]
      );
      return res.json({ token });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Meetings Routes
  app.get('/api/meetings', requireAuth, async (req, res) => {
    try {
      const filter = (req.query.filter as string) || 'all';
      let where = '';
      if (filter === 'upcoming') where = "WHERE status = 'pending'";
      else if (filter === 'completed') where = "WHERE status = 'completed'";
      const result = await pool.query(
        `SELECT id, customer_phone, agent, meeting_link, agreed_time, scheduled_at, customer_email, status, created_at
         FROM meetings ${where} ORDER BY created_at DESC`
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch('/api/meetings/:id/complete', requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE meetings SET status = 'completed' WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Meeting not found' });
      const meeting = result.rows[0];

      // Send post-chat survey (fire-and-forget)
      sendSurveyToCustomer(meeting.customer_phone, null, null);

      res.json(meeting);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Availability Routes ────────────────────────────────────────────────────

  // GET /api/availability?weekStart=YYYY-MM-DD
  // Returns all blocked slots for the given week (7 days from weekStart).
  app.get('/api/availability', requireAuth, async (req, res) => {
    try {
      const weekStart = (req.query.weekStart as string) || new Date().toISOString().slice(0, 10);
      const result = await pool.query(
        `SELECT date::text, time FROM blocked_slots
         WHERE date >= $1::date AND date < $1::date + INTERVAL '7 days'
         ORDER BY date, time`,
        [weekStart]
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/availability/toggle — block or unblock a slot
  app.post('/api/availability/toggle', requireAuth, async (req, res) => {
    try {
      const { date, time } = z.object({ date: z.string(), time: z.string() }).parse(req.body);
      // Check if currently blocked
      const existing = await pool.query(
        'SELECT id FROM blocked_slots WHERE date=$1::date AND time=$2',
        [date, time]
      );
      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM blocked_slots WHERE date=$1::date AND time=$2', [date, time]);
        res.json({ blocked: false });
      } else {
        await pool.query(
          'INSERT INTO blocked_slots (date, time) VALUES ($1::date, $2) ON CONFLICT DO NOTHING',
          [date, time]
        );
        res.json({ blocked: true });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/availability/booked?weekStart=YYYY-MM-DD
  // Returns meetings that have been booked (scheduled_at set, not completed) within the week.
  // Returns rows as { date: "YYYY-MM-DD", time: "HH:00" } in KSA (UTC+3).
  app.get('/api/availability/booked', requireAuth, async (req, res) => {
    try {
      const weekStart = (req.query.weekStart as string) || new Date().toISOString().slice(0, 10);
      const KSA_MS = 3 * 60 * 60 * 1000;
      // weekStart is the UTC-date string of KSA local midnight on day 0 of the week
      // (e.g. "2026-03-22" = Mon 23 Mar 00:00 KSA = 22 Mar 21:00 UTC).
      // Derive the UTC boundaries: day 0 KSA midnight = Date.UTC(yr, mo-1, dy+1) - KSA_MS
      const [yr, mo, dy] = weekStart.split('-').map(Number);
      const weekStartUtc = new Date(Date.UTC(yr, mo - 1, dy + 1, 0, 0, 0) - KSA_MS);
      const weekEndUtc   = new Date(weekStartUtc.getTime() + 7 * 24 * 60 * 60 * 1000);
      const result = await pool.query(
        `SELECT scheduled_at FROM meetings
         WHERE scheduled_at >= $1 AND scheduled_at < $2
           AND scheduled_at IS NOT NULL
           AND status != 'completed'`,
        [weekStartUtc, weekEndUtc]
      );
      const rows = result.rows.map((r: { scheduled_at: Date }) => {
        const ksa = new Date(new Date(r.scheduled_at).getTime() + KSA_MS);
        // Return the UTC date of KSA local midnight — this matches the key convention
        // used by the frontend's toDateStr() (toISOString().slice(0,10) on a local-midnight Date).
        const ksaMidnightUtc = new Date(Date.UTC(ksa.getUTCFullYear(), ksa.getUTCMonth(), ksa.getUTCDate()) - KSA_MS);
        const date = ksaMidnightUtc.toISOString().slice(0, 10);
        const time = `${String(ksa.getUTCHours()).padStart(2, '0')}:00`;
        return { date, time };
      });
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public Booking Routes (no auth) ───────────────────────────────────────

  const KSA_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3
  const SLOT_HOURS = ["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"];

  // GET /api/book/:token — returns available slots for the next 30 days
  app.get('/api/book/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const mtg = await pool.query(
        `SELECT id, customer_phone, scheduled_at, status, token_expires_at
         FROM meetings WHERE meeting_token=$1 LIMIT 1`,
        [token]
      );
      if (mtg.rows.length === 0) return res.status(404).json({ message: 'Invalid booking link.' });
      const meeting = mtg.rows[0];
      if (new Date(meeting.token_expires_at) < new Date()) {
        return res.status(410).json({ message: 'This booking link has expired.' });
      }
      if (meeting.scheduled_at) {
        // Already booked — return the booked time
        const ksaTime = new Date(new Date(meeting.scheduled_at).getTime() + KSA_OFFSET_MS);
        return res.json({ alreadyBooked: true, scheduled_at: meeting.scheduled_at, ksa_label: formatKsaDateTime(ksaTime) });
      }

      // Compute available slots for next 30 days (in KSA dates)
      const now = new Date();
      const ksaNow = new Date(now.getTime() + KSA_OFFSET_MS);

      // Build the window boundaries (UTC) for the full 30-day range
      const windowStart = new Date(now);
      windowStart.setUTCHours(0, 0, 0, 0);
      const windowEnd = new Date(windowStart.getTime() + 31 * 24 * 3600 * 1000);

      // Fetch ALL blocked slots for the window in one query
      // blocked_slots stores dates as "UTC date of KSA midnight" (1 day behind KSA calendar)
      const ksaWindowStart = ksaNow.toISOString().slice(0, 10);
      const [ksaYr, ksaMo, ksaDy] = ksaWindowStart.split('-').map(Number);
      const blockedWindowStart = new Date(Date.UTC(ksaYr, ksaMo - 1, ksaDy) - KSA_OFFSET_MS).toISOString().slice(0, 10);
      const blockedRes = await pool.query(
        `SELECT date::text, time FROM blocked_slots
         WHERE date >= $1::date AND date < $1::date + INTERVAL '32 days'`,
        [blockedWindowStart]
      );
      const blockedSet = new Set(blockedRes.rows.map((r: any) => `${r.date}T${r.time}`));

      // Fetch ALL taken slots for the window in one query
      const takenRes = await pool.query(
        `SELECT scheduled_at FROM meetings
         WHERE scheduled_at >= $1 AND scheduled_at < $2
           AND status != 'completed' AND id != $3`,
        [windowStart, windowEnd, meeting.id]
      );
      const takenMs = new Set(takenRes.rows.map((r: any) => new Date(r.scheduled_at).getTime()));

      const days: { date: string; label: string; slots: string[] }[] = [];

      for (let i = 0; i <= 30; i++) {
        const d = new Date(ksaNow);
        d.setUTCDate(d.getUTCDate() + i);
        const ksaDate = d.toISOString().slice(0, 10);
        const [yr, mo, dy] = ksaDate.split('-').map(Number);
        // blocked_slots uses UTC-date-of-KSA-midnight as key
        const blockedDate = new Date(Date.UTC(yr, mo - 1, dy) - KSA_OFFSET_MS).toISOString().slice(0, 10);

        const availableSlots: string[] = [];
        for (const slot of SLOT_HOURS) {
          if (blockedSet.has(`${blockedDate}T${slot}`)) continue;
          const [h] = slot.split(':').map(Number);
          const slotUtc = new Date(Date.UTC(yr, mo - 1, dy, h - 3, 0, 0, 0));
          if (slotUtc <= now) continue;
          if (takenMs.has(slotUtc.getTime())) continue;
          availableSlots.push(slot);
        }

        if (availableSlots.length > 0) {
          days.push({ date: ksaDate, label: formatKsaDate(d), slots: availableSlots });
        }
      }

      res.json({ valid: true, days });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/book/:token — confirm a booking
  app.post('/api/book/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const { date, time } = z.object({ date: z.string(), time: z.string() }).parse(req.body);

      const mtg = await pool.query(
        `SELECT id, customer_phone, scheduled_at, token_expires_at
         FROM meetings WHERE meeting_token=$1 LIMIT 1`,
        [token]
      );
      if (mtg.rows.length === 0) return res.status(404).json({ message: 'Invalid booking link.' });
      const meeting = mtg.rows[0];
      if (new Date(meeting.token_expires_at) < new Date()) {
        return res.status(410).json({ message: 'This booking link has expired.' });
      }
      if (meeting.scheduled_at) {
        return res.status(409).json({ message: 'This meeting is already booked.' });
      }

      // Convert KSA date+time to UTC
      const [yr, mo, dy] = date.split('-').map(Number);
      const [h] = time.split(':').map(Number);
      const scheduledUtc = new Date(Date.UTC(yr, mo - 1, dy, h - 3, 0, 0, 0));

      // Check slot still available
      const takenRes = await pool.query(
        `SELECT 1 FROM meetings
         WHERE scheduled_at >= $1 AND scheduled_at < $2
           AND status != 'completed' AND id != $3`,
        [scheduledUtc, new Date(scheduledUtc.getTime() + 3600000), meeting.id]
      );
      if (takenRes.rows.length > 0) {
        return res.status(409).json({ message: 'This time slot was just taken. Please choose another.' });
      }
      const [bYr, bMo, bDy] = date.split('-').map(Number);
      const blockedDateKey = new Date(Date.UTC(bYr, bMo - 1, bDy) - KSA_OFFSET_MS).toISOString().slice(0, 10);
      const blockedRes = await pool.query(
        'SELECT 1 FROM blocked_slots WHERE date=$1::date AND time=$2',
        [blockedDateKey, time]
      );
      if (blockedRes.rows.length > 0) {
        return res.status(409).json({ message: 'This slot is not available. Please choose another.' });
      }

      // Generate Jitsi link
      const jitsiSuffix = crypto.randomBytes(8).toString('base64url').slice(0, 10);
      const meetingLink = `https://meet.jit.si/WAK-${jitsiSuffix}`;

      await pool.query(
        `UPDATE meetings SET meeting_link=$1, scheduled_at=$2, link_sent=FALSE WHERE id=$3`,
        [meetingLink, scheduledUtc, meeting.id]
      );

      // Send WhatsApp confirmation
      const ksaDt = new Date(scheduledUtc.getTime() + KSA_OFFSET_MS);
      const ksaLabel = formatKsaDateTime(ksaDt);
      const confirmMsg = `Your meeting is confirmed for ${ksaLabel} KSA time. Your meeting link will be sent to you 15 minutes before the meeting.`;
      if (process.env.N8N_SEND_WEBHOOK) {
        fetch(process.env.N8N_SEND_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-webhook-secret': process.env.WEBHOOK_SECRET || '' },
          body: JSON.stringify({ customer_phone: meeting.customer_phone, message: confirmMsg }),
        }).catch(e => console.error('WhatsApp confirmation error:', e));
      }

      // Notify manager of new booking (fire-and-forget, non-blocking)
      notifyManagerNewBooking({
        customerPhone: meeting.customer_phone,
        dateTimeLabel: ksaLabel,
        meetingLink,
        scheduledUtc,
      }).catch(e => console.error('Manager notification email error:', e));

      res.json({ success: true, ksa_label: ksaLabel });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Push Notification Routes
  app.get(api.push.vapidPublicKey.path, requireAuth, (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  app.post(api.push.subscribe.path, requireAuth, (req, res) => {
    const subscription = req.body;
    pushSubscriptions.set(subscription.endpoint, subscription);
    res.json({ success: true });
  });

  app.post(api.push.unsubscribe.path, requireAuth, (req, res) => {
    const subscription = req.body;
    pushSubscriptions.delete(subscription.endpoint);
    res.json({ success: true });
  });

  // ── Survey Routes ─────────────────────────────────────────────────────────
  await ensureSurveyTables();
  registerSurveyRoutes(app, requireAuth);

  return httpServer;
}

// ── Timezone helpers (KSA = UTC+3, no DST) ───────────────────────────────────

function formatKsaDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    timeZone: "UTC",
  });
}

function formatKsaDateTime(d: Date): string {
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const day = days[d.getUTCDay()];
  const month = months[d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day}, ${d.getUTCDate()} ${month} ${d.getUTCFullYear()} at ${hh}:${mm}`;
}
