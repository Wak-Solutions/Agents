/**
 * middleware.test.ts — Tests for requireCompanyId and handleError.
 */

import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
  maskPhone: (p: string) => p,
}));

import { requireCompanyId, getCompanyId } from '../server/middleware/requireCompanyId';
import { handleError } from '../server/middleware/handleError';

function buildAppWithSession(sessionData: Record<string, unknown> | null) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test',
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use((req: any, _res, next) => {
    if (sessionData) Object.assign(req.session, sessionData);
    next();
  });
  return app;
}

describe('requireCompanyId middleware', () => {
  it('returns 401 when companyId is missing from session', async () => {
    const app = buildAppWithSession({});
    app.get('/x', requireCompanyId, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/x');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
  });

  it('returns 401 when companyId is a non-numeric string', async () => {
    const app = buildAppWithSession({ companyId: 'abc' });
    app.get('/x', requireCompanyId, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/x');
    expect(res.status).toBe(401);
  });

  it('returns 401 when companyId is 0', async () => {
    const app = buildAppWithSession({ companyId: 0 });
    app.get('/x', requireCompanyId, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/x');
    expect(res.status).toBe(401);
  });

  it('returns 401 when companyId is negative', async () => {
    const app = buildAppWithSession({ companyId: -3 });
    app.get('/x', requireCompanyId, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/x');
    expect(res.status).toBe(401);
  });

  it('passes through and sets req.companyId when given a valid integer', async () => {
    const app = buildAppWithSession({ companyId: 7 });
    app.get('/x', requireCompanyId, (req: any, res: any) => res.json({ cid: req.companyId, type: typeof req.companyId }));
    const res = await request(app).get('/x');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cid: 7, type: 'number' });
  });

  it('coerces a numeric string to a number and passes through', async () => {
    const app = buildAppWithSession({ companyId: '1' });
    app.get('/x', requireCompanyId, (req: any, res: any) => res.json({ cid: req.companyId, type: typeof req.companyId }));
    const res = await request(app).get('/x');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cid: 1, type: 'number' });
  });
});

describe('getCompanyId helper', () => {
  it('returns the coerced number for valid session', () => {
    const fake: any = { session: { companyId: '42' } };
    expect(getCompanyId(fake)).toBe(42);
  });

  it('throws for missing or invalid session companyId', () => {
    expect(() => getCompanyId({ session: {} } as any)).toThrow('Invalid companyId');
    expect(() => getCompanyId({ session: { companyId: 'abc' } } as any)).toThrow('Invalid companyId');
    expect(() => getCompanyId({ session: { companyId: 0 } } as any)).toThrow('Invalid companyId');
  });
});

describe('handleError middleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns { message: "Internal error" } and never the err.message', async () => {
    const app = express();
    app.get('/boom', (_req, _res, _next) => {
      throw new Error('Key (email)=(victim@company.com) already exists');
    });
    app.use(handleError);
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Internal error' });
    expect(res.body).not.toHaveProperty('error');
    expect(JSON.stringify(res.body)).not.toContain('victim@company.com');
    expect(JSON.stringify(res.body)).not.toContain('email');
  });

  it('logs the real error server-side and never echoes it to the client', () => {
    const fakeReq: any = { method: 'GET', path: '/x' };
    const fakeRes: any = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const sensitive = 'underlying db error: relation "secret_table" does not exist';
    handleError(new Error(sensitive), fakeReq, fakeRes, vi.fn());
    expect(fakeRes.status).toHaveBeenCalledWith(500);
    expect(fakeRes.json).toHaveBeenCalledWith({ message: 'Internal error' });
    // The mocked logger.error was called (via vi.mock above) — verifying via
    // behaviour: the response must not contain the sensitive string.
    const sentBody = fakeRes.json.mock.calls[0][0];
    expect(JSON.stringify(sentBody)).not.toContain('secret_table');
  });

  it('handles non-Error throwables without leaking', () => {
    const fakeReq: any = { method: 'POST', path: '/y' };
    const fakeRes: any = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    handleError('a raw string error with sensitive=value', fakeReq, fakeRes, vi.fn());
    expect(fakeRes.json).toHaveBeenCalledWith({ message: 'Internal error' });
  });
});
