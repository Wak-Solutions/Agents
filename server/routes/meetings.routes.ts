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
import { notifyManagerNewBooking, sendBookingConfirmationToCustomer } from '../email';
import { sendSurveyToCustomer } from '../surveys';
import { createDailyRoom } from '../integrations/daily';
import { KSA_OFFSET_MS, formatKsaDate, formatKsaDateTime } from '../lib/timezone';
import { getSlotsForDay, isWithinWorkHours } from '../lib/slots';
import { getWorkHours } from './settings.routes';
import { createLogger, maskPhone } from '../lib/logger';

const logger = createLogger('meetings');

export async function ensureBlockedSlotsCompanyId(): Promise<void> {
  // Multi-tenant isolation: blocked_slots must be scoped to company_id.
  // Safe to run on every startup (IF NOT EXISTS / UPDATE WHERE NULL).
  await pool.query(
    `ALTER TABLE blocked_slots ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE`
  ).catch(() => {});
  await pool.query(
    `UPDATE blocked_slots SET company_id = 1 WHERE company_id IS NULL`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE blocked_slots ALTER COLUMN company_id SET NOT NULL`
  ).catch(() => {});
  // Replace old per-slot unique constraint with per-company-slot constraint
  await pool.query(
    `ALTER TABLE blocked_slots DROP CONSTRAINT IF EXISTS blocked_slots_date_time_key`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE blocked_slots ADD CONSTRAINT blocked_slots_company_date_time_key UNIQUE (company_id, date, time)`
  ).catch(() => {});
}

