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
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/integrations/daily', () => ({
  createDailyRoom: vi.fn().mockResolvedValue({ url: 'https://daily.co/test-room', name: 'test-room' }),
}));

vi.mock('../server/lib/whatsapp', () => ({
  sendWhatsAppText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/routes/settings.routes', () => ({
  getWorkHours: vi.fn().mockResolvedValue({}),
  registerSettingsRoutes: vi.fn(),
  getCompanyBranding: vi.fn().mockResolvedValue({ appUrl: 'https://wak.example.com', brandName: 'WAK Solutions' }),
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
  isWithinWorkHours: vi.fn().mockReturnValue(true),
}));

vi.mock('../server/lib/timezone', () => ({
  KSA_OFFSET_MS: 3 * 60 * 60 * 1000,
  formatKsaDate: vi.fn().mockReturnValue('2026-04-14'),
  formatKsaDateTime: vi.fn().mockReturnValue('2026-04-14 10:00'),
}));

import { pool } from '../server/db';
import { adminSession, buildApp } from './helpers/app';
import { getCompanyBranding } from '../server/routes/settings.routes';

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

// ── Demo booking (global lead funnel) ──────────────────────────────────────

describe('GET /api/demo-booking/my-booking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildMeetingApp();
    const res = await request(app).get('/api/demo-booking/my-booking');
    expect(res.status).toBe(401);
  });

  it('reads from demo_bookings and never from meetings', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({
      rows: [{ id: 5, meeting_link: 'https://daily.co/r/x', scheduled_at: new Date('2026-05-01T10:00:00Z'), status: 'pending' }],
    });
    setSession(adminSession);
    const res = await request(app).get('/api/demo-booking/my-booking');
    expect(res.status).toBe(200);
    expect(res.body.booking).toBeTruthy();
    expect(res.body.booking.id).toBe(5);

    const calls: any[][] = (pool.query as any).mock.calls;
    expect(calls.length).toBe(1);
    const [sql, params] = calls[0];
    expect(sql).toContain('demo_bookings');
    // Must not query the per-tenant meetings table
    expect(sql).not.toMatch(/from\s+meetings/i);
    // Must not hardcode company_id = 1 in this query
    expect(sql).not.toMatch(/company_id\s*=\s*1/);
    expect(params).toEqual([adminSession.agentId]);
  });

  it('returns booking: null when no row found', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    const res = await request(app).get('/api/demo-booking/my-booking');
    expect(res.status).toBe(200);
    expect(res.body.booking).toBeNull();
  });
});

describe('GET /api/demo-booking/slots', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildMeetingApp();
    const res = await request(app).get('/api/demo-booking/slots');
    expect(res.status).toBe(401);
  });

  it('reads booked slots from demo_bookings only — never meetings', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    const res = await request(app).get('/api/demo-booking/slots');
    expect(res.status).toBe(200);

    const calls: any[][] = (pool.query as any).mock.calls;
    // No SELECT against meetings table — all "taken slot" reads go through demo_bookings
    const meetingsRead = calls.find(
      ([sql]) => typeof sql === 'string' && /from\s+meetings/i.test(sql)
    );
    expect(meetingsRead).toBeUndefined();
    const demoRead = calls.find(
      ([sql]) => typeof sql === 'string' && /from\s+demo_bookings/i.test(sql)
    );
    expect(demoRead).toBeDefined();
  });

  it('reads blocked_slots scoped to WAK (company_id 1) — platform owner is intentional', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    await request(app).get('/api/demo-booking/slots');
    const calls: any[][] = (pool.query as any).mock.calls;
    const blockedCall = calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('blocked_slots')
    );
    expect(blockedCall).toBeDefined();
    expect(blockedCall![1]).toContain(1);
  });
});

