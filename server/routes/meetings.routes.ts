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
import { resolveCompanyFromSecret } from '../helpers/resolveCompanyFromSecret';
import { notifyAgent, notifyAll } from '../push';
import { notifyManagerNewBooking, sendEmail } from '../email';
import { sendSurveyToCustomer } from '../surveys';
import { createDailyRoom } from '../integrations/daily';
import { getCompanyBranding } from './settings.routes';
import { sendWhatsAppText } from '../lib/whatsapp';
import { KSA_OFFSET_MS, formatKsaDate, formatKsaDateTime } from '../lib/timezone';
import { getSlotsForDay, isWithinWorkHours } from '../lib/slots';
import { getWorkHours } from './settings.routes';
import { createLogger, maskPhone } from '../lib/logger';

const logger = createLogger('meetings');

export async function ensureDemoBookingsTable(): Promise<void> {
  // Global lead funnel: demo bookings live in their own table, never joined
  // into per-tenant queries. Intentionally has NO company_id column —
  // all rows belong to WAK Solutions (the platform owner).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_bookings (
      id              SERIAL PRIMARY KEY,
      agent_id        INTEGER REFERENCES agents(id),
      customer_name   TEXT NOT NULL,
      customer_email  TEXT NOT NULL,
      customer_phone  TEXT,
      meeting_token   UUID NOT NULL DEFAULT gen_random_uuid(),
      meeting_link    TEXT,
      scheduled_at    TIMESTAMP WITH TIME ZONE,
      status          TEXT NOT NULL DEFAULT 'pending',
      created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    )
  `);
  // Cleanup: prior broken code wrote demo bookings into meetings with
  // agent.name stored in customer_phone. Real customer_phone values start
  // with '+' or a digit; agent names do not.
  await pool.query(
    `DELETE FROM meetings
     WHERE company_id = 1
       AND customer_phone !~ '^[+0-9]'`
  ).catch(() => {});
}

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
  app.post('/api/meetings/create-token', async (req: any, res: any) => {
    try {
      const company = await resolveCompanyFromSecret(req.headers['x-webhook-secret'] as string);
      if (!company) return res.status(401).json({ message: 'Unauthorized' });
      const companyId = company.id;

      const { customer_phone } = req.body;
      if (!customer_phone) {
        return res.status(400).json({ message: 'customer_phone is required' });
      }
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
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // ── List meetings (dashboard) ─────────────────────────────────────────────
  app.get('/api/meetings', requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.companyId;
      const filter = (req.query.filter as string) || 'all';
      let statusFilter = '';
      if (filter === 'upcoming') statusFilter = " AND status IN ('pending', 'in_progress')";
      else if (filter === 'completed') statusFilter = " AND status = 'completed'";
      const result = await pool.query(
        `SELECT m.id::integer, m.company_id::integer, m.agent_id::integer,
                a.name AS agent_name,
                m.customer_phone::text, NULL::text AS customer_name,
                m.customer_email::text, m.meeting_link::text,
                m.meeting_token::text,
                m.agreed_time::text, m.scheduled_at, m.status::text,
                m.created_at, 'meeting'::text AS source
         FROM meetings m
         LEFT JOIN agents a ON a.id = m.agent_id
         WHERE m.company_id = $1${statusFilter}
         UNION ALL
         SELECT d.id::integer, 1::integer AS company_id, d.agent_id::integer,
                a.name AS agent_name,
                NULL::text AS customer_phone, d.customer_name::text,
                d.customer_email::text, d.meeting_link::text,
                d.meeting_token::text,
                NULL::text AS agreed_time, d.scheduled_at, d.status::text,
                d.created_at, 'demo'::text AS source
         FROM demo_bookings d
         LEFT JOIN agents a ON a.id = d.agent_id
         WHERE $1 = 1${statusFilter}
         ORDER BY scheduled_at DESC NULLS LAST`,
        [companyId]
      );
      res.json(result.rows);
    } catch (err: any) {
      logger.error('listMeetings failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // ── Start a meeting ───────────────────────────────────────────────────────
  app.patch('/api/meetings/:id/start', requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.companyId;
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
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // ── Complete a meeting ────────────────────────────────────────────────────
  app.patch('/api/meetings/:id/complete', requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.companyId;
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
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // ── Availability: get blocked slots ───────────────────────────────────────
  app.get('/api/availability', requireAuth, async (req: any, res: any) => {
    try {
      // Multi-tenant isolation: always filter by company_id
      const companyId = req.companyId;
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
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // ── Availability: toggle a blocked slot ───────────────────────────────────
  app.post('/api/availability/toggle', requireAuth, async (req: any, res: any) => {
    try {
      // Multi-tenant isolation: scope all blocked_slots reads/writes to company_id
      const companyId = req.companyId;
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
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // ── Availability: get booked slots for a week ─────────────────────────────
  app.get('/api/availability/booked', requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.companyId;
      const weekStart = (req.query.weekStart as string) || new Date().toISOString().slice(0, 10);
      const [yr, mo, dy] = weekStart.split('-').map(Number);
      const weekStartUtc = new Date(Date.UTC(yr, mo - 1, dy + 1, 0, 0, 0) - KSA_OFFSET_MS);
      const weekEndUtc = new Date(weekStartUtc.getTime() + 7 * 24 * 60 * 60 * 1000);
      const result = await pool.query(
        `SELECT scheduled_at FROM meetings
         WHERE scheduled_at >= $1 AND scheduled_at < $2
           AND scheduled_at IS NOT NULL
           AND status != 'completed'
           AND company_id = $3
         UNION ALL
         SELECT scheduled_at FROM demo_bookings
         WHERE $3 = 1
           AND scheduled_at >= $1 AND scheduled_at < $2
           AND scheduled_at IS NOT NULL
           AND status != 'completed'`,
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
      res.status(500).json({ message: 'Internal error' });
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
      const isExpired =
        m.status === 'completed' ||
        (m.scheduled_at && new Date(m.scheduled_at).getTime() + 2 * 60 * 60 * 1000 < Date.now());
      res.json({
        meeting_id: m.id,
        meeting_link: isExpired ? null : (m.meeting_link || null),
        scheduled_time: scheduledTime,
        status: m.status,
      });
    } catch (err: any) {
      logger.error('getMeeting failed', err.message);
      res.status(500).json({ message: 'Internal error' });
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
             AND company_id = $4
           UNION ALL
           SELECT scheduled_at FROM demo_bookings
           WHERE $4 = 1
             AND scheduled_at >= $1 AND scheduled_at < $2
             AND status != 'completed'`,
          [windowStart, windowEnd, meeting.id, companyId]
        ),
      ]);

      const workHours = await getWorkHours(companyId);
      const blockedSet = new Set(blockedRes.rows.map((r: any) => `${r.date}T${r.time}`));
      const takenMs = new Set(takenRes.rows.map((r: any) => new Date(r.scheduled_at).getTime()));

      const days: { date: string; label: string; slots: string[]; bookedSlots: string[] }[] = [];

      for (let i = 0; i <= 30; i++) {
        const d = new Date(ksaNow);
        d.setUTCDate(d.getUTCDate() + i);
        const ksaDate = d.toISOString().slice(0, 10);
        const [yr, mo, dy] = ksaDate.split('-').map(Number);
        const blockedDate = new Date(
          Date.UTC(yr, mo - 1, dy) - KSA_OFFSET_MS
        ).toISOString().slice(0, 10);

        const availableSlots: string[] = [];
        const bookedSlots: string[] = [];
        // Use company work hours to generate slots for this day
        const daySlots = getSlotsForDay(d.getUTCDay(), workHours);
        for (const slot of daySlots) {
          if (blockedSet.has(`${blockedDate}T${slot}`)) continue;
          const h = slot === '00:00' ? 24 : parseInt(slot.split(':')[0]);
          const slotUtc = new Date(Date.UTC(yr, mo - 1, dy, h - 3, 0, 0, 0));
          if (slotUtc <= now) continue;
          if (takenMs.has(slotUtc.getTime())) {
            bookedSlots.push(slot);
          } else {
            availableSlots.push(slot);
          }
        }

        if (availableSlots.length > 0 || bookedSlots.length > 0) {
          days.push({ date: ksaDate, label: formatKsaDate(d), slots: availableSlots, bookedSlots });
        }
      }

      res.json({ valid: true, days });
    } catch (err: any) {
      logger.error('getBookingSlots failed', err.message);
      res.status(500).json({ message: 'Internal error' });
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
      let appUrl: string, brandName: string;
      try {
        ({ appUrl, brandName } = await getCompanyBranding(companyId));
      } catch {
        logger.error('bookMeeting failed — app_url not set', `companyId: ${companyId}`);
        return res.status(400).json({
          message: 'Booking is not configured. Please set your App URL in Settings → Branding before accepting bookings.',
        });
      }
      const brandedLink = `${appUrl}/meeting/${meeting.meeting_token}`;

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

      // WhatsApp booking confirmation to customer (non-blocking)
      sendWhatsAppText(
        companyId,
        meeting.customer_phone,
        `Your meeting with ${brandName} is confirmed for ${ksaLabel} (KSA time).\n\nYou will receive your meeting link 15 minutes before the start time.`
      ).catch((e: any) => logger.error('Booking WhatsApp failed', e.message));

      // Push notification
      const meetingPush = {
        title: 'Meeting Booked',
        body: `${maskPhone(meeting.customer_phone)} — ${ksaLabel}`,
        url: '/meetings',
      };
      logger.info('Sending meeting booked push', `agent_id: ${meeting.agent_id ?? 'unassigned'}`);
      if (meeting.agent_id) {
        notifyAgent(meeting.agent_id, meetingPush).catch(
          (e: any) => logger.error('Push failed', e.message)
        );
      } else {
        notifyAll(meetingPush, companyId).catch(
          (e: any) => logger.error('Push failed', e.message)
        );
      }

      // Customer booking confirmation email
      if (customerEmail) {
        const _pad = (n: number) => String(n).padStart(2, '0');
        const _fmt = (d: Date) => `${d.getUTCFullYear()}${_pad(d.getUTCMonth()+1)}${_pad(d.getUTCDate())}T${_pad(d.getUTCHours())}${_pad(d.getUTCMinutes())}00Z`;
        const _calEnd = new Date(scheduledUtc.getTime() + 3600000);
        const customerCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Meeting with ${brandName}`)}&dates=${_fmt(scheduledUtc)}/${_fmt(_calEnd)}&details=${encodeURIComponent('Join your meeting: ' + brandedLink)}&sf=true&output=xml`;
        const _year = new Date().getFullYear();
        const customerConfirmHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#0F510F;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${brandName}</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">Meeting Confirmation</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 24px;color:#222;font-size:15px;line-height:1.6;">Your meeting with ${brandName} is confirmed. We look forward to connecting with you — please save the details below so you have everything you need on the day.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f0;border:1px solid #c8e6c9;border-radius:10px;margin-bottom:28px;">
            <tr><td style="padding:22px 26px;">
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Date &amp; Time (AST — UTC+3)</p>
              <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#0F510F;">${ksaLabel}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Meeting Link</p>
              <a href="${brandedLink}" style="font-size:14px;color:#0F510F;font-weight:600;word-break:break-all;">${brandedLink}</a><br />
              <a href="${brandedLink}" style="display:inline-block;margin-top:12px;background:#0F510F;color:#fff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:600;">Join Meeting</a>
            </td></tr>
          </table>
          <a href="${customerCalUrl}" target="_blank" style="display:inline-block;background:#4285F4;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600;margin-bottom:28px;">&#128197; Add to Google Calendar</a>
          <p style="margin:0 0 10px;color:#444;font-size:14px;font-weight:700;">Before your meeting</p>
          <ul style="margin:0 0 24px;padding-left:20px;color:#555;font-size:13px;line-height:1.9;">
            <li>Use the link above to join — no software installation required, it opens in your browser.</li>
            <li>Find a quiet spot with a stable internet connection a few minutes before the scheduled time.</li>
            <li>You will receive a WhatsApp reminder 15 minutes before the meeting starts.</li>
          </ul>
          <p style="margin:0;color:#555;font-size:13px;line-height:1.6;">Need to reschedule or have a question? Simply reply to us on WhatsApp and we will be happy to help.</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;border-top:1px solid #eee;padding:16px 32px;">
          <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">&copy; ${_year} ${brandName}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
        sendEmail(
          customerEmail,
          `Your meeting with ${brandName} is confirmed`,
          customerConfirmHtml,
        ).catch((e: any) => logger.error('Customer confirmation email failed', e.message));
      }

      res.json({ success: true, ksa_label: ksaLabel });
    } catch (err: any) {
      logger.error('bookMeeting failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // ── Authenticated demo booking: fetch agent's active booking ─────────────
  app.get('/api/demo-booking/my-booking', requireAuth, async (req: any, res: any) => {
    try {
      const agentId = req.session.agentId;
      const result = await pool.query(
        `SELECT id, meeting_link, scheduled_at, status
         FROM demo_bookings
         WHERE agent_id = $1
           AND status IN ('pending', 'in_progress')
         ORDER BY created_at DESC
         LIMIT 1`,
        [agentId]
      );
      if (result.rows.length === 0) return res.json({ booking: null });
      const m = result.rows[0];
      const ksaDt = new Date(new Date(m.scheduled_at).getTime() + KSA_OFFSET_MS);
      res.json({
        booking: {
          id: m.id,
          meeting_link: m.meeting_link,
          status: m.status,
          ksa_label: formatKsaDateTime(ksaDt),
        },
      });
    } catch (err: any) {
      logger.error('getMyDemoBooking failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // ── Authenticated demo booking: get available slots ───────────────────────
  // company_id 1 = WAK Solutions (platform owner — intentional). The demo
  // funnel reads WAK's blocked_slots and work hours, but books into the
  // global demo_bookings table (no company_id column).
  app.get('/api/demo-booking/slots', requireAuth, async (req: any, res: any) => {
    try {
      const wakCompanyId = 1;

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
           WHERE company_id = $1
             AND date >= $2::date AND date < $2::date + INTERVAL '32 days'`,
          [wakCompanyId, blockedWindowStart]
        ),
        pool.query(
          `SELECT scheduled_at FROM demo_bookings
           WHERE scheduled_at >= $1 AND scheduled_at < $2
             AND status != 'completed'`,
          [windowStart, windowEnd]
        ),
      ]);

      const workHours = await getWorkHours(wakCompanyId);
      const blockedSet = new Set(blockedRes.rows.map((r: any) => `${r.date}T${r.time}`));
      const takenMs = new Set(takenRes.rows.map((r: any) => new Date(r.scheduled_at).getTime()));

      const days: { date: string; label: string; slots: string[]; bookedSlots: string[] }[] = [];

      for (let i = 0; i <= 30; i++) {
        const d = new Date(ksaNow);
        d.setUTCDate(d.getUTCDate() + i);
        const ksaDate = d.toISOString().slice(0, 10);
        const [yr, mo, dy] = ksaDate.split('-').map(Number);
        const blockedDate = new Date(
          Date.UTC(yr, mo - 1, dy) - KSA_OFFSET_MS
        ).toISOString().slice(0, 10);

        const availableSlots: string[] = [];
        const bookedSlots: string[] = [];
        const daySlots = getSlotsForDay(d.getUTCDay(), workHours);
        for (const slot of daySlots) {
          if (blockedSet.has(`${blockedDate}T${slot}`)) continue;
          const h = slot === '00:00' ? 24 : parseInt(slot.split(':')[0]);
          const slotUtc = new Date(Date.UTC(yr, mo - 1, dy, h - 3, 0, 0, 0));
          if (slotUtc <= now) continue;
          if (takenMs.has(slotUtc.getTime())) {
            bookedSlots.push(slot);
          } else {
            availableSlots.push(slot);
          }
        }

        if (availableSlots.length > 0 || bookedSlots.length > 0) {
          days.push({ date: ksaDate, label: formatKsaDate(d), slots: availableSlots, bookedSlots });
        }
      }

      res.json({ days });
    } catch (err: any) {
      logger.error('getDemoBookingSlots failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // ── Authenticated demo booking: confirm a slot ──────────────────────────
  // Writes to the global demo_bookings table (no company_id column).
  // company_id 1 = WAK Solutions (platform owner — intentional) is used only
  // for reading WAK's blocked_slots/work hours and routing notifications to
  // platform-owner staff.
  app.post('/api/demo-booking/book', requireAuth, async (req: any, res: any) => {
    try {
      const wakCompanyId = 1;
      const agentId = req.session.agentId;

      const { date, time } = z.object({
        date: z.string(),
        time: z.string(),
      }).parse(req.body);

      // Fetch agent name and email only (no phone column on agents table)
      const agentRes = await pool.query(
        `SELECT name, email FROM agents WHERE id = $1`,
        [agentId]
      );
      const agent = agentRes.rows[0] ?? {};

      const workHours = await getWorkHours(wakCompanyId);
      if (!isWithinWorkHours(date, time, workHours)) {
        return res.status(400).json({ message: 'This time slot is outside working hours. Please choose another.' });
      }

      const [yr, mo, dy] = date.split('-').map(Number);
      const h = time === '00:00' ? 24 : parseInt(time.split(':')[0]);
      const scheduledUtc = new Date(Date.UTC(yr, mo - 1, dy, h - 3, 0, 0, 0));

      const [takenRes, blockedRes] = await Promise.all([
        pool.query(
          `SELECT 1 FROM demo_bookings
           WHERE scheduled_at >= $1 AND scheduled_at < $2
             AND status != 'completed'`,
          [scheduledUtc, new Date(scheduledUtc.getTime() + 3600000)]
        ),
        pool.query(
          'SELECT 1 FROM blocked_slots WHERE company_id=$1 AND date=$2::date AND time=$3',
          [wakCompanyId, new Date(Date.UTC(yr, mo - 1, dy) - KSA_OFFSET_MS).toISOString().slice(0, 10), time]
        ),
      ]);

      if (takenRes.rows.length > 0) {
        return res.status(409).json({ message: 'This time slot was just taken. Please choose another.' });
      }
      if (blockedRes.rows.length > 0) {
        return res.status(409).json({ message: 'This slot is not available. Please choose another.' });
      }

      const room = await createDailyRoom();
      const meetingLink = room.url;
      const demoToken = crypto.randomUUID();

      const ksaDt = new Date(scheduledUtc.getTime() + KSA_OFFSET_MS);
      const ksaLabel = formatKsaDateTime(ksaDt);

      await pool.query(
        `INSERT INTO demo_bookings
           (agent_id, customer_name, customer_email, meeting_link, meeting_token, scheduled_at, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())`,
        [agentId || null, agent.name || 'demo', agent.email || '', meetingLink, demoToken, scheduledUtc]
      );

      logger.info('Authenticated demo booked', `agentId: ${agentId}, time: ${ksaLabel}`);

      notifyManagerNewBooking({
        companyId: wakCompanyId,
        customerPhone: agent.name || 'Demo booking',
        dateTimeLabel: ksaLabel,
        meetingLink,
        scheduledUtc,
      }).catch((e: any) => logger.error('Demo manager email failed', e.message));

      // Agent demo confirmation email — uses WAK Solutions branding (company 1)
      if (agent.email) {
        const { brandName: wakBrandName } = await getCompanyBranding(wakCompanyId);
        const _dPad = (n: number) => String(n).padStart(2, '0');
        const _dFmt = (d: Date) => `${d.getUTCFullYear()}${_dPad(d.getUTCMonth()+1)}${_dPad(d.getUTCDate())}T${_dPad(d.getUTCHours())}${_dPad(d.getUTCMinutes())}00Z`;
        const _dCalEnd = new Date(scheduledUtc.getTime() + 3600000);
        const demoCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${wakBrandName} Demo`)}&dates=${_dFmt(scheduledUtc)}/${_dFmt(_dCalEnd)}&details=${encodeURIComponent('Join your demo: ' + meetingLink)}&sf=true&output=xml`;
        const _dYear = new Date().getFullYear();
        const demoConfirmHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#0F510F;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${wakBrandName}</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">Demo Booking Confirmation</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 24px;color:#222;font-size:15px;line-height:1.6;">Hi ${agent.name || 'there'},</p>
          <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6;">Your demo session with ${wakBrandName} is confirmed. We're excited to walk you through the platform and show you how it can transform your customer engagement. Please save the details below.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f0;border:1px solid #c8e6c9;border-radius:10px;margin-bottom:28px;">
            <tr><td style="padding:22px 26px;">
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Date &amp; Time (AST — UTC+3)</p>
              <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#0F510F;">${ksaLabel}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Meeting Link</p>
              <a href="${meetingLink}" style="font-size:14px;color:#0F510F;font-weight:600;word-break:break-all;">${meetingLink}</a><br />
              <a href="${meetingLink}" style="display:inline-block;margin-top:12px;background:#0F510F;color:#fff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:600;">Join Demo</a>
            </td></tr>
          </table>
          <a href="${demoCalUrl}" target="_blank" style="display:inline-block;background:#4285F4;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600;margin-bottom:28px;">&#128197; Add to Google Calendar</a>
          <p style="margin:0 0 10px;color:#444;font-size:14px;font-weight:700;">What to expect</p>
          <ul style="margin:0 0 24px;padding-left:20px;color:#555;font-size:13px;line-height:1.9;">
            <li>A live walkthrough of the ${wakBrandName} platform tailored to your use case.</li>
            <li>Time to ask questions and explore how the platform fits your team's workflow.</li>
            <li>No software to install — the meeting runs entirely in your browser.</li>
          </ul>
          <p style="margin:0;color:#555;font-size:13px;line-height:1.6;">If you need to reschedule, please get in touch with us and we'll find a time that works for you.</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;border-top:1px solid #eee;padding:16px 32px;">
          <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">&copy; ${_dYear} ${wakBrandName}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
        sendEmail(
          agent.email,
          `Your demo with ${wakBrandName} is confirmed`,
          demoConfirmHtml,
        ).catch((e: any) => logger.error('Demo confirmation email failed', e.message));
      }

      // company_id 1 = WAK Solutions (platform owner — intentional)
      notifyAll({
        title: 'Meeting Booked',
        body: `${agent.name || 'Agent'} — ${ksaLabel}`,
        url: '/meetings',
      }, wakCompanyId).catch((e: any) => logger.error('Demo push failed', e.message));

      res.json({ success: true, ksa_label: ksaLabel, meeting_link: meetingLink });
    } catch (err: any) {
      logger.error('bookAuthDemo failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // ── Public: get demo booking details by token ────────────────────────────
  app.get('/api/demo-booking/:token', async (req: any, res: any) => {
    try {
      const result = await pool.query(
        `SELECT id, meeting_link, scheduled_at, status
         FROM demo_bookings WHERE meeting_token=$1 LIMIT 1`,
        [req.params.token]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Demo booking not found.' });
      const m = result.rows[0];
      const scheduledTime = m.scheduled_at
        ? new Date(new Date(m.scheduled_at).getTime() + KSA_OFFSET_MS).toISOString()
        : null;
      res.json({
        meeting_id: m.id,
        meeting_link: m.meeting_link || null,
        scheduled_time: scheduledTime,
        status: m.status,
      });
    } catch (err: any) {
      logger.error('getDemoBooking failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

}