export function registerMeetingRoutes(app: Express): void {

  // ── Internal: create booking token (called by Python bot) ────────────────
  app.post('/api/meetings/create-token', requireWebhookSecret, async (req: any, res: any) => {
    try {
      const { customer_phone } = req.body;
      if (!customer_phone) {
        return res.status(400).json({ message: 'customer_phone is required' });
      }
      const companyId = parseInt(req.body.company_id);
      if (!companyId) return res.status(400).json({ message: 'company_id is required' });
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
      // Multi-tenant isolation: always filter by company_id
      const companyId = req.session.companyId;
      const weekStart = (req.query.weekStart as string) || new Date().toISOString().slice(0, 10);
      const result = await pool.query(
        `SELECT date::text, time FROM blocked_slots
         WHERE company_id = $1
           AND date >= $2::date AND date < $2::date + INTERVAL '7 days'
         ORDER BY date, time`,
        [companyId, weekStart]
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
      // Multi-tenant isolation: scope all blocked_slots reads/writes to company_id
      const companyId = req.session.companyId;
      const { date, time } = z.object({ date: z.string(), time: z.string() }).parse(req.body);
      const existing = await pool.query(
        'SELECT id FROM blocked_slots WHERE company_id=$1 AND date=$2::date AND time=$3',
        [companyId, date, time]
      );
      if (existing.rows.length > 0) {
        await pool.query(
          'DELETE FROM blocked_slots WHERE company_id=$1 AND date=$2::date AND time=$3',
          [companyId, date, time]
        );
        logger.info('Slot unblocked', `companyId: ${companyId}, date: ${date}, time: ${time}`);
        res.json({ blocked: false });
      } else {
        await pool.query(
          'INSERT INTO blocked_slots (company_id, date, time) VALUES ($1, $2::date, $3) ON CONFLICT (company_id, date, time) DO NOTHING',
          [companyId, date, time]
        );
        logger.info('Slot blocked', `companyId: ${companyId}, date: ${date}, time: ${time}`);
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
        // Multi-tenant isolation: scope blocked_slots to this meeting's company
        pool.query(
          `SELECT date::text, time FROM blocked_slots
           WHERE company_id = $1
             AND date >= $2::date AND date < $2::date + INTERVAL '32 days'`,
          [companyId, blockedWindowStart]
        ),
        pool.query(
          `SELECT scheduled_at FROM meetings
           WHERE scheduled_at >= $1 AND scheduled_at < $2
             AND status != 'completed' AND id != $3
             AND company_id = $4`,
          [windowStart, windowEnd, meeting.id, companyId]
        ),
      ]);

      const workHours = await getWorkHours(companyId);
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
        // Use company work hours to generate slots for this day
        const daySlots = getSlotsForDay(d.getUTCDay(), workHours);
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
      const { date, time, customerEmail } = z.object({
        date: z.string(),
        time: z.string(),
        customerEmail: z.string().email().optional().or(z.literal("")),
      }).parse(req.body);

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

      // Validate requested slot is within company work hours
      const workHours = await getWorkHours(companyId);
      if (!isWithinWorkHours(date, time, workHours)) {
        return res.status(400).json({ message: 'This time slot is outside working hours. Please choose another.' });
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
        // Multi-tenant isolation: check only this company's blocked slots
        pool.query(
          'SELECT 1 FROM blocked_slots WHERE company_id=$1 AND date=$2::date AND time=$3',
          [companyId, new Date(Date.UTC(yr, mo - 1, dy) - KSA_OFFSET_MS).toISOString().slice(0, 10), time]
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
        'wak-agent.up.railway.app'
      ).replace(/\/$/, '');
      const baseUrl = rawBase.startsWith('http') ? rawBase : `https://${rawBase}`;
      const brandedLink = `${baseUrl}/meeting/${meeting.meeting_token}`;

      await pool.query(
        `UPDATE meetings SET meeting_link=$1, scheduled_at=$2, link_sent=FALSE, customer_email=$3 WHERE id=$4 AND company_id=$5`,
        [meetingLink, scheduledUtc, customerEmail || null, meeting.id, companyId]
      );

      const ksaDt = new Date(scheduledUtc.getTime() + KSA_OFFSET_MS);
      const ksaLabel = formatKsaDateTime(ksaDt);

      logger.info(
        'Meeting booked',
        `phone: ${maskPhone(meeting.customer_phone)}, time: ${ksaLabel}`
      );

      // Email all active admins for this company (non-blocking)
      notifyManagerNewBooking({
        companyId,
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
      logger.info('Push subscriptions at booking', `count: ${require('../push').pushSubscriptions.size}, agent_id: ${meeting.agent_id ?? 'unassigned'}`);
      if (meeting.agent_id) {
        notifyAgent(meeting.agent_id, meetingPush).catch(
          (e: any) => logger.error('Push failed', e.message)
        );
      } else {
        notifyAll(meetingPush).catch(
          (e: any) => logger.error('Push failed', e.message)
        );
      }

      // Customer booking confirmation email via Resend (non-blocking)
      if (customerEmail) {
        sendBookingConfirmationToCustomer({
          to: customerEmail,
          customerName: meeting.customer_phone,
          meetingTimeLabel: `${ksaLabel} KSA time`,
          meetingLink: brandedLink,
        }).catch((e: any) => logger.error('Customer confirmation email failed', e.message));
      }

      res.json({ success: true, ksa_label: ksaLabel });
    } catch (err: any) {
      logger.error('bookMeeting failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public demo: get available booking slots (company_id = 1) ────────────
  app.get('/api/book-demo', async (req: any, res: any) => {
    try {
      const companyId = 1;

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
        // Multi-tenant isolation: scope blocked_slots to company 1 (demo endpoint)
        pool.query(
          `SELECT date::text, time FROM blocked_slots
           WHERE company_id = $1
             AND date >= $2::date AND date < $2::date + INTERVAL '32 days'`,
          [companyId, blockedWindowStart]
        ),
        pool.query(
          `SELECT scheduled_at FROM meetings
           WHERE scheduled_at >= $1 AND scheduled_at < $2
             AND status != 'completed'
             AND company_id = $3`,
          [windowStart, windowEnd, companyId]
        ),
      ]);

      const workHoursDemoGet = await getWorkHours(companyId);
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
        // Use company work hours for slot generation
        const daySlots = getSlotsForDay(d.getUTCDay(), workHoursDemoGet);
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
      logger.error('getDemoSlots failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public demo: confirm a booking (company_id = 1) ──────────────────────
  app.post('/api/book-demo', async (req: any, res: any) => {
    try {
      const companyId = 1;
      const { date, time, customerName, customerPhone, customerEmail } = z.object({
        date: z.string(),
        time: z.string(),
        customerName: z.string().min(1),
        customerPhone: z.string().min(1),
        customerEmail: z.string().email().optional().or(z.literal("")),
      }).parse(req.body);

      // Validate requested slot is within company work hours
      const workHoursDemo = await getWorkHours(companyId);
      if (!isWithinWorkHours(date, time, workHoursDemo)) {
        return res.status(400).json({ message: 'This time slot is outside working hours. Please choose another.' });
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
             AND status != 'completed'
             AND company_id = $3`,
          [scheduledUtc, new Date(scheduledUtc.getTime() + 3600000), companyId]
        ),
        // Multi-tenant isolation: check only this company's blocked slots
        pool.query(
          'SELECT 1 FROM blocked_slots WHERE company_id=$1 AND date=$2::date AND time=$3',
          [companyId, new Date(Date.UTC(yr, mo - 1, dy) - KSA_OFFSET_MS).toISOString().slice(0, 10), time]
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
      const demoToken = crypto.randomUUID();

      const ksaDt = new Date(scheduledUtc.getTime() + KSA_OFFSET_MS);
      const ksaLabel = formatKsaDateTime(ksaDt);

      // Insert meeting row
      await pool.query(
        `INSERT INTO meetings
           (customer_phone, meeting_link, meeting_token, scheduled_at, status, created_at, company_id, customer_email)
         VALUES ($1, $2, $3, $4, 'pending', NOW(), $5, $6)`,
        [customerPhone, meetingLink, demoToken, scheduledUtc, companyId, customerEmail || null]
      );

      logger.info('Demo booked', `phone: ${maskPhone(customerPhone)}, time: ${ksaLabel}`);

      // Send WhatsApp confirmation (non-blocking)
      const credsRes = await pool.query(
        `SELECT whatsapp_phone_number_id, whatsapp_token FROM companies WHERE id = $1`,
        [companyId]
      );
      if (credsRes.rows.length > 0) {
        const { whatsapp_phone_number_id: phoneNumberId, whatsapp_token: waToken } = credsRes.rows[0];
        if (phoneNumberId && waToken) {
          const confirmMsg = `Hi ${customerName}! Your demo with WAK Solutions is confirmed for ${ksaLabel} KSA time. We'll send you the meeting link 15 minutes before.`;
          fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${waToken}`,
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: customerPhone.replace(/^\+/, ''),
              type: 'text',
              text: { body: confirmMsg },
            }),
          }).catch((e: any) => logger.error('Demo WhatsApp confirmation failed', e.message));
        }
      }

      // Email all active admins for this company (non-blocking)
      notifyManagerNewBooking({
        companyId,
        customerPhone,
        dateTimeLabel: ksaLabel,
        meetingLink,
        scheduledUtc,
      }).catch((e: any) => logger.error('Demo manager email failed', e.message));

      // Push notification (non-blocking)
      logger.info('Push subscriptions at demo booking', `count: ${require('../push').pushSubscriptions.size}`);
      notifyAll({
        title: 'Demo booked',
        body: `${customerName} (${maskPhone(customerPhone)}) — ${ksaLabel}`,
        url: '/meetings',
      }).catch((e: any) => logger.error('Demo push failed', e.message));

      // Customer booking confirmation email via Resend (non-blocking)
      if (customerEmail) {
        sendBookingConfirmationToCustomer({
          to: customerEmail,
          customerName,
          meetingTimeLabel: `${ksaLabel} KSA time`,
          meetingLink,
        }).catch((e: any) => logger.error('Customer confirmation email failed', e.message));
      }

      res.json({ success: true, ksa_label: ksaLabel });
    } catch (err: any) {
      logger.error('bookDemo failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });
}