describe('POST /api/demo-booking/book', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildMeetingApp();
    const res = await request(app)
      .post('/api/demo-booking/book')
      .send({ date: '2026-05-01', time: '10:00' });
    expect(res.status).toBe(401);
  });

  it('inserts into demo_bookings (not meetings) with correct customer_name and customer_email', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ name: 'Jane Agent', email: 'jane@example.com' }] }) // SELECT agent
      .mockResolvedValueOnce({ rows: [] }) // SELECT taken from demo_bookings
      .mockResolvedValueOnce({ rows: [] }) // SELECT blocked
      .mockResolvedValueOnce({ rows: [] }); // INSERT demo_bookings
    setSession(adminSession);

    const res = await request(app)
      .post('/api/demo-booking/book')
      .send({ date: '2026-05-01', time: '10:00' });
    expect(res.status).toBe(200);

    const calls: any[][] = (pool.query as any).mock.calls;
    // No INSERT/UPDATE/SELECT against the meetings table
    const meetingsTouched = calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        /(insert\s+into|from|update)\s+meetings\b/i.test(sql)
    );
    expect(meetingsTouched).toBeUndefined();

    const insertCall = calls.find(
      ([sql]) => typeof sql === 'string' && /insert\s+into\s+demo_bookings/i.test(sql)
    );
    expect(insertCall).toBeDefined();
    const [insertSql, insertParams] = insertCall!;
    // Q9 fix: customer_name and customer_email columns are present
    expect(insertSql).toMatch(/customer_name/);
    expect(insertSql).toMatch(/customer_email/);
    // The agent name is bound as customer_name and email as customer_email
    expect(insertParams).toContain('Jane Agent');
    expect(insertParams).toContain('jane@example.com');
    // No company_id column in demo_bookings INSERT
    expect(insertSql).not.toMatch(/company_id/);
  });

  it('calls notifyAll with explicit companyId = 1 (not undefined)', async () => {
    const { notifyAll } = await import('../server/push');
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ name: 'Jane Agent', email: 'jane@example.com' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    setSession(adminSession);

    await request(app)
      .post('/api/demo-booking/book')
      .send({ date: '2026-05-01', time: '10:00' });

    expect(notifyAll).toHaveBeenCalled();
    const lastCall = (notifyAll as any).mock.calls.at(-1);
    expect(lastCall[1]).toBe(1);
  });

  it('returns 409 when the slot is already taken (in demo_bookings)', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ name: 'Jane', email: 'j@e.com' }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // taken
      .mockResolvedValueOnce({ rows: [] });
    setSession(adminSession);

    const res = await request(app)
      .post('/api/demo-booking/book')
      .send({ date: '2026-05-01', time: '10:00' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/demo-booking/:token (public)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for unknown token', async () => {
    const { app } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/demo-booking/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('returns row from demo_bookings and never queries meetings', async () => {
    const { app } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({
      rows: [{ id: 9, meeting_link: 'https://daily.co/r/y', scheduled_at: new Date('2026-05-01T10:00:00Z'), status: 'pending' }],
    });
    const res = await request(app).get('/api/demo-booking/abc');
    expect(res.status).toBe(200);
    expect(res.body.meeting_id).toBe(9);
    expect(res.body.meeting_link).toBe('https://daily.co/r/y');

    const [sql] = (pool.query as any).mock.calls[0];
    expect(sql).toMatch(/from\s+demo_bookings/i);
    expect(sql).not.toMatch(/from\s+meetings/i);
  });

  it('does not require auth (public route)', async () => {
    const { app } = await buildMeetingApp();
    (pool.query as any).mockResolvedValue({ rows: [{ id: 1, meeting_link: '', scheduled_at: null, status: 'pending' }] });
    const res = await request(app).get('/api/demo-booking/some-token');
    expect(res.status).not.toBe(401);
  });
});

// ── Demo bookings in meetings dashboard ───────────────────────────────────────

