/**
 * messages.routes.ts — Message and voice note routes.
 *
 * Handles: get conversation history, stream voice notes,
 * send a message from the dashboard, and receive incoming-message
 * webhook notifications from the Python bot.
 */

import type { Express } from 'express';

import { pool } from '../db';
import { storage } from '../storage';
import { requireAuth, requireWebhookSecret } from '../middleware/auth';
import { notifyAgent, notifyAll, notifiedChats } from '../push';
import { createLogger, maskPhone } from '../lib/logger';
import { api } from '@shared/routes';

const logger = createLogger('messages');

export function registerMessageRoutes(app: Express): void {

  // GET /api/messages/:phone — conversation history
  app.get(api.messages.list.path, requireAuth, async (req: any, res: any) => {
    const phone = req.params.phone;
    const companyId = req.session.companyId;
    try {
      const result = await pool.query(
        `SELECT * FROM messages
         WHERE customer_phone = $1 AND company_id = $2
         ORDER BY created_at ASC`,
        [phone, companyId]
      );
      res.json(result.rows);
    } catch (err: any) {
      logger.error('getMessages failed', `phone: ${maskPhone(phone)}, error: ${err.message}`);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/voice-notes/:id — stream stored audio (authenticated)
  app.get('/api/voice-notes/:id', requireAuth, async (req: any, res: any) => {
    const { id } = req.params;
    try {
      const companyId = req.session.companyId;
      const result = await pool.query(
        'SELECT audio_data, mime_type FROM voice_notes WHERE id = $1::uuid AND company_id = $2',
        [id, companyId]
      );
      if (result.rows.length === 0) {
        logger.warn('Voice note not found', `id: ${id}`);
        res.status(404).json({ message: 'Voice note not found' });
        return;
      }
      const { audio_data, mime_type } = result.rows[0];
      res.setHeader('Content-Type', mime_type || 'audio/ogg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(audio_data);
    } catch (err: any) {
      logger.error('getVoiceNote failed', `id: ${id}, error: ${err.message}`);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/send — agent sends a message from the dashboard via Meta Cloud API
  app.post(api.messages.send.path, requireAuth, async (req: any, res: any) => {
    try {
      const data = api.messages.send.input.parse(req.body);
      const companyId = req.session.companyId;
      logger.info(
        'Agent message send requested',
        `phone: ${maskPhone(data.customer_phone)}, type: text`
      );

      // Look up this company's WhatsApp credentials
      const credRes = await pool.query(
        `SELECT whatsapp_phone_number_id, whatsapp_token FROM companies WHERE id = $1`,
        [companyId]
      );
      const creds = credRes.rows[0];
      if (!creds?.whatsapp_phone_number_id || !creds?.whatsapp_token) {
        logger.error('Send failed — company missing WhatsApp credentials', `companyId: ${companyId}`);
        return res.status(503).json({
          message: 'WhatsApp credentials not configured for this account. Go to Settings to add them.',
        });
      }

      const metaUrl = `https://graph.facebook.com/v19.0/${creds.whatsapp_phone_number_id}/messages`;
      const metaRes = await fetch(metaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${creds.whatsapp_token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: data.customer_phone,
          type: 'text',
          text: { body: data.message },
        }),
      });

      if (!metaRes.ok) {
        const errBody = await metaRes.text();
        logger.error(
          'Meta Cloud API send failed',
          `phone: ${maskPhone(data.customer_phone)}, status: ${metaRes.status}, body: ${errBody.slice(0, 200)}`
        );
        return res.status(502).json({ message: 'Failed to send message via WhatsApp. Check credentials.' });
      }

      // Save the outbound message — reuse or start a conversation_id (24-hour session)
      const convRes = await pool.query(
        `SELECT conversation_id FROM messages
         WHERE customer_phone = $1 AND company_id = $2
           AND conversation_id IS NOT NULL
           AND created_at > NOW() - INTERVAL '24 hours'
         ORDER BY created_at DESC LIMIT 1`,
        [data.customer_phone, companyId]
      );
      const conversationId = convRes.rows[0]?.conversation_id ?? null;
      await pool.query(
        `INSERT INTO messages (customer_phone, direction, message_text, company_id, created_at, conversation_id)
         VALUES ($1, 'outbound', $2, $3, NOW(), COALESCE($4::uuid, gen_random_uuid()))`,
        [data.customer_phone, data.message, companyId, conversationId]
      );

      logger.info(
        'Agent message delivered via Meta Cloud API',
        `phone: ${maskPhone(data.customer_phone)}`
      );
      res.json({ success: true });
    } catch (err: any) {
      logger.error('send failed', err.message);
      res.status(400).json({ message: err.message });
    }
  });

  // POST /api/incoming — webhook from Python bot (new inbound customer message)
  app.post(api.messages.incoming.path, requireWebhookSecret, async (req: any, res: any) => {
    try {
      const data = api.messages.incoming.input.parse(req.body);
      logger.info(
        'Inbound message received from bot',
        `phone: ${maskPhone(data.customer_phone)}, type: text`
      );

      // Look up whether this chat is assigned to a specific agent.
      const companyId = parseInt(req.body.company_id);
      if (!companyId) return res.status(400).json({ message: 'company_id is required' });
      const escRow = await pool.query(
        `SELECT assigned_agent_id FROM escalations
         WHERE customer_phone=$1 AND status IN ('open','in_progress') AND company_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [data.customer_phone, companyId]
      );
      const assignedAgentId: number | null = escRow.rows[0]?.assigned_agent_id ?? null;

      if (assignedAgentId) {
        const key = `${assignedAgentId}:${data.customer_phone}`;
        if (!notifiedChats.has(key)) {
          notifiedChats.add(key);
          await notifyAgent(assignedAgentId, {
            title: 'New message',
            body: `${maskPhone(data.customer_phone)}: ${data.message_text.substring(0, 60)}`,
            url: '/inbox',
            data: { phone: data.customer_phone },
          });
        }
      } else {
        const key = `all:${data.customer_phone}`;
        if (!notifiedChats.has(key)) {
          notifiedChats.add(key);
          await notifyAll({
            title: 'New customer waiting',
            body: `${maskPhone(data.customer_phone)} is waiting — tap to claim`,
            url: '/inbox',
            data: { phone: data.customer_phone },
          });
        }
      }

      res.json({ success: true });
    } catch (err: any) {
      logger.error('incoming webhook failed', err.message);
      res.status(400).json({ message: err.message });
    }
  });

  // POST /api/notifications/mark-read/:phone — clear notification dedup flag
  app.post('/api/notifications/mark-read/:phone', requireAuth, (req: any, res: any) => {
    const agentId = req.session.agentId as number;
    const phone = decodeURIComponent(req.params.phone);
    notifiedChats.delete(`${agentId}:${phone}`);
    notifiedChats.delete(`all:${phone}`);
    res.json({ success: true });
  });
}
