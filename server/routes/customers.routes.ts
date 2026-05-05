/**
 * customers.routes.ts — Customer journey and contacts management routes.
 *
 * Handles: paginated customer list, funnel analytics, full customer journey
 * timeline, and contacts CRUD (list, create, update, delete, bulk-delete, import).
 */

import type { Express } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { requireAdmin } from '../middleware/auth';
import { createLogger, maskPhone } from '../lib/logger';

const logger = createLogger('customers');

export function registerCustomerRoutes(app: Express): void {

  // GET /api/customers — paginated list with search
  app.get('/api/customers', requireAdmin, async (req: any, res: any) => {
    const page   = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit  = 20;
    const offset = (page - 1) * limit;
    const search = ((req.query.search as string) || '').trim();
    const companyId = req.companyId;

    try {
      const searchClause = search
        ? `AND (all_phones.phone ILIKE $4 OR cc.name ILIKE $4)`
        : '';
      const params: any[] = search ? [limit, offset, companyId, `%${search}%`] : [limit, offset, companyId];

      const rows = await pool.query(`
        WITH all_phones AS (
          SELECT DISTINCT customer_phone AS phone FROM messages WHERE company_id = $3
          UNION SELECT DISTINCT customer_phone FROM escalations WHERE company_id = $3
          UNION SELECT DISTINCT customer_phone FROM meetings WHERE company_id = $3
        )
        SELECT
          all_phones.phone,
          cc.name, cc.source,
          MIN(m.created_at)  AS first_seen,
          MAX(m.created_at)  AS last_seen,
          (SELECT COUNT(*) FROM messages       WHERE customer_phone = all_phones.phone AND company_id = $3) +
          (SELECT COUNT(*) FROM escalations    WHERE customer_phone = all_phones.phone AND company_id = $3) +
          (SELECT COUNT(*) FROM meetings       WHERE customer_phone = all_phones.phone AND company_id = $3) +
          (SELECT COUNT(*) FROM survey_responses WHERE customer_phone = all_phones.phone AND company_id = $3) +
          (SELECT COUNT(*) FROM orders         WHERE customer_phone = all_phones.phone AND company_id = $3) AS touchpoints
        FROM all_phones
        LEFT JOIN contacts c ON c.phone_number = all_phones.phone
        LEFT JOIN contact_companies cc ON cc.contact_id = c.id AND cc.company_id = $3
        LEFT JOIN messages m ON m.customer_phone = all_phones.phone AND m.company_id = $3
        ${searchClause}
        GROUP BY all_phones.phone, cc.name, cc.source
        ORDER BY first_seen DESC NULLS LAST
        LIMIT $1 OFFSET $2
      `, params);

      const totalParams: any[] = search ? [companyId, `%${search}%`] : [companyId];
      const totalQ = search
        ? `SELECT COUNT(*) FROM (
             SELECT DISTINCT all_phones.phone
             FROM (
               SELECT DISTINCT customer_phone AS phone FROM messages WHERE company_id = $1
               UNION SELECT DISTINCT customer_phone FROM escalations WHERE company_id = $1
               UNION SELECT DISTINCT customer_phone FROM meetings WHERE company_id = $1
             ) all_phones
             LEFT JOIN contacts c ON c.phone_number = all_phones.phone
             LEFT JOIN contact_companies cc ON cc.contact_id = c.id AND cc.company_id = $1
             WHERE all_phones.phone ILIKE $2 OR cc.name ILIKE $2
           ) t`
        : `SELECT COUNT(*) FROM (
             SELECT customer_phone FROM messages WHERE company_id = $1
             UNION SELECT customer_phone FROM escalations WHERE company_id = $1
             UNION SELECT customer_phone FROM meetings WHERE company_id = $1
           ) t`;
      const totalRes = await pool.query(totalQ, totalParams);

      res.json({
        customers: rows.rows.map((r: any) => ({
          phone:       r.phone,
          name:        r.name || null,
          source:      r.source || null,
          firstSeen:   r.first_seen,
          lastSeen:    r.last_seen,
          touchpoints: Number(r.touchpoints),
        })),
        total: Number(totalRes.rows[0].count),
        page,
      });
    } catch (err: any) {
      logger.error('getCustomers failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // GET /api/customers/funnel — conversion stage counts
  app.get('/api/customers/funnel', requireAdmin, async (req: any, res: any) => {
    const companyId = req.companyId;
    try {
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(DISTINCT customer_phone) FROM messages WHERE company_id = $1)                                AS first_contact,
          (SELECT COUNT(DISTINCT customer_phone) FROM messages WHERE company_id = $1 AND sender IN ('ai','agent'))   AS bot_conversation,
          (SELECT COUNT(DISTINCT customer_phone) FROM escalations WHERE company_id = $1)                             AS escalated,
          (SELECT COUNT(DISTINCT customer_phone) FROM meetings WHERE company_id = $1)                                AS meeting_booked,
          (SELECT COUNT(DISTINCT customer_phone) FROM survey_responses WHERE company_id = $1 AND submitted = true)   AS survey_submitted
      `, [companyId]);
      const r = result.rows[0];
      res.json({
        stages: [
          { stage: 'First Contact',      count: Number(r.first_contact)    },
          { stage: 'Bot Conversation',   count: Number(r.bot_conversation) },
          { stage: 'Escalated to Agent', count: Number(r.escalated)        },
          { stage: 'Meeting Booked',     count: Number(r.meeting_booked)   },
          { stage: 'Survey Submitted',   count: Number(r.survey_submitted) },
        ],
      });
    } catch (err: any) {
      logger.error('getFunnel failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // GET /api/customers/:phone/journey — full sorted timeline for one customer
  app.get('/api/customers/:phone/journey', requireAdmin, async (req: any, res: any) => {
    const phone = decodeURIComponent(req.params.phone);
    if (!/^\+?[0-9]{7,15}$/.test(phone)) {
      return res.status(400).json({ message: 'Invalid phone number format' });
    }
    const companyId = req.companyId;
    try {
      const [msgRes, escRes, meetRes, survRes, ordRes, contactRes] = await Promise.all([
        pool.query(
          `SELECT id, direction, sender, message_text, created_at
           FROM messages WHERE customer_phone = $1 AND company_id = $2 ORDER BY created_at ASC`,
          [phone, companyId]
        ),
        pool.query(
          `SELECT id, escalation_reason, status, assigned_agent_id, created_at
           FROM escalations WHERE customer_phone = $1 AND company_id = $2 ORDER BY created_at ASC`,
          [phone, companyId]
        ),
        pool.query(
          `SELECT id, status, meeting_link, meeting_token, created_at, scheduled_at
           FROM meetings WHERE customer_phone = $1 AND company_id = $2 ORDER BY created_at ASC`,
          [phone, companyId]
        ),
        pool.query(
          `SELECT sr.id, sr.submitted, sr.created_at, sr.submitted_at, s.title
           FROM survey_responses sr
           LEFT JOIN surveys s ON s.id = sr.survey_id AND s.company_id = $2
           WHERE sr.customer_phone = $1 AND sr.company_id = $2 ORDER BY sr.created_at ASC`,
          [phone, companyId]
        ),
        pool.query(
          `SELECT id, order_number, status, details, created_at
           FROM orders WHERE customer_phone = $1 AND company_id = $2 ORDER BY created_at ASC`,
          [phone, companyId]
        ),
        pool.query(
          `SELECT cc.name, cc.source
           FROM contacts c
           JOIN contact_companies cc ON cc.contact_id = c.id
           WHERE c.phone_number = $1 AND cc.company_id = $2
           LIMIT 1`,
          [phone, companyId]
        ),
      ]);

      const timeline: any[] = [];
      const msgs = msgRes.rows;

      if (msgs.length > 0) {
        timeline.push({
          type:      'first_contact',
          timestamp: msgs[0].created_at,
          summary:   'First contact via WhatsApp',
          meta:      { message: msgs[0].message_text?.slice(0, 120) },
        });

        let i = 1;
        while (i < msgs.length) {
          const sender  = msgs[i].sender;
          const isAgent = sender === 'agent';
          const type    = isAgent ? 'agent_message' : 'bot_message';
          let count     = 0;
          const start   = msgs[i].created_at;
          while (i < msgs.length && msgs[i].sender === sender) { count++; i++; }
          const end = msgs[i - 1].created_at;
          timeline.push({
            type,
            timestamp: start,
            summary:   `${count} ${isAgent ? 'agent' : 'bot'} message${count !== 1 ? 's' : ''}`,
            meta:      { count, from: start, to: end },
          });
        }
      }

      for (const e of escRes.rows) {
        timeline.push({
          type:      'escalation',
          timestamp: e.created_at,
          summary:   e.escalation_reason || 'Escalated to agent',
          meta:      { status: e.status, assigned_agent_id: e.assigned_agent_id, reason: e.escalation_reason },
        });
      }

      for (const m of meetRes.rows) {
        timeline.push({
          type:      'meeting_booked',
          timestamp: m.created_at,
          summary:   'Meeting booked',
          meta:      { meeting_token: m.meeting_token, status: m.status },
        });
        if (m.status === 'completed' && m.scheduled_at) {
          timeline.push({
            type:      'meeting_completed',
            timestamp: m.scheduled_at,
            summary:   'Meeting completed',
            meta:      { meeting_token: m.meeting_token },
          });
        }
      }

      for (const s of survRes.rows) {
        timeline.push({
          type:      'survey_sent',
          timestamp: s.created_at,
          summary:   `Survey sent${s.title ? ': ' + s.title : ''}`,
          meta:      { survey_title: s.title },
        });
        if (s.submitted && s.submitted_at) {
          timeline.push({
            type:      'survey_submitted',
            timestamp: s.submitted_at,
            summary:   `Survey submitted${s.title ? ': ' + s.title : ''}`,
            meta:      { survey_title: s.title },
          });
        }
      }

      for (const o of ordRes.rows) {
        timeline.push({
          type:      'order',
          timestamp: o.created_at,
          summary:   `Order ${o.order_number} — ${o.status}`,
          meta:      { order_number: o.order_number, status: o.status, details: o.details },
        });
      }

      timeline.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      const contact = contactRes.rows[0];
      res.json({
        customer: {
          phone,
          name:      contact?.name || null,
          source:    contact?.source || null,
          firstSeen: msgs[0]?.created_at || null,
        },
        timeline,
      });
    } catch (err: any) {
      logger.error('getCustomerJourney failed', `phone: ${maskPhone(phone)}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // ── Contacts CRUD ──────────────────────────────────────────────────────────

  app.get('/api/contacts', requireAdmin, async (req: any, res: any) => {
    const companyId = req.companyId;
    try {
      const result = await pool.query(
        `SELECT c.id, c.phone_number, cc.name, cc.source, cc.created_at
         FROM contacts c
         JOIN contact_companies cc ON cc.contact_id = c.id
         WHERE cc.company_id = $1
         ORDER BY cc.created_at DESC`,
        [companyId]
      );
      res.json(result.rows);
    } catch (err: any) {
      logger.error('getContacts failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  app.post('/api/contacts', requireAdmin, async (req: any, res: any) => {
    const { name, phone_number } = req.body;
    if (!phone_number) return res.status(400).json({ message: 'Phone number is required' });
    const phone = String(phone_number).trim().replace(/[\s\-().]/g, '');
    if (!/^\+?\d{7,15}$/.test(phone)) return res.status(400).json({ message: 'invalid_phone' });
    const companyId = req.companyId;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const upsert = await client.query(
        `INSERT INTO contacts (phone_number, source)
         VALUES ($1, 'manual')
         ON CONFLICT (phone_number) DO NOTHING
         RETURNING id, phone_number`,
        [phone]
      );
      // If ON CONFLICT fired, fetch the existing contact id
      const contactId: number = upsert.rows[0]?.id ?? (
        await client.query(`SELECT id FROM contacts WHERE phone_number = $1`, [phone])
      ).rows[0].id;
      const link = await client.query(
        `INSERT INTO contact_companies (contact_id, company_id, source, name)
         VALUES ($1, $2, 'manual', $3)
         ON CONFLICT (contact_id, company_id) DO NOTHING
         RETURNING source, created_at, name`,
        [contactId, companyId, (name || '').trim() || null]
      );
      if (link.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'duplicate' });
      }
      await client.query('COMMIT');
      logger.info('Contact created', `phone: ${maskPhone(phone)}`);
      res.json({
        id: contactId,
        phone_number: phone,
        name: link.rows[0].name,
        source: link.rows[0].source,
        created_at: link.rows[0].created_at,
      });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('createContact failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    } finally {
      client.release();
    }
  });

  app.patch('/api/contacts/:id', requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { name } = req.body;
    const companyId = req.companyId;
    try {
      const result = await pool.query(
        `UPDATE contact_companies cc SET name = $1
         FROM contacts c
         WHERE cc.contact_id = c.id AND c.id = $2 AND cc.company_id = $3
         RETURNING c.id, c.phone_number, cc.name, cc.source, cc.created_at`,
        [(name || '').trim() || null, id, companyId]
      );
      if (result.rowCount === 0) return res.status(404).json({ message: 'Not found' });
      res.json(result.rows[0]);
    } catch (err: any) {
      logger.error('updateContact failed', `contactId: ${id}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  app.delete('/api/contacts/:id', requireAdmin, async (req: any, res: any) => {
    const companyId = req.companyId;
    try {
      const id = Number(req.params.id);
      const link = await pool.query(
        `DELETE FROM contact_companies WHERE contact_id = $1 AND company_id = $2 RETURNING contact_id`,
        [id, companyId]
      );
      if (link.rowCount === 0) return res.status(404).json({ message: 'Contact not found' });
      await pool.query(
        `DELETE FROM contacts WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM contact_companies WHERE contact_id = $1)`,
        [id]
      );
      logger.info('Contact deleted', `contactId: ${req.params.id}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('deleteContact failed', `contactId: ${req.params.id}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  app.post('/api/contacts/bulk-delete', requireAdmin, async (req: any, res: any) => {
    let ids: number[];
    try {
      ids = z.array(z.number().int().positive()).min(1).parse(req.body.ids);
    } catch {
      return res.status(400).json({ message: 'ids must be an array of positive integers' });
    }
    const companyId = req.companyId;
    try {
      await pool.query(
        `DELETE FROM contact_companies WHERE contact_id = ANY($1::int[]) AND company_id = $2`,
        [ids, companyId]
      );
      await pool.query(
        `DELETE FROM contacts WHERE id = ANY($1::int[])
         AND NOT EXISTS (SELECT 1 FROM contact_companies WHERE contact_id = contacts.id)`,
        [ids]
      );
      logger.info('Contacts bulk deleted', `count: ${ids.length}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('bulkDeleteContacts failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  app.post('/api/contacts/import', requireAdmin, async (req: any, res: any) => {
    const { contacts: rows } = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ message: 'Invalid payload' });
    if (rows.length > 10_000) return res.status(400).json({ message: 'Import exceeds 10,000 row limit' });
    const companyId = req.companyId;
    let added = 0, duplicates = 0, invalid = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const phone = String(row.phone || '').trim().replace(/[\s\-().]/g, '');
        const name  = String(row.name  || '').trim() || null;
        if (!/^\+?\d{7,15}$/.test(phone)) { invalid++; continue; }
        try {
          const upsert = await client.query(
            `INSERT INTO contacts (phone_number, source)
             VALUES ($1, 'imported')
             ON CONFLICT (phone_number) DO NOTHING
             RETURNING id`,
            [phone]
          );
          const contactId: number = upsert.rows[0]?.id ?? (
            await client.query(`SELECT id FROM contacts WHERE phone_number = $1`, [phone])
          ).rows[0].id;
          const link = await client.query(
            `INSERT INTO contact_companies (contact_id, company_id, source, name)
             VALUES ($1, $2, 'imported', $3)
             ON CONFLICT (contact_id, company_id) DO NOTHING
             RETURNING contact_id`,
            [contactId, companyId, name]
          );
          if ((link.rowCount ?? 0) > 0) added++; else duplicates++;
        } catch (_) {
          invalid++;
        }
      }
      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('importContacts failed', err.message);
      return res.status(500).json({ message: 'Internal error' });
    } finally {
      client.release();
    }
    logger.info('Contacts import complete', `added: ${added}, duplicates: ${duplicates}, invalid: ${invalid}`);
    res.json({ added, duplicates, invalid });
  });
}
