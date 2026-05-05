/**
 * auth.ts — shared Express authentication middleware.
 *
 * Extracted from routes.ts so all route modules can import the same
 * requireAuth / requireAdmin / requireWebhookSecret functions without
 * receiving them as parameters or re-defining them.
 */

import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { isCompanyTrialExpired, getCompanyTrialStatus } from '../lib/trial';
import { requireCompanyId, getCompanyId } from './requireCompanyId';
import { pool } from '../db';

export { requireCompanyId, getCompanyId };

// Paths that stay accessible even when the trial has expired so users can
// still see their expired state, sign out, and view trial info.
const TRIAL_EXEMPT_PATHS = new Set<string>([
  '/api/logout',
  '/api/me',
  '/api/me/trial',
  '/api/config/trial-days',
]);

async function trialGate(req: Request, res: Response): Promise<boolean> {
  if (TRIAL_EXEMPT_PATHS.has(req.path)) return true;
  // Read companyId from session only as a lookup key — the expiry decision
  // is always recomputed from the DB (companies.created_at + config.trial_days),
  // so a tampered session value cannot extend the trial.
  const companyId = req.session.companyId;
  if (!companyId) return true;
  try {
    const status = await getCompanyTrialStatus(companyId);
    if (status.expired) {
      res.status(402).json({
        message: 'Your free trial has expired. Please contact support to continue.',
        trialExpired: true,
        trialDays: status.trialDays,
        expiresAt: status.expiresAt,
      });
      return false;
    }
    return true;
  } catch {
    // On unexpected DB failure we fail closed for safety.
    res.status(503).json({ message: 'Unable to verify account status.' });
    return false;
  }
}

/** Reject requests from unauthenticated sessions or sessions missing company_id. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.authenticated) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  // Coerce companyId once; defends against connect-pg-simple deserialising
  // integers as strings. Drizzle's sql template only safely binds numbers.
  const cid = Number(req.session.companyId);
  if (!Number.isInteger(cid) || cid <= 0) {
    res.status(401).json({ message: 'Session missing company context — please log in again' });
    return;
  }
  req.companyId = cid;
  // Use cached is_active from session to avoid a DB hit on every request.
  // Fall back to DB for sessions created before this field was stored.
  let isActive = req.session.isActive;
  if (isActive === undefined) {
    const agent = await pool.query(
      'SELECT is_active FROM agents WHERE id = $1',
      [req.session.agentId]
    );
    isActive = agent.rows[0]?.is_active;
  }
  if (!isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ message: 'Account deactivated' });
    return;
  }
  if (!(await trialGate(req, res))) return;
  next();
}

/** Reject requests from non-admin sessions. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.authenticated) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  if (req.session.role !== 'admin') {
    res.status(403).json({ message: 'Admin access required' });
    return;
  }
  const cid = Number(req.session.companyId);
  if (Number.isInteger(cid) && cid > 0) {
    req.companyId = cid;
  }
  if (!(await trialGate(req, res))) return;
  next();
}

export { isCompanyTrialExpired };
