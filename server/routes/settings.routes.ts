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

import bcrypt from 'bcrypt';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
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

export interface CompanyBranding {
  appUrl: string;
  brandName: string;
}

/** Fetch app_url and brand_name for a company. Throws if either is missing. */
export async function getCompanyBranding(companyId: number): Promise<CompanyBranding> {
  const res = await pool.query(
    `SELECT app_url, brand_name FROM companies WHERE id = $1`,
    [companyId]
  );
  const row = res.rows[0];
  if (!row?.app_url) throw new Error(`companies.app_url is not set for companyId=${companyId}`);
  if (!row?.brand_name) throw new Error(`companies.brand_name is not set for companyId=${companyId}`);
  return { appUrl: row.app_url, brandName: row.brand_name };
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
      const companyId: number = req.companyId;
      const wh = await getWorkHours(companyId);
      logger.info('getWorkHours', `companyId: ${companyId}`);
      res.json(wh);
    } catch (err: any) {
      logger.error('getWorkHours failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // PUT /api/settings/work-hours
  app.put('/api/settings/work-hours', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
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
      if (timezone.length > 64) {
        return res.status(400).json({ message: 'timezone value is too long' });
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
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // GET /api/settings/whatsapp — return WhatsApp credentials for the company (admin only)
  //
  // SECURITY NOTE (FINAL-034): Tokens are masked before being returned so that
  // the full secret is never transmitted over the wire or captured in browser
  // DevTools / HAR exports. accessToken shows the last 4 chars (****abcd) so
  // admins can identify which token is active without exposing it. appSecret is
  // fully masked (*****) because its last 4 chars would leak ~16 bits of a 32-char
  // hex secret. Masked values round-trip safely: the PUT handler detects any value
  // containing '*' and skips updating that field, preserving the stored credential.
  // This is the intended, documented behaviour — not a gap.
  app.get('/api/settings/whatsapp', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
      const result = await pool.query(
        `SELECT whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_token, whatsapp_app_secret
         FROM companies WHERE id = $1`,
        [companyId]
      );
      const row = result.rows[0] ?? {};
      logger.info('getWhatsAppSettings', `companyId: ${companyId}`);
      const maskToken = (s: string) => s ? s.replace(/.(?=.{4})/g, '*') : '';
      const maskFull  = (s: string) => s ? '*'.repeat(s.length) : '';
      res.json({
        phoneNumberId: row.whatsapp_phone_number_id ?? '',
        wabaId:        row.whatsapp_waba_id         ?? '',
        accessToken:   maskToken(row.whatsapp_token     ?? ''),
        appSecret:     maskFull(row.whatsapp_app_secret ?? ''),
      });
    } catch (err: any) {
      logger.error('getWhatsAppSettings failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // PUT /api/settings/whatsapp — save WhatsApp credentials for the company (admin only)
  app.put('/api/settings/whatsapp', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
      const { phoneNumberId, wabaId, accessToken, appSecret } = req.body;

      if (!phoneNumberId || !wabaId || !accessToken) {
        return res.status(400).json({ message: 'phoneNumberId, wabaId, and accessToken are required' });
      }
      if (String(phoneNumberId).length > 64) {
        return res.status(400).json({ message: 'phoneNumberId is too long' });
      }
      if (String(wabaId).length > 64) {
        return res.status(400).json({ message: 'wabaId is too long' });
      }
      if (String(accessToken).length > 512) {
        return res.status(400).json({ message: 'accessToken is too long' });
      }
      if (appSecret && String(appSecret).length > 128) {
        return res.status(400).json({ message: 'appSecret is too long' });
      }

      // A value that contains '*' came from the masked GET response — treat as "unchanged".
      const isMasked = (v: string) => v.includes('*');

      const setClauses: string[] = [
        'whatsapp_phone_number_id = $1',
        'whatsapp_waba_id = $2',
      ];
      const params: any[] = [String(phoneNumberId).trim(), String(wabaId).trim()];
      let idx = 3;

      const tokenStr = String(accessToken).trim();
      if (!isMasked(tokenStr)) {
        setClauses.push(`whatsapp_token = $${idx++}`);
        params.push(tokenStr);
      }

      if (appSecret !== undefined && appSecret !== null && appSecret !== '') {
        const secretStr = String(appSecret).trim();
        if (!isMasked(secretStr)) {
          setClauses.push(`whatsapp_app_secret = $${idx++}`);
          params.push(secretStr);
        }
      }

      params.push(companyId);
      await pool.query(
        `UPDATE companies SET ${setClauses.join(', ')} WHERE id = $${idx}`,
        params
      );

      logger.info('setWhatsAppSettings', `companyId: ${companyId}, phoneNumberId: ${phoneNumberId}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('setWhatsAppSettings failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // GET /api/settings/branding — return brand_name (admin only)
  app.get('/api/settings/branding', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
      const result = await pool.query(
        `SELECT brand_name FROM companies WHERE id = $1`,
        [companyId]
      );
      const row = result.rows[0] ?? {};
      res.json({ brandName: row.brand_name ?? '' });
    } catch (err: any) {
      logger.error('getBranding failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // PUT /api/settings/branding — save brand_name (admin only)
  app.put('/api/settings/branding', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
      const brandName = typeof req.body?.brandName === 'string' ? req.body.brandName.trim() : '';

      if (!brandName) return res.status(400).json({ message: 'brandName is required' });

      await pool.query(
        `UPDATE companies SET brand_name = $1 WHERE id = $2`,
        [brandName, companyId]
      );
      logger.info('setBranding', `companyId: ${companyId}, brandName: ${brandName}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('setBranding failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // POST /api/settings/change-password — rate-limited to slow down brute-force
  // attempts against the current password by an attacker who has hijacked
  // an authenticated session.
  const changePasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => `cp:${req.session?.agentId ?? ipKeyGenerator(req) ?? req.ip ?? 'unknown'}`,
    message: { message: 'Too many password change attempts. Please try again later.' },
  });

  app.post('/api/settings/change-password', changePasswordLimiter, requireAuth, async (req: any, res: any) => {
    try {
      const agentId: number = req.session.agentId;
      const { currentPassword, newPassword } = req.body ?? {};
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        return res.status(400).json({ message: 'currentPassword and newPassword are required' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters' });
      }
      if (newPassword.length > 128) {
        return res.status(400).json({ message: 'New password must be at most 128 characters' });
      }
      if (newPassword === currentPassword) {
        return res.status(400).json({ message: 'New password must be different from the current password' });
      }

      const r = await pool.query(`SELECT password_hash FROM agents WHERE id = $1`, [agentId]);
      if (r.rows.length === 0) {
        return res.status(404).json({ message: 'Account not found' });
      }
      const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
      if (!ok) {
        logger.warn('changePassword — current password mismatch', `agentId: ${agentId}`);
        return res.status(401).json({ message: 'Current password is incorrect' });
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      await pool.query(`UPDATE agents SET password_hash = $1 WHERE id = $2`, [newHash, agentId]);
      logger.info('changePassword success', `agentId: ${agentId}`);
      // Never return a password or hash in the response.
      res.json({ success: true });
    } catch (err: any) {
      logger.error('changePassword failed', err.message);
      res.status(500).json({ message: 'Failed to change password' });
    }
  });
}
