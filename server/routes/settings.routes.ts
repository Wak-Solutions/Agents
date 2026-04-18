/**
 * settings.routes.ts — Company-scoped settings.
 *
 * GET  /api/settings/work-hours   — return work hours for the authenticated company
 * PUT  /api/settings/work-hours   — update work hours for the authenticated company
 * GET  /api/settings/whatsapp     — return WhatsApp credentials for the authenticated company
 * PUT  /api/settings/whatsapp     — update WhatsApp credentials for the authenticated company
 *
 * work_hours column shape:
 *   { days: string[], start: string, end: string, timezone: string }
 * Default: Sun–Thu, 09:00–18:00, Asia/Riyadh
 */

import type { Express } from 'express';
import { pool } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { createLogger } from '../lib/logger';

const logger = createLogger('settings');

export interface WorkHours {
  days: string[];       // e.g. ["Sun","Mon","Tue","Wed","Thu"]
  start: string;        // "09:00"
  end: string;          // "18:00"
  timezone: string;     // IANA name e.g. "Asia/Riyadh"
}

export const DEFAULT_WORK_HOURS: WorkHours = {
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'],
  start: '09:00',
  end: '18:00',
  timezone: 'Asia/Riyadh',
};

const ALL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isValidTime(t: string): boolean {
  return /^\d{2}:\d{2}$/.test(t);
}

export async function getWorkHours(companyId: number): Promise<WorkHours> {
  try {
    const res = await pool.query(
      'SELECT work_hours FROM companies WHERE id = $1',
      [companyId]
    );
    const wh = res.rows[0]?.work_hours;
    if (wh && wh.days && wh.start && wh.end && wh.timezone) return wh as WorkHours;
  } catch (err: any) {
    logger.warn('getWorkHours — DB lookup failed, using default', `error: ${err.message}`);
  }
  return { ...DEFAULT_WORK_HOURS };
}

export async function ensureWorkHoursColumn(): Promise<void> {
  await pool.query(
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS work_hours JSONB`
  ).catch(() => {});
  logger.info('work_hours column ensured on companies table');
}

export function registerSettingsRoutes(app: Express): void {

  // GET /api/settings/work-hours
  app.get('/api/settings/work-hours', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const wh = await getWorkHours(companyId);
      logger.info('getWorkHours', `companyId: ${companyId}`);
      res.json(wh);
    } catch (err: any) {
      logger.error('getWorkHours failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // PUT /api/settings/work-hours
  app.put('/api/settings/work-hours', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const { days, start, end, timezone } = req.body;

      // Validate
      if (!Array.isArray(days) || days.some((d: any) => !ALL_DAYS.includes(d))) {
        return res.status(400).json({ message: 'Invalid days — must be subset of Sun Mon Tue Wed Thu Fri Sat' });
      }
      if (!isValidTime(start) || !isValidTime(end)) {
        return res.status(400).json({ message: 'start and end must be HH:MM' });
      }
      if (!timezone || typeof timezone !== 'string') {
        return res.status(400).json({ message: 'timezone is required' });
      }
      // Validate IANA timezone
      try { Intl.DateTimeFormat(undefined, { timeZone: timezone }); }
      catch { return res.status(400).json({ message: `Unknown timezone: ${timezone}` }); }

      const wh: WorkHours = { days, start, end, timezone };
      await pool.query(
        'UPDATE companies SET work_hours = $1 WHERE id = $2',
        [JSON.stringify(wh), companyId]
      );

      logger.info(
        'setWorkHours',
        `companyId: ${companyId}, days: ${days.join(',')}, ${start}–${end}, tz: ${timezone}`
      );
      res.json(wh);
    } catch (err: any) {
      logger.error('setWorkHours failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/settings/whatsapp — return WhatsApp credentials for the company (admin only)
  app.get('/api/settings/whatsapp', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const result = await pool.query(
        `SELECT whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_token
         FROM companies WHERE id = $1`,
        [companyId]
      );
      const row = result.rows[0] ?? {};
      logger.info('getWhatsAppSettings', `companyId: ${companyId}`);
      res.json({
        phoneNumberId: row.whatsapp_phone_number_id ?? '',
        wabaId:        row.whatsapp_waba_id         ?? '',
        accessToken:   row.whatsapp_token            ?? '',
      });
    } catch (err: any) {
      logger.error('getWhatsAppSettings failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // PUT /api/settings/whatsapp — save WhatsApp credentials for the company (admin only)
  app.put('/api/settings/whatsapp', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const { phoneNumberId, wabaId, accessToken } = req.body;

      if (!phoneNumberId || !wabaId || !accessToken) {
        return res.status(400).json({ message: 'phoneNumberId, wabaId, and accessToken are required' });
      }

      await pool.query(
        `UPDATE companies
         SET whatsapp_phone_number_id = $1,
             whatsapp_waba_id         = $2,
             whatsapp_token           = $3
         WHERE id = $4`,
        [String(phoneNumberId).trim(), String(wabaId).trim(), String(accessToken).trim(), companyId]
      );

      logger.info('setWhatsAppSettings', `companyId: ${companyId}, phoneNumberId: ${phoneNumberId}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('setWhatsAppSettings failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });
}
