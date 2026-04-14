/**
 * meetings.test.ts — Tests for meeting lifecycle and public booking flow.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), on: vi.fn() },
  db: {},
}));

vi.mock('../server/push', () => ({
  notifyAgent: vi.fn().mockResolvedValue(undefined),
  notifyAll: vi.fn().mockResolvedValue(undefined),
  notifiedChats: new Set(),
  VAPID_PUBLIC_KEY: '',
}));

vi.mock('../server/email', () => ({
  notifyManagerNewBooking: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/surveys', () => ({
  sendSurveyToCustomer: vi.fn().mockResolvedValue(undefined),
  ensureSurveyTables: vi.fn().mockResolvedValue(undefined),
  registerSurveyRoutes: vi.fn(),
}));

vi.mock('../server/lib/daily', () => ({
  createDailyRoom: vi.fn().mockResolvedValue('https://daily.co/test-room'),
}));

vi.mock('../server/lib/slots', () => ({
  getSlotsForDay: vi.fn().mockReturnValue([]),
}));

vi.mock('../server/lib/timezone', () => ({
  KSA_OFFSET_MS: 3 * 60 * 60 * 1000,
  formatKsaDate: vi.fn().mockReturnValue('2026-04-14'),
  formatKsaDateTime: vi.fn().mockReturnValue('2026-04-14 10:00'),
}));

import { pool } from '../server/db';
import { adminSession, buildApp } from './helpers/app';

function buildMeetingApp() {
  const { app, setSession } = buildApp();
  return import('../server/routes/meetings.routes').then(({ registerMeetingRoutes }) => {
    registerMeetingRoutes(app as any);
    return { app, setSession };
  });
}

describe('POST /api/meetings/create-token', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without webhook secret', async () => {
    const { app } = await buildMeetingApp();
    const res = await request(app)
      .post('/api/meetings/create-token')
      .send({ customer_phone: '971501234567', company_id: 1 });
    expect(res.status).toBe(401);
  });

  it('creates token with valid secret', async () => {
    process.env.WEBHOOK_SECRET = 'test-secret';
    const { app } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/meetings/create-token')
      .set('x-webhook-secret', 'test-secret')
      .send({ customer_phone: '971501234567', company_id: 1 });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(10);
  });

  it('returns 400 when customer_phone missing', async () => {
    process.env.WEBHOOK_SECRET = 'test-secret';
    const { app } = await buildMeetingApp();
    const res = await request(app)
      .post('/api/meetings/create-token')
      .set('x-webhook-secret', 'test-secret')
      .send({ company_id: 1 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/meetings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildMeetingApp();
    const res = await request(app).get('/api/meetings');
    expect(res.status).toBe(401);
  });

  it('returns 200 and only own company meetings', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    const res = await request(app).get('/api/meetings');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const queryArgs = (pool.query as any).mock.calls[0][1];
    expect(queryArgs).toContain(1); // companyId
  });
});

describe('PATCH /api/meetings/:id/start', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets status to in_progress', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({ rows: [{ id: 1, status: 'in_progress' }] });
    setSession(adminSession);
    const res = await request(app).patch('/api/meetings/1/start');
    expect(res.status).toBe(200);
  });

  it('returns 401 without session', async () => {
    const { app } = await buildMeetingApp();
    const res = await request(app).patch('/api/meetings/1/start');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/meetings/:id/complete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets status to completed', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 1, customer_phone: '971501234567', agent_id: 1, company_id: 1 }] })
      .mockResolvedValueOnce({ rows: [] }); // update query
    setSession(adminSession);
    const res = await request(app).patch('/api/meetings/1/complete');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/availability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildMeetingApp();
    const res = await request(app).get('/api/availability');
    expect(res.status).toBe(401);
  });

  it('returns availability data with session', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    const res = await request(app).get('/api/availability');
    expect(res.status).toBe(200);
  });
});
