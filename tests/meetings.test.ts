/**
 * meetings.test.ts — Tests for meeting lifecycle and public booking flow.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), on: vi.fn() },
  db: {},
}));

vi.mock('../server/lib/trial', () => ({
  isCompanyTrialExpired: vi.fn().mockResolvedValue(false),
  getCompanyTrialStatus: vi.fn().mockResolvedValue({
    expired: false, trialDays: 14, daysRemaining: 10, createdAt: null, expiresAt: null,
  }),
  ensureConfigTable: vi.fn().mockResolvedValue(undefined),
  getTrialDays: vi.fn().mockResolvedValue(14),
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

  it('returns 401 with no x-webhook-secret header', async () => {
    const { app } = await buildMeetingApp();
    // No secret in header → resolveCompanyFromSecret returns null
    (pool.query as any).mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/meetings/create-token')
      .send({ customer_phone: '971501234567' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong x-webhook-secret (unknown in DB)', async () => {
    const { app } = await buildMeetingApp();
    // resolveCompanyFromSecret queries DB and gets no match
    (pool.query as any).mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/meetings/create-token')
      .set('x-webhook-secret', 'wrong-secret')
      .send({ customer_phone: '971501234567' });
    expect(res.status).toBe(401);
  });

  it('creates token with correct secret and derives companyId from DB (not body)', async () => {
    const { app } = await buildMeetingApp();
    // First call: resolveCompanyFromSecret returns company with id=7
    // Second call: pool.query INSERT for the meeting row
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 7, name: 'Tenant B' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/meetings/create-token')
      .set('x-webhook-secret', 'tenant-b-secret')
      .send({ customer_phone: '971501234567' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(10);
    // The INSERT must carry companyId=7 (from secret, not body)
    const insertCall = (pool.query as any).mock.calls[1];
    expect(insertCall[1]).toContain(7);
  });

  it('returns 400 when customer_phone missing', async () => {
    const { app } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({ rows: [{ id: 1, name: 'WAK' }] });
    const res = await request(app)
      .post('/api/meetings/create-token')
      .set('x-webhook-secret', 'any-secret')
      .send({});
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

  // Multi-tenant isolation: blocked_slots must be scoped to company_id
  it('queries blocked_slots with company_id — no cross-tenant leak', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    await request(app).get('/api/availability?weekStart=2026-04-21');
    const calls: any[][] = (pool.query as any).mock.calls;
    const blockedSlotCall = calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('blocked_slots')
    );
    expect(blockedSlotCall).toBeDefined();
    // company_id (1 from adminSession) must appear in the query params
    expect(blockedSlotCall![1]).toContain(1);
  });
});

describe('POST /api/availability/toggle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildMeetingApp();
    const res = await request(app)
      .post('/api/availability/toggle')
      .send({ date: '2026-04-21', time: '10:00' });
    expect(res.status).toBe(401);
  });

  // Multi-tenant isolation: INSERT/DELETE must carry company_id
  it('includes company_id when blocking a slot', async () => {
    const { app, setSession } = await buildMeetingApp();
    // First call = SELECT existing (returns empty → will INSERT)
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [] })   // SELECT id FROM blocked_slots
      .mockResolvedValueOnce({ rows: [] });   // INSERT
    setSession(adminSession);
    const res = await request(app)
      .post('/api/availability/toggle')
      .send({ date: '2026-04-21', time: '10:00' });
    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    const calls: any[][] = (pool.query as any).mock.calls;
    // All blocked_slots queries must reference companyId (1)
    calls
      .filter(([sql]) => typeof sql === 'string' && sql.includes('blocked_slots'))
      .forEach(([, params]) => expect(params).toContain(1));
  });
});
