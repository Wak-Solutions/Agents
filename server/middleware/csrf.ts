import { randomBytes } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export function setCsrfCookie(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('hex');
  }
  res.cookie('csrf-token', req.session.csrfToken, {
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false,
  });
  next();
}

export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    res.status(403).json({ message: 'Invalid CSRF token' });
    return;
  }
  next();
}
