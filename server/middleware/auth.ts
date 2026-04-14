/**
 * auth.ts — shared Express authentication middleware.
 *
 * Extracted from routes.ts so all route modules can import the same
 * requireAuth / requireAdmin / requireWebhookSecret functions without
 * receiving them as parameters or re-defining them.
 */

import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/** Reject requests from unauthenticated sessions or sessions missing company_id. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.authenticated) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  if (!req.session.companyId) {
    res.status(401).json({ message: 'Session missing company context — please log in again' });
    return;
  }
  next();
}

/** Reject requests from non-admin sessions. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.authenticated) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  if (req.session.role !== 'admin') {
    res.status(403).json({ message: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Reject requests that don't carry the correct x-webhook-secret header.
 * Used on routes called by the Python bot to prevent unauthorised writes.
 */
export function requireWebhookSecret(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-webhook-secret'];
  const expected = process.env.WEBHOOK_SECRET;
  if (
    typeof incoming !== 'string' ||
    !expected ||
    incoming.length !== expected.length ||
    !timingSafeEqual(Buffer.from(incoming), Buffer.from(expected))
  ) {
    res.status(401).json({ message: 'Invalid webhook secret' });
    return;
  }
  next();
}
