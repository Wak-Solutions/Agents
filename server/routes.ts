import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
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
        return res.status(503).json({ message: "OPENAI_API_KEY is not configured on the server." });
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

  return httpServer;
}
