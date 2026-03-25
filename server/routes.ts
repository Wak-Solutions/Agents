import crypto from "crypto";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { api } from "@shared/routes";
import { z } from "zod";
import { notifyManagerNewBooking } from "./email";
import { ensureSurveyTables, registerSurveyRoutes, sendSurveyToCustomer } from "./surveys";
import { ensureAgentsTable, registerAgentRoutes } from "./agents";
import bcrypt from 'bcrypt';
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

if (!process.env.DAILY_API_KEY) {
  console.error('[startup] DAILY_API_KEY is not set — meeting room creation will fail at booking time');
}

// Setup web-push
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL = process.env.VAPID_EMAIL || "mailto:test@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// In-memory push subscriptions — keyed by endpoint, stores agentId alongside subscription
const pushSubscriptions = new Map<string, { subscription: any; agentId: number }>();

// Track which chats have already triggered a notification to avoid re-firing on every message.
// Key format: "agentId:phone" for assigned chats, "all:phone" for unassigned chats.
// Cleared when the agent opens that chat (POST /api/notifications/mark-read/:phone).
const notifiedChats = new Set<string>();

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

// Admin-only middleware
const requireAdmin = (req: any, res: any, next: any) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (req.session.role !== 'admin') {
    return res.status(403).json({ message: "Admin access required" });
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

// Send push to every connected agent (unassigned chats, fallback)
const notifyAll = async (payload: any) => {
  const promises = Array.from(pushSubscriptions.values()).map(({ subscription }) =>
    webpush.sendNotification(subscription, JSON.stringify(payload)).catch(e => console.error("Push error", e))
  );
  await Promise.all(promises);
};

// Send push only to a specific agent's subscriptions
const notifyAgent = async (agentId: number, payload: any) => {
  const promises: Promise<any>[] = [];
  for (const { subscription, agentId: aid } of pushSubscriptions.values()) {
    if (aid === agentId) {
      promises.push(webpush.sendNotification(subscription, JSON.stringify(payload)).catch(e => console.error("Push error", e)));
    }
  }
  await Promise.all(promises);
};

// Send push only to admin agents (for escalations)
const notifyAdmins = async (payload: any) => {
  try {
    const adminRes = await pool.query("SELECT id FROM agents WHERE role='admin' AND is_active=true");
    const adminIds = new Set<number>(adminRes.rows.map((r: any) => r.id as number));
    const promises: Promise<any>[] = [];
    for (const { subscription, agentId } of pushSubscriptions.values()) {
      if (adminIds.has(agentId)) {
        promises.push(webpush.sendNotification(subscription, JSON.stringify(payload)).catch(e => console.error("Push error", e)));
      }
    }
    await Promise.all(promises);
  } catch (e) { console.error("notifyAdmins error", e); }
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Ensure index exists for fast token lookups on the booking page
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_meetings_meeting_token ON meetings(meeting_token)`
  );

  // Ensure agents table exists and seed default admin
  await ensureAgentsTable();
  await ensureSurveyTables();

  // Auth Routes
  app.post(api.auth.login.path, async (req, res) => {
    const { email, password } = req.body;

    // Email + password login (multi-agent)
    if (email) {
      try {
        const agentRes = await pool.query(
          `SELECT * FROM agents WHERE email=$1 LIMIT 1`,
          [email]
        );
        if (agentRes.rows.length === 0) {
          return res.status(401).json({ message: "Invalid credentials" });
        }
        const agent = agentRes.rows[0];
        if (!agent.is_active) {
          return res.status(403).json({ error: "Your account has been deactivated. Please contact your administrator." });
        }
        const valid = await bcrypt.compare(password, agent.password_hash);
        if (!valid) return res.status(401).json({ message: "Invalid credentials" });
        await pool.query(`UPDATE agents SET last_login=NOW() WHERE id=$1`, [agent.id]);
        req.session.authenticated = true;
        req.session.agentId = agent.id;
        req.session.role = agent.role;
        req.session.agentName = agent.name;
        return req.session.save((err) => {
          if (err) return res.status(500).json({ message: "Session save error" });
          res.json({ success: true, role: agent.role, name: agent.name });
        });
      } catch (err: any) {
        return res.status(500).json({ message: err.message });
      }
    }

    // Legacy password-only login (backward compat + WebAuthn flow)
    if (password === process.env.DASHBOARD_PASSWORD) {
      try {
        const adminRes = await pool.query(
          `SELECT * FROM agents WHERE role='admin' AND is_active=true ORDER BY id LIMIT 1`
        );
        const admin = adminRes.rows[0];
        req.session.authenticated = true;
        req.session.agentId = admin?.id ?? null;
        req.session.role = 'admin';
        req.session.agentName = admin?.name ?? 'Admin';
        return req.session.save((err) => {
          if (err) return res.status(500).json({ message: "Session save error" });
          res.json({ success: true });
        });
      } catch (err: any) {
        return res.status(500).json({ message: err.message });
      }
    }

    res.status(401).json({ message: "Invalid password" });
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
      res.json({
        authenticated: true,
        role: req.session.role || 'admin',
        agentId: req.session.agentId || null,
        agentName: req.session.agentName || 'Admin',
      });
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
        // Load the default admin for the session
        const adminRes = await pool.query(
          `SELECT * FROM agents WHERE role='admin' AND is_active=true ORDER BY id LIMIT 1`
        );
        const admin = adminRes.rows[0];
        if (!admin) {
          return res.status(403).json({ message: "No active admin account found." });
        }
        req.session.authenticated = true;
        req.session.agentId = admin.id;
        req.session.role = 'admin';
        req.session.agentName = admin.name;
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

  // Conversations Route — filtered by agent visibility rules
  app.get(api.conversations.list.path, requireAuth, async (req, res) => {
    try {
      const role = req.session.role || 'admin';
      const agentId = req.session.agentId || null;

      // Admin sees all; agents see only their assigned + unassigned chats
      const visibilityFilter = (role === 'admin')
        ? ''
        : `AND (e.assigned_agent_id = ${agentId} OR e.assigned_agent_id IS NULL OR e.customer_phone IS NULL)`;

      const result = await pool.query(`
        SELECT
          m.customer_phone,
          (SELECT message_text FROM messages WHERE customer_phone = m.customer_phone ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at  FROM messages WHERE customer_phone = m.customer_phone ORDER BY created_at DESC LIMIT 1) AS last_message_at,
          e.status             AS escalation_status,
          e.escalation_reason,
          e.assigned_agent_id,
          a.name               AS assigned_agent_name
        FROM (SELECT DISTINCT customer_phone FROM messages) m
        LEFT JOIN escalations e ON e.customer_phone = m.customer_phone
        LEFT JOIN agents a ON a.id = e.assigned_agent_id
        WHERE 1=1 ${visibilityFilter}
        ORDER BY last_message_at DESC NULLS LAST
      `);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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
      // Escalations → notify admins only
      await notifyAdmins({
        title: "Customer requesting agent — WAK",
        body: `${data.customer_phone} wants to speak to a human`,
        url: `/inbox`,
      });
      res.json(escalation);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post(api.escalations.close.path, requireAuth, async (req, res) => {
    try {
      const { customer_phone } = api.escalations.close.input.parse(req.body);

      // Fetch escalation id and assigned agent before closing
      const escRes = await pool.query(
        `SELECT id, assigned_agent_id FROM escalations WHERE customer_phone=$1 LIMIT 1`,
        [customer_phone]
      );
      const escalationId: number | null = escRes.rows[0]?.id ?? null;
      const agentId: number | null = (req.session.agentId as number | null) ?? escRes.rows[0]?.assigned_agent_id ?? null;

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
      sendSurveyToCustomer(customer_phone, agentId, escalationId);

      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Escalation Assignment Routes ──────────────────────────────────────────

  // GET /api/escalations/unassigned — any agent
  app.get('/api/escalations/unassigned', requireAuth, async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT e.*, a.name AS assigned_agent_name
        FROM escalations e
        LEFT JOIN agents a ON a.id = e.assigned_agent_id
        WHERE e.status = 'open' AND e.assigned_agent_id IS NULL
        ORDER BY e.created_at ASC
      `);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/escalations/:phone/claim — claim for current agent
  app.patch('/api/escalations/:phone/claim', requireAuth, async (req, res) => {
    try {
      const phone = decodeURIComponent(req.params.phone);
      const agentId = req.session.agentId;
      if (!agentId) return res.status(400).json({ message: 'No agent session found.' });
      // Block if already assigned to someone else
      const current = await pool.query(
        `SELECT assigned_agent_id FROM escalations WHERE customer_phone=$1`,
        [phone]
      );
      if (current.rows.length === 0) return res.status(404).json({ message: 'Escalation not found.' });
      if (current.rows[0].assigned_agent_id && current.rows[0].assigned_agent_id !== agentId) {
        return res.status(409).json({ message: 'This chat is already assigned to another agent.' });
      }
      await pool.query(
        `UPDATE escalations SET assigned_agent_id=$1, status='in_progress' WHERE customer_phone=$2`,
        [agentId, phone]
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/escalations/:phone/assign — admin only, can force-assign or unassign
  app.patch('/api/escalations/:phone/assign', requireAdmin, async (req, res) => {
    try {
      const phone = decodeURIComponent(req.params.phone);
      const { agentId } = z.object({ agentId: z.number().nullable() }).parse(req.body);
      await pool.query(
        `UPDATE escalations SET assigned_agent_id=$1 WHERE customer_phone=$2`,
        [agentId, phone]
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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

      // Look up whether this chat is assigned to a specific agent
      const escRow = await pool.query(
        `SELECT assigned_agent_id FROM escalations
         WHERE customer_phone=$1 AND status IN ('open','in_progress')
         ORDER BY created_at DESC LIMIT 1`,
        [data.customer_phone]
      );
      const assignedAgentId: number | null = escRow.rows[0]?.assigned_agent_id ?? null;

      if (assignedAgentId) {
        // Notify only the assigned agent, once per unread conversation
        const key = `${assignedAgentId}:${data.customer_phone}`;
        if (!notifiedChats.has(key)) {
          notifiedChats.add(key);
          await notifyAgent(assignedAgentId, {
            title: "New message",
            body: `${data.customer_phone}: ${data.message_text.substring(0, 60)}`,
            url: `/inbox`,
            data: { phone: data.customer_phone },
          });
        }
      } else {
        // Unassigned — notify all agents, once per unread conversation
        const key = `all:${data.customer_phone}`;
        if (!notifiedChats.has(key)) {
          notifiedChats.add(key);
          await notifyAll({
            title: "New customer waiting",
            body: `${data.customer_phone} is waiting — tap to claim`,
            url: `/inbox`,
            data: { phone: data.customer_phone },
          });
        }
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Unified Inbox ─────────────────────────────────────────────────────────
  // Returns active chats + upcoming meetings as a single sorted feed.
  // Dedup rule: if a customer has both an active chat AND a booked meeting,
  // they appear as one item (chat type) with meeting fields attached.
  // Meetings with no active chat appear as standalone meeting items.
  app.get('/api/inbox', requireAuth, async (_req, res) => {
    try {
      const [escRes, meetRes] = await Promise.all([
        // Active chats — attach the soonest upcoming meeting for that customer if any
        pool.query(`
          SELECT
            'chat'::text          AS item_type,
            e.customer_phone,
            e.escalation_reason,
            e.status              AS chat_status,
            e.created_at,
            e.assigned_agent_id,
            a.name                AS assigned_agent_name,
            m.id                  AS meeting_id,
            m.scheduled_at        AS meeting_scheduled_at,
            m.status              AS meeting_status,
            m.meeting_link,
            m.agent_id            AS meeting_agent_id,
            ma.name               AS meeting_agent_name
          FROM escalations e
          LEFT JOIN agents a  ON a.id  = e.assigned_agent_id
          LEFT JOIN LATERAL (
            SELECT * FROM meetings
            WHERE customer_phone = e.customer_phone
              AND scheduled_at IS NOT NULL
              AND status IN ('pending','in_progress')
            ORDER BY scheduled_at ASC LIMIT 1
          ) m ON true
          LEFT JOIN agents ma ON ma.id = m.agent_id
          WHERE e.status IN ('open','in_progress')
          ORDER BY e.created_at DESC
        `),
        // Booked upcoming meetings that have no active chat
        pool.query(`
          SELECT
            'meeting'::text       AS item_type,
            m.customer_phone,
            NULL::text            AS escalation_reason,
            NULL::text            AS chat_status,
            m.created_at,
            m.agent_id            AS assigned_agent_id,
            a.name                AS assigned_agent_name,
            m.id                  AS meeting_id,
            m.scheduled_at        AS meeting_scheduled_at,
            m.status              AS meeting_status,
            m.meeting_link,
            m.agent_id            AS meeting_agent_id,
            a.name                AS meeting_agent_name
          FROM meetings m
          LEFT JOIN agents a ON a.id = m.agent_id
          WHERE m.scheduled_at IS NOT NULL
            AND m.status IN ('pending','in_progress')
            AND NOT EXISTS (
              SELECT 1 FROM escalations e
              WHERE e.customer_phone = m.customer_phone
                AND e.status IN ('open','in_progress')
            )
          ORDER BY m.scheduled_at ASC
        `),
      ]);

      const items = [...escRes.rows, ...meetRes.rows].sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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

  // ── Chatbot Config ─────────────────────────────────────────────────────────

  // Migrate chatbot_config table to add structured_config + override_active
  await pool.query(`
    ALTER TABLE chatbot_config
      ADD COLUMN IF NOT EXISTS structured_config JSONB,
      ADD COLUMN IF NOT EXISTS override_active   BOOLEAN DEFAULT true
  `).catch(() => {});

  // Compile a structured config object into a system prompt string.
  // This is the single source of truth for how structured fields map to prompt text.
  function compilePrompt(cfg: any): string {
    const businessName = cfg.businessName || 'the business';
    const industry     = cfg.industry     ? `, ${cfg.industry}` : '';
    const toneLabel    = cfg.tone === 'Custom' ? (cfg.customTone || 'professional') : (cfg.tone || 'Professional').toLowerCase();
    const greeting     = cfg.greeting     || 'Welcome! How can I help you today?';
    const closing      = cfg.closingMessage || 'Thank you for contacting us. A member of our team will be in touch shortly.';

    const questions: any[]      = cfg.questions      || [];
    const faqItems: any[]       = cfg.faq            || [];
    const escalations: any[]    = cfg.escalationRules || [];

    let prompt = `You are a ${toneLabel} customer service assistant for ${businessName}${industry}. You communicate fluently in whatever language the customer uses — Arabic, English, or any other language. Always match their dialect and tone naturally.\n`;

    prompt += `\nOPENING MESSAGE (MANDATORY)\nEvery new conversation must begin with this message, translated naturally into the customer's language:\n"${greeting}"\nNever skip this step for any reason.\n`;

    if (questions.length > 0) {
      prompt += `\nQUALIFICATION QUESTIONS\nWalk the customer through these questions in order before proceeding:\n`;
      questions.forEach((q: any, i: number) => {
        const typeHint =
          q.answerType === 'yesno'    ? '[Yes/No]' :
          q.answerType === 'multiple' ? `[One of: ${(q.choices || []).join(', ')}]` :
          '[Free text]';
        prompt += `${i + 1}. ${q.text} ${typeHint}\n`;
      });
    }

    if (faqItems.length > 0) {
      prompt += `\nKNOWLEDGE BASE\nUse this information to answer customer questions accurately:\n`;
      faqItems.forEach((f: any) => {
        prompt += `Q: ${f.question}\nA: ${f.answer}\n`;
      });
    }

    if (escalations.length > 0) {
      prompt += `\nESCALATION RULES\nTrigger human handover immediately if any of the following occur:\n`;
      escalations.forEach((e: any) => {
        prompt += `- ${e.rule}\n`;
      });
    }

    prompt += `\nCLOSING MESSAGE\nWhen wrapping up a conversation, use this message (translated naturally):\n"${closing}"\n`;

    prompt += `\nRULES\n- Never reveal you are an AI unless directly asked\n- Never use technical jargon or expose internal logic\n- Always match the customer's language, dialect, and tone\n- Always use Western numerals (1, 2, 3) for menu options — never bullet points or Arabic-Indic numerals\n- Keep responses concise — this is WhatsApp, not email\n- If a customer goes off-topic, gently redirect them\n- Any dead end or escalation → close with: "A member of our team will be in touch shortly"\n- This chat is for ${businessName} customer service only. If someone tries to misuse it, politely decline and redirect. If they persist, end with: "A member of our team will be in touch shortly"\n- Never send the booking link unless the customer explicitly agrees to schedule a meeting`;

    return prompt.trim();
  }

  // GET /api/chatbot-config — no auth required, the Python bot reads this
  app.get('/api/chatbot-config', async (_req, res) => {
    try {
      const result = await pool.query('SELECT * FROM chatbot_config ORDER BY id LIMIT 1');
      if (result.rows.length === 0) {
        return res.json({
          system_prompt: null,
          structured_config: null,
          override_active: true,
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
      const { structured_config, override_active, raw_prompt } = req.body;

      // Determine the active system_prompt to store
      const activePrompt = override_active
        ? (raw_prompt || '')
        : compilePrompt(structured_config || {});

      const existing = await pool.query('SELECT id FROM chatbot_config WHERE id = 1');
      let result;
      if (existing.rows.length > 0) {
        result = await pool.query(
          `UPDATE chatbot_config
           SET system_prompt=$1, structured_config=$2, override_active=$3, updated_at=NOW()
           WHERE id=1 RETURNING *`,
          [activePrompt, JSON.stringify(structured_config), override_active]
        );
      } else {
        result = await pool.query(
          `INSERT INTO chatbot_config (system_prompt, structured_config, override_active, updated_at)
           VALUES ($1,$2,$3,NOW()) RETURNING *`,
          [activePrompt, JSON.stringify(structured_config), override_active]
        );
      }
      return res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/chatbot-config/preview — compile structured fields without saving
  app.post('/api/chatbot-config/preview', requireAuth, (req, res) => {
    try {
      const compiled = compilePrompt(req.body.structured_config || {});
      res.json({ prompt: compiled });
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
      if (filter === 'upcoming') where = "WHERE status IN ('pending', 'in_progress')";
      else if (filter === 'completed') where = "WHERE status = 'completed'";
      const result = await pool.query(
        `SELECT m.id, m.customer_phone, m.agent_id, a.name AS agent_name,
                m.meeting_link, m.meeting_token, m.agreed_time, m.scheduled_at,
                m.customer_email, m.status, m.created_at
         FROM meetings m
         LEFT JOIN agents a ON a.id = m.agent_id
         ${where} ORDER BY m.created_at DESC`
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch('/api/meetings/:id/start', requireAuth, async (req, res) => {
    try {
      const agentId = req.session.agentId ?? null;
      const result = await pool.query(
        `UPDATE meetings SET status = 'in_progress', agent_id = $2 WHERE id = $1
         RETURNING meetings.*, (SELECT name FROM agents WHERE id = $2) AS agent_name`,
        [req.params.id, agentId]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Meeting not found' });
      res.json(result.rows[0]);
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
      sendSurveyToCustomer(meeting.customer_phone, null, null, meeting.id);

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

  // ── Public Meeting Room Route (no auth) ──────────────────────────────────

  // GET /api/meeting/:token — returns meeting details for the branded meeting page
  app.get('/api/meeting/:token', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, meeting_link, scheduled_at, status
         FROM meetings WHERE meeting_token=$1 LIMIT 1`,
        [req.params.token]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Meeting not found.' });
      const m = result.rows[0];
      const scheduledTime = m.scheduled_at
        ? new Date(new Date(m.scheduled_at).getTime() + 3 * 60 * 60 * 1000).toISOString()
        : null;
      res.json({
        meeting_id: m.id,
        meeting_link: m.meeting_link || null,
        scheduled_time: scheduledTime,
        status: m.status,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public Booking Routes (no auth) ───────────────────────────────────────

  const KSA_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3

  // Returns the bookable slot strings for a given KSA day of week.
  // Friday (5): 17:00–00:00. All other days: 07:00–00:00.
  // "00:00" is the midnight slot — last slot of the booking day, stored as
  // next-calendar-day 00:00 KSA (h=24 in UTC conversion).
  function getSlotsForDay(ksaDayOfWeek: number): string[] {
    const start = ksaDayOfWeek === 5 ? 17 : 7; // 5 = Friday
    const slots: string[] = [];
    for (let h = start; h <= 23; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`);
    }
    slots.push('00:00'); // midnight — treated as h=24 in UTC math
    return slots;
  }

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
        const daySlots = getSlotsForDay(d.getUTCDay()); // d's UTC day == KSA day-of-week
        for (const slot of daySlots) {
          if (blockedSet.has(`${blockedDate}T${slot}`)) continue;
          // "00:00" is midnight = next calendar day 00:00 KSA, so treat as h=24
          const h = slot === '00:00' ? 24 : parseInt(slot.split(':')[0]);
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
        `SELECT id, customer_phone, meeting_token, scheduled_at, token_expires_at
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
      // "00:00" is the midnight slot = next calendar day 00:00 KSA, so treat as h=24
      const [yr, mo, dy] = date.split('-').map(Number);
      const h = time === '00:00' ? 24 : parseInt(time.split(':')[0]);
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

      // Create Daily.co room via API
      const dailyRes = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DAILY_API_KEY}`,
        },
        body: JSON.stringify({
          properties: {
            enable_prejoin_ui: false,
            enable_knocking: false,
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
          },
        }),
      });
      if (!dailyRes.ok) {
        const errText = await dailyRes.text();
        throw new Error(`Daily.co room creation failed: ${errText}`);
      }
      const dailyData = await dailyRes.json() as any;
      const meetingLink = dailyData.url as string; // e.g. https://wak.daily.co/abc123

      // Branded meeting link sent to customers
      const rawBase = (
        process.env.APP_URL ||
        process.env.RAILWAY_PUBLIC_URL ||
        process.env.RAILWAY_PUBLIC_DOMAIN ||
        'wak-agents.up.railway.app'
      ).replace(/\/$/, '');
      const baseUrl = rawBase.startsWith('http') ? rawBase : `https://${rawBase}`;
      const brandedLink = `${baseUrl}/meeting/${meeting.meeting_token}`;

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
        meetingLink: brandedLink,
        scheduledUtc,
      }).catch(e => console.error('Manager notification email error:', e));

      // Push notification — assigned agent only, or all if unassigned
      const meetingPush = {
        title: "Meeting booked",
        body: `${meeting.customer_phone} — ${ksaLabel}`,
        url: `/meetings`,
      };
      if (meeting.agent_id) {
        notifyAgent(meeting.agent_id, meetingPush).catch(e => console.error('Push error', e));
      } else {
        notifyAll(meetingPush).catch(e => console.error('Push error', e));
      }

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
    const agentId = (req as any).session.agentId as number;
    pushSubscriptions.set(subscription.endpoint, { subscription, agentId });
    res.json({ success: true });
  });

  app.post(api.push.unsubscribe.path, requireAuth, (req, res) => {
    const subscription = req.body;
    pushSubscriptions.delete(subscription.endpoint);
    res.json({ success: true });
  });

  // Mark a chat as read — clears the "already notified" flag so the agent
  // gets a new notification next time a message arrives on that chat.
  app.post('/api/notifications/mark-read/:phone', requireAuth, (req, res) => {
    const agentId = (req as any).session.agentId as number;
    const phone = decodeURIComponent(req.params.phone);
    notifiedChats.delete(`${agentId}:${phone}`);
    notifiedChats.delete(`all:${phone}`);
    res.json({ success: true });
  });

  // ── Survey Routes ─────────────────────────────────────────────────────────
  registerSurveyRoutes(app, requireAuth);

  // ── Agent Routes ───────────────────────────────────────────────────────────
  registerAgentRoutes(app, requireAdmin);

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