describe('GET /api/meetings — demo_bookings merge for company_id=1', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns both meetings and demo_bookings rows for company_id=1', async () => {
    const { app, setSession } = await buildMeetingApp();
    const meetingRow = {
      id: 1, customer_phone: '971501234567', agent_id: null, agent_name: null,
      meeting_link: '', meeting_token: null, agreed_time: null,
      scheduled_at: null, customer_email: null, status: 'pending',
      created_at: new Date().toISOString(), source: 'meeting',
    };
    const demoRow = {
      id: 10, customer_phone: null, agent_id: 2, agent_name: 'Jane',
      meeting_link: 'https://daily.co/demo', meeting_token: null, agreed_time: null,
      scheduled_at: new Date().toISOString(), customer_email: 'jane@example.com',
      status: 'pending', created_at: new Date().toISOString(), source: 'demo',
    };
    (pool.query as any).mockResolvedValueOnce({ rows: [meetingRow, demoRow] });
    setSession({ authenticated: true, agentId: 1, companyId: 1, role: 'admin' });

    const res = await request(app).get('/api/meetings');
    expect(res.status).toBe(200);
    const sources = res.body.map((r: any) => r.source);
    expect(sources).toContain('meeting');
    expect(sources).toContain('demo');
  });

  it('SQL includes UNION ALL with demo_bookings for company_id=1', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    setSession({ authenticated: true, agentId: 1, companyId: 1, role: 'admin' });

    await request(app).get('/api/meetings');
    const [sql, params] = (pool.query as any).mock.calls[0];
    expect(sql).toMatch(/UNION ALL/i);
    expect(sql).toMatch(/demo_bookings/i);
    expect(params).toContain(1);
  });

  it('returns only meetings rows for company_id=2 (no demo_bookings)', async () => {
    const { app, setSession } = await buildMeetingApp();
    const meetingRow = {
      id: 5, customer_phone: '971509999999', customer_name: null, agent_id: null,
      agent_name: null, meeting_link: '', meeting_token: null, agreed_time: null,
      scheduled_at: null, customer_email: null, status: 'pending',
      created_at: new Date().toISOString(), source: 'meeting',
    };
    (pool.query as any).mockResolvedValueOnce({ rows: [meetingRow] });
    setSession({ authenticated: true, agentId: 2, companyId: 2, role: 'admin' });

    const res = await request(app).get('/api/meetings');
    expect(res.status).toBe(200);
    res.body.forEach((r: any) => expect(r.source).toBe('meeting'));
    const [, params] = (pool.query as any).mock.calls[0];
    expect(params).toContain(2);
  });

  it('demo rows have customer_name populated and customer_phone null', async () => {
    const { app, setSession } = await buildMeetingApp();
    const demoRow = {
      id: 10, customer_phone: null, customer_name: 'Ammar Alkhateeb',
      agent_id: null, agent_name: null,
      meeting_link: 'https://daily.co/demo', meeting_token: null, agreed_time: null,
      scheduled_at: new Date('2026-04-30T10:00:00Z').toISOString(),
      customer_email: 'ammar@example.com', status: 'pending',
      created_at: new Date().toISOString(), source: 'demo',
    };
    (pool.query as any).mockResolvedValueOnce({ rows: [demoRow] });
    setSession({ authenticated: true, agentId: 1, companyId: 1, role: 'admin' });

    const res = await request(app).get('/api/meetings');
    expect(res.status).toBe(200);
    const demo = res.body.find((r: any) => r.source === 'demo');
    expect(demo).toBeDefined();
    expect(demo.customer_name).toBe('Ammar Alkhateeb');
    expect(demo.customer_phone).toBeNull();
  });

  it('meeting rows have customer_phone populated and customer_name null', async () => {
    const { app, setSession } = await buildMeetingApp();
    const meetingRow = {
      id: 1, customer_phone: '971501234567', customer_name: null,
      agent_id: null, agent_name: null, meeting_link: '', meeting_token: null,
      agreed_time: null, scheduled_at: null, customer_email: null,
      status: 'pending', created_at: new Date().toISOString(), source: 'meeting',
    };
    (pool.query as any).mockResolvedValueOnce({ rows: [meetingRow] });
    setSession({ authenticated: true, agentId: 1, companyId: 1, role: 'admin' });

    const res = await request(app).get('/api/meetings');
    expect(res.status).toBe(200);
    const mtg = res.body.find((r: any) => r.source === 'meeting');
    expect(mtg).toBeDefined();
    expect(mtg.customer_phone).toBe('971501234567');
    expect(mtg.customer_name).toBeNull();
  });

  it('SQL uses customer_name alias and NULL::text casts for schema alignment', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    setSession({ authenticated: true, agentId: 1, companyId: 1, role: 'admin' });

    await request(app).get('/api/meetings');
    const [sql] = (pool.query as any).mock.calls[0];
    expect(sql).toMatch(/NULL::text\s+AS\s+customer_name/i);
    expect(sql).toMatch(/NULL::text\s+AS\s+customer_phone/i);
    expect(sql).toMatch(/NULLS LAST/i);
  });
});

