/**
 * inbox.routes.ts — Unified inbox and conversations list.
 *
 * The inbox combines active escalation chats and upcoming meetings
 * into a single sorted feed. The conversations list shows all customers
 * filtered by agent visibility rules.
 */

import type { Express } from 'express';

import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { createLogger } from '../lib/logger';
import { api } from '@shared/routes';

const logger = createLogger('inbox');

export function registerInboxRoutes(app: Express): void {

  // GET /api/conversations — filtered by agent visibility rules
  app.get(api.conversations.list.path, requireAuth, async (req: any, res: any) => {
    try {
      const role = req.session.role || 'admin';
      const agentId = req.session.agentId || null;
      const companyId = req.companyId;

      // Admin sees all; agents see only their assigned + unassigned chats.
      const isAdmin = role === 'admin';

      const result = await pool.query(`
        SELECT
          m.customer_phone,
          (SELECT message_text FROM messages WHERE customer_phone = m.customer_phone AND company_id = $1 ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at  FROM messages WHERE customer_phone = m.customer_phone AND company_id = $1 ORDER BY created_at DESC LIMIT 1) AS last_message_at,
          e.status             AS escalation_status,
          e.escalation_reason,
          e.assigned_agent_id,
          a.name               AS assigned_agent_name
        FROM (SELECT DISTINCT customer_phone FROM messages WHERE company_id = $1) m
        LEFT JOIN LATERAL (
          SELECT status, escalation_reason, assigned_agent_id
          FROM escalations
          WHERE customer_phone = m.customer_phone
            AND company_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        ) e ON true
        LEFT JOIN agents a ON a.id = e.assigned_agent_id
        WHERE 1=1
          AND ($2 OR e.assigned_agent_id = $3 OR e.assigned_agent_id IS NULL)
        ORDER BY last_message_at DESC NULLS LAST
      `, [companyId, isAdmin, agentId]);
      res.json(result.rows);
    } catch (err: any) {
      logger.error('getConversations failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // GET /api/inbox — unified inbox: active chats + upcoming meetings as a single feed.
  // Dedup rule: if a customer has both an active chat AND a booked meeting,
  // they appear as one item (chat type) with meeting fields attached.
  app.get('/api/inbox', requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.companyId;
      const [escRes, meetRes] = await Promise.all([
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
              AND company_id = $1
              AND scheduled_at IS NOT NULL
              AND status IN ('pending','in_progress')
            ORDER BY scheduled_at ASC LIMIT 1
          ) m ON true
          LEFT JOIN agents ma ON ma.id = m.agent_id
          WHERE e.status IN ('open','in_progress')
            AND e.company_id = $1
          ORDER BY e.created_at DESC
        `, [companyId]),
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
            AND m.company_id = $1
            AND m.status IN ('pending','in_progress')
            AND NOT EXISTS (
              SELECT 1 FROM escalations e
              WHERE e.customer_phone = m.customer_phone
                AND e.company_id = $1
                AND e.status IN ('open','in_progress')
            )
          ORDER BY m.scheduled_at ASC
        `, [companyId]),
      ]);

      const items = [...escRes.rows, ...meetRes.rows].sort(
        (a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      res.json(items);
    } catch (err: any) {
      logger.error('getInbox failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });
}
