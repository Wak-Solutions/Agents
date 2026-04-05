/**
 * meetings.routes.ts — Meeting management and public booking routes.
 *
 * Handles: create-token (for the bot), list meetings, start/complete a meeting,
 * availability calendar (blocked slots + booked slots), and the public booking
 * flow (GET + POST /api/book/:token) including Daily.co room creation.
 */

import crypto from 'crypto';
import { z } from 'zod';
import type { Express } from 'express';

import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireWebhookSecret } from '../middleware/auth';
import { notifyAgent, notifyAll } from '../push';
import { notifyManagerNewBooking } from '../email';
import { sendSurveyToCustomer } from '../surveys';
import { createDailyRoom } from '../integrations/daily';
import { KSA_OFFSET_MS, formatKsaDate, formatKsaDateTime } from '../lib/timezone';
import { getSlotsForDay } from '../lib/slots';
import { createLogger, maskPhone } from '../lib/logger';

const logger = createLogger('meetings');

export function registerMeetingRoutes(app: Express): void {

  // ── Internal: create booking token (called by Python bot) ────────────────
  app.post('/api/meetings/create-token', requireWebhookSecret, async (req: any, res: any) => {
    try {
      const { customer_phone } = req.body;
      if (!customer_phone) {
        return res.status(400).json({ message: 'customer_phone is required' });
      }
      const companyId = req.body.company_id || 1;
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO meetings (customer_phone, meeting_link, meeting_token, token_expires_at, status, created_at, company_id)
         VALUES ($1, '', $2, $3, 'pending', NOW(), $4)`,
        [customer_phone, token, expiresAt, companyId]
      );
      logger.info('Meeting token created', `phone: ${maskPhone(customer_phone)}`);
      return res.json({ token });
    } catch (err: any) {
      logger.error('create-token failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── List meetings (dashboard) ─────────────────────────────────────────────
  app.get('/api/meetings', requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.companyId;
      const filter = (req.query.filter as string) || 'all';
      let where = 'WHERE m.company_id = $1';
      if (filter === 'upcoming') where += " AND status IN ('pending', 'in_progress')";
      else if (filter === 'completed') where += " AND status = 'completed'";
      const result = await pool.query(
        `SELECT m.id, m.customer_phone, m.agent_id, a.name AS agent_name,
                m.meeting_link, m.meeting_token, m.agreed_time, m.scheduled_at,
                m.customer_email, m.status, m.created_at
         FROM meetings m
         LEFT JOIN agents a ON a.id = m.agent_id
         ${where} ORDER BY m.created_at DESC`,
        [companyId]
      );
      res.json(result.rows);
    } catch (err: any) {
      logger.error('listMeetings failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Start a meeting ───────────────────────────────────────────────────────
  app.patch('/api/meetings/:id/start', requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.companyId;
      const agentId = req.session.agentId ?? null;
      const result = await pool.query(
        `UPDATE meetings SET status = 'in_progress', agent_id = $2 WHERE id = $1 AND company_id = $3
         RETURNING meetings.*, (SELECT name FROM agents WHERE id = $2) AS agent_name`,
        [req.params.id, agentId, companyId]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Meeting not found' });
      logger.info('Meeting started', `meetingId: ${req.params.id}, agentId: ${agentId}`);
      res.json(result.rows[0]);
    } catch (err: any) {
      logger.error('startMeeting failed', `meetingId: ${req.params.id}, error: ${err.message}`);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Complete a meeting ────────────────────────────────────────────────────
  app.patch('/api/meetings/:id/complete', requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.companyId;
      const result = await pool.query(
        `UPDATE meetings SET status = 'completed' WHERE id = $1 AND company_id = $2 RETURNING *`,
        [req.params.id, companyId]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Meeting not found' });
      const meeting = result.rows[0];
      logger.info('Meeting completed', `meetingId: ${req.params.id}`);
      sendSurveyToCustomer(meeting.customer_phone, null, null, meeting.id);
      res.json(meeting);
    } catch (err: any) {
      logger.error('completeMeeting failed', `meetingId: ${req.params.id}, error: ${err.message}`);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Availability: get blocked slots ───────────────────────────────────────
  app.get('/api/availability', requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.companyId;
      const weekStart = (req.query.weekStart as string) || new Date().toISOString().slice(0, 10);
      const result = await pool.query(
        `SELECT date::text, time FROM blocked_slots
         WHERE date >= $1::date AND date < $1::date + INTERVAL '7 days'
           AND company_id = $2
         ORDER BY date, time`,
        [weekStart, companyId]
      );
      res.json(result.rows);
    } catch (err: any) {
      logger.error('getAvailability failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Availability: toggle a blocked slot ───────────────────────────────────
  app.post('/api/availability/toggle', requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.companyId;
      const { date, time } = z.object({ date: z.string(), time: z.string() }).parse(req.body);
      const existing = await pool.query(
        'SELECT id FROM blocked_slots WHERE date=$1::date AND time=$2 AND company_id = $3',
        [date, time, companyId]
      );
      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM blocked_slots WHERE date=$1::date AND time=$2 AND company_id = $3', [date, time, companyId]);
        logger.info('Slot unblocked', `date: ${date}, time: ${time}`);
        res.json({ blocked: false });
      } else {
        await pool.query(
          'INSERT INTO blocked_slots (date, time, company_id) VALUES ($1::date, $2, $3) ON CONFLICT DO NOTHING',
          [date, time, companyId]
        );
        logger.info('Slot blocked', `date: ${date}, time: ${time}`);
        res.json({ blocked: true });
      }
    } catch (err: any) {
      logger.error('toggleAvailability failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Availability: get booked slots for a week ─────────────────────────────
  app.get('/api/availability/booked', requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.companyId;
      const weekStart = (req.query.weekStart as string) || new Date().toISOString().slice(0, 10);
      const [yr, mo, dy] = weekStart.split('-').map(Number);
      const weekStartUtc = new Date(Date.UTC(yr, mo - 1, dy + 1, 0, 0, 0) - KSA_OFFSET_MS);
      const weekEndUtc = new Date(weekStartUtc.getTime() + 7 * 24 * 60 * 60 * 1000);
      const result = await pool.query(
        `SELECT scheduled_at FROM meetings
         WHERE scheduled_at >= $1 AND scheduled_at < $2
           AND scheduled_at IS NOT NULL
           AND status != 'completed'
           AND company_id = $3`,
        [weekStartUtc, weekEndUtc, companyId]
      );
      const rows = result.rows.map((r: { scheduled_at: Date }) => {
        const ksa = new Date(new Date(r.scheduled_at).getTime() + KSA_OFFSET_MS);
        const ksaMidnightUtc = new Date(
          Date.UTC(ksa.getUTCFullYear(), ksa.getUTCMonth(), ksa.getUTCDate()) - KSA_OFFSET_MS
        );
        const date = ksaMidnightUtc.toISOString().slice(0, 10);
        const time = `${String(ksa.getUTCHours()).padStart(2, '0')}:00`;
        return { date, time };
      });
      res.json(rows);
    } catch (err: any) {
      logger.error('getBookedSlots failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public: get meeting details by token ──────────────────────────────────
  app.get('/api/meeting/:token', async (req: any, res: any) => {
    try {
      const result = await pool.query(
        `SELECT id, meeting_link, scheduled_at, status, company_id
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
      logger.error('getMeeting failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public: get available booking slots ───────────────────────────────────
  app.get('/api/book/:token', async (req: any, res: any) => {
    try {
      const { token } = req.params;
      const mtg = await pool.query(
        `SELECT id, customer_phone, scheduled_at, status, token_expires_at, company_id
         FROM meetings WHERE meeting_token=$1 LIMIT 1`,
        [token]
      );
      if (mtg.rows.length === 0) return res.status(404).json({ message: 'Invalid booking link.' });
      const meeting = mtg.rows[0];
      const companyId = meeting.company_id;
      if (new Date(meeting.token_expires_at) < new Date()) {
        return res.status(410).json({ message: 'This booking link has expired.' });
      }
      if (meeting.scheduled_at) {
        const ksaTime = new Date(new Date(meeting.scheduled_at).getTime() + KSA_OFFSET_MS);
        return res.json({
          alreadyBooked: true,
          scheduled_at: meeting.scheduled_at,
          ksa_label: formatKsaDateTime(ksaTime),
        });
      }

      const now = new Date();
      const ksaNow = new Date(now.getTime() + KSA_OFFSET_MS);
      const windowStart = new Date(now);
      windowStart.setUTCHours(0, 0, 0, 0);
      const windowEnd = new Date(windowStart.getTime() + 31 * 24 * 3600 * 1000);

      const ksaWindowStart = ksaNow.toISOString().slice(0, 10);
      const [ksaYr, ksaMo, ksaDy] = ksaWindowStart.split('-').map(Number);
      const blockedWindowStart = new Date(
        Date.UTC(ksaYr, ksaMo - 1, ksaDy) - KSA_OFFSET_MS
      ).toISOString().slice(0, 10);

      const [blockedRes, takenRes] = await Promise.all([
        pool.query(
          `SELECT date::text, time FROM blocked_slots
           WHERE date >= $1::date AND date < $1::date + INTERVAL '32 days'
             AND company_id = $2`,
          [blockedWindowStart, companyId]
        ),
        pool.query(
          `SELECT scheduled_at FROM meetings
           WHERE scheduled_at >= $1 AND scheduled_at < $2
             AND status != 'completed' AND id != $3
             AND company_id = $4`,
          [windowStart, windowEnd, meeting.id, companyId]
        ),
      ]);

      const blockedSet = new Set(blockedRes.rows.map((r: any) => `${r.date}T${r.time}`));
      const takenMs = new Set(takenRes.rows.map((r: any) => new Date(r.scheduled_at).getTime()));

      const days: { date: string; label: string; slots: string[] }[] = [];

      for (let i = 0; i <= 30; i++) {
        const d = new Date(ksaNow);
        d.setUTCDate(d.getUTCDate() + i);
        const ksaDate = d.toISOString().slice(0, 10);
        const [yr, mo, dy] = ksaDate.split('-').map(Number);
        const blockedDate = new Date(
          Date.UTC(yr, mo - 1, dy) - KSA_OFFSET_MS
        ).toISOString().slice(0, 10);

        const availableSlots: string[] = [];
        const daySlots = getSlotsForDay(d.getUTCDay());
        for (const slot of daySlots) {
          if (blockedSet.has(`${blockedDate}T${slot}`)) continue;
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
      logger.error('getBookingSlots failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public: confirm a booking ─────────────────────────────────────────────
  app.post('/api/book/:token', async (req: any, res: any) => {
    try {
      const { token } = req.params;
      const { date, time } = z.object({ date: z.string(), time: z.string() }).parse(req.body);

      const mtg = await pool.query(
        `SELECT id, customer_phone, meeting_token, scheduled_at, token_expires_at, agent_id, company_id
         FROM meetings WHERE meeting_token=$1 LIMIT 1`,
        [token]
      );
      if (mtg.rows.length === 0) return res.status(404).json({ message: 'Invalid booking link.' });
      const meeting = mtg.rows[0];
      const companyId = meeting.company_id;
      if (new Date(meeting.token_expires_at) < new Date()) {
        return res.status(410).json({ message: 'This booking link has expired.' });
      }
      if (meeting.scheduled_at) {
        return res.status(409).json({ message: 'This meeting is already booked.' });
      }

      // Convert KSA date+time to UTC
      const [yr, mo, dy] = date.split('-').map(Number);
      const h = time === '00:00' ? 24 : parseInt(time.split(':')[0]);
      const scheduledUtc = new Date(Date.UTC(yr, mo - 1, dy, h - 3, 0, 0, 0));

      // Verify slot is still available
      const [takenRes, blockedRes] = await Promise.all([
        pool.query(
          `SELECT 1 FROM meetings
           WHERE scheduled_at >= $1 AND scheduled_at < $2
             AND status != 'completed' AND id != $3
             AND company_id = $4`,
          [scheduledUtc, new Date(scheduledUtc.getTime() + 3600000), meeting.id, companyId]
        ),
        pool.query(
          'SELECT 1 FROM blocked_slots WHERE date=$1::date AND time=$2 AND company_id = $3',
          [new Date(Date.UTC(yr, mo - 1, dy) - KSA_OFFSET_MS).toISOString().slice(0, 10), time, companyId]
        ),
      ]);

      if (takenRes.rows.length > 0) {
        return res.status(409).json({ message: 'This time slot was just taken. Please choose another.' });
      }
      if (blockedRes.rows.length > 0) {
        return res.status(409).json({ message: 'This slot is not available. Please choose another.' });
      }

      // Create Daily.co room
      const room = await createDailyRoom();
      const meetingLink = room.url;

      // Build branded meeting link for the customer
      const rawBase = (
        process.env.APP_URL ||
        process.env.RAILWAY_PUBLIC_URL ||
        process.env.RAILWAY_PUBLIC_DOMAIN ||
        'wak-agents.up.railway.app'
      ).replace(/\/$/, '');
      const baseUrl = rawBase.startsWith('http') ? rawBase : `https://${rawBase}`;
      const brandedLink = `${baseUrl}/meeting/${meeting.meeting_token}`;

      await pool.query(
        `UPDATE meetings SET meeting_link=$1, scheduled_at=$2, link_sent=FALSE WHERE id=$3 AND company_id=$4`,
        [meetingLink, scheduledUtc, meeting.id, companyId]
      );

      const ksaDt = new Date(scheduledUtc.getTime() + KSA_OFFSET_MS);
      const ksaLabel = formatKsaDateTime(ksaDt);

      logger.info(
        'Meeting booked',
        `phone: ${maskPhone(meeting.customer_phone)}, time: ${ksaLabel}`
      );

      // Send WhatsApp confirmation (non-blocking)
      const confirmMsg = `Your meeting is confirmed for ${ksaLabel} KSA time. Your meeting link will be sent to you 15 minutes before the meeting.`;
      if (process.env.N8N_SEND_WEBHOOK) {
        fetch(process.env.N8N_SEND_WEBHOOK, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': process.env.WEBHOOK_SECRET || '',
          },
          body: JSON.stringify({ customer_phone: meeting.customer_phone, message: confirmMsg }),
        }).catch((e: any) => logger.error('WhatsApp confirmation failed', e.message));
      }

      // Email manager (non-blocking)
      notifyManagerNewBooking({
        customerPhone: meeting.customer_phone,
        dateTimeLabel: ksaLabel,
        meetingLink: brandedLink,
        scheduledUtc,
      }).catch((e: any) => logger.error('Manager email failed', e.message));

      // Push notification
      const meetingPush = {
        title: 'Meeting booked',
        body: `${maskPhone(meeting.customer_phone)} — ${ksaLabel}`,
        url: '/meetings',
      };
      if (meeting.agent_id) {
        notifyAgent(meeting.agent_id, meetingPush).catch(
          (e: any) => logger.error('Push failed', e.message)
        );
      } else {
        notifyAll(meetingPush).catch(
          (e: any) => logger.error('Push failed', e.message)
        );
      }

      res.json({ success: true, ksa_label: ksaLabel });
    } catch (err: any) {
      logger.error('bookMeeting failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });
}
