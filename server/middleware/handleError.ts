/**
 * handleError.ts — opaque 500 responder.
 *
 * Postgres error messages embed conflicting values (UNIQUE violations
 * include row data; FK violations include table names). Returning err.message
 * to the client leaks schema and cross-tenant existence. This handler logs
 * the real error server-side and sends a fixed string.
 */

import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../lib/logger';

const logger = createLogger('error');

export function handleError(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('unhandled', `${req.method} ${req.path} — ${message}`);
  if (!res.headersSent) {
    res.status(500).json({ message: 'Internal error' });
  }
}