describe('GET /api/availability/booked — includes demo_bookings for company_id=1', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SQL includes demo_bookings UNION for company_id=1', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    setSession({ authenticated: true, agentId: 1, companyId: 1, role: 'admin' });

    await request(app).get('/api/availability/booked?weekStart=2026-05-01');
    const [sql, params] = (pool.query as any).mock.calls[0];
    expect(sql).toMatch(/demo_bookings/i);
    expect(sql).toMatch(/UNION ALL/i);
    expect(params).toContain(1);
  });

  it('returns 200 for company_id=2 without demo rows', async () => {
    const { app, setSession } = await buildMeetingApp();
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    setSession({ authenticated: true, agentId: 2, companyId: 2, role: 'admin' });

    const res = await request(app).get('/api/availability/booked?weekStart=2026-05-01');
    expect(res.status).toBe(200);
    // The $3 = 1 guard ensures demo rows excluded when companyId=2
    const [, params] = (pool.query as any).mock.calls[0];
    expect(params).toContain(2);
  });
});

// ── Fix 2 — bookMeeting returns 400 (not 500) when app_url is missing ────────

describe('POST /api/book/:token — app_url guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 with clear message when app_url is not set (not 500)', async () => {
    const { app } = await buildMeetingApp();

    // Make getCompanyBranding throw (simulates app_url=null in DB)
    (getCompanyBranding as any).mockRejectedValueOnce(
      new Error('companies.app_url is not set for companyId=2')
    );

    // Meeting token lookup: valid, unexpired, unbooked
    const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    (pool.query as any)
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          customer_phone: '971501234567',
          meeting_token: 'tok-abc',
          scheduled_at: null,
          token_expires_at: futureExpiry,
          agent_id: 1,
          company_id: 2,
        }],
      })
      .mockResolvedValueOnce({ rows: [] }) // work hours
      .mockResolvedValueOnce({ rows: [] }) // slot taken check
      .mockResolvedValueOnce({ rows: [] }); // blocked slots

    const res = await request(app)
      .post('/api/book/tok-abc')
      .send({ date: '2026-12-01', time: '10:00', customerEmail: '' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('App URL');
    expect(res.body.message).toContain('Settings');
  });

  it('proceeds normally when app_url is set', async () => {
    const { app } = await buildMeetingApp();

    // getCompanyBranding already returns a good value from the module mock
    const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    (pool.query as any)
      .mockResolvedValueOnce({
        rows: [{
          id: 2,
          customer_phone: '971501234567',
          meeting_token: 'tok-xyz',
          scheduled_at: null,
          token_expires_at: futureExpiry,
          agent_id: 1,
          company_id: 1,
        }],
      })
      .mockResolvedValueOnce({ rows: [] }) // work hours
      .mockResolvedValueOnce({ rows: [] }) // slot taken
      .mockResolvedValueOnce({ rows: [] }) // blocked slots
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE meetings
      .mockResolvedValueOnce({ rows: [] }); // email/notifications

    const res = await request(app)
      .post('/api/book/tok-xyz')
      .send({ date: '2026-12-01', time: '10:00', customerEmail: '' });

    // Should not be 400 or 500 (Daily room creation is mocked to succeed)
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(500);
  });
});
