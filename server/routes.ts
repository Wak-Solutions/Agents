import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import webpush from "web-push";

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
      const message = await storage.createMessage({
        customer_phone: data.customer_phone,
        message_text: data.message,
        direction: 'outbound',
        sender: 'agent'
      });

      // Call n8n webhook
      if (process.env.N8N_SEND_WEBHOOK) {
        fetch(process.env.N8N_SEND_WEBHOOK, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': process.env.WEBHOOK_SECRET || ''
          },
          body: JSON.stringify({ customer_phone: data.customer_phone, message: data.message })
        }).catch(e => console.error("Error calling n8n send webhook", e));
      }

      res.json(message);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post(api.messages.incoming.path, requireWebhookSecret, async (req, res) => {
    try {
      const data = api.messages.incoming.input.parse(req.body);
      const message = await storage.createMessage({
        customer_phone: data.customer_phone,
        message_text: data.message_text,
        direction: 'inbound',
        sender: 'customer'
      });

      const escalation = await storage.getEscalation(data.customer_phone);
      if (escalation && escalation.status === 'open') {
        await notifyAgents({
          title: "New Message",
          body: `${data.customer_phone}: ${data.message_text.substring(0, 50)}...`,
          url: `/?phone=${data.customer_phone}`
        });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
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
