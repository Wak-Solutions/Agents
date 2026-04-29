/**
 * requireCompanyId.ts — coerces and validates req.session.companyId.
 *
 * connect-pg-simple can deserialize integer columns as strings; Drizzle's
 * sql template only safely binds number primitives. A string value slipping
 * through could fall back to literal interpolation. This middleware narrows
 * the type to a positive integer once, so downstream handlers can treat
 * req.companyId as a trusted number.
 */

import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      /** Coerced, validated companyId from the session. */
      companyId: number;
    }
  }
}

function coerce(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** Express middleware: 401 if companyId missing/invalid, otherwise sets req.companyId. */
export function requireCompanyId(req: Request, res: Response, next: NextFunction): void {
  const cid = coerce(req.session?.companyId);
  if (cid === null) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  req.companyId = cid;
  next();
}

/** In-handler helper: returns the validated companyId or throws. */
export function getCompanyId(req: Request): number {
  const cid = coerce(req.session?.companyId);
  if (cid === null) {
    throw new Error('Invalid companyId');
  }
  return cid;
}
