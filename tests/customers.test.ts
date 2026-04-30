/**
 * customers.test.ts — Tests for customer list and journey routes.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), on: vi.fn(), connect: vi.fn() },
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

import { pool } from '../server/db';
import { adminSession, agentSession, buildApp } from './helpers/app';

async function buildCustomersApp() {
  const { app, setSession } = buildApp();
  const { registerCustomerRoutes } = await import('../server/routes/customers.routes');
  registerCustomerRoutes(app as any);
  return { app, setSession };
}

describe('GET /api/customers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildCustomersApp();
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin agent', async () => {
    const { app, setSession } = await buildCustomersApp();
    setSession(agentSession);
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(403);
  });

  it('returns 200 with paginated list for admin', async () => {
    const { app, setSession } = await buildCustomersApp();
    // Route calls pool.query twice: paginated rows + COUNT query
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    setSession(adminSession);
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(200);
  });

  it('scopes results to session companyId', async () => {
    const { app, setSession } = await buildCustomersApp();
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    setSession(adminSession);
    await request(app).get('/api/customers');
    const queryArgs = (pool.query as any).mock.calls[0][1];
    expect(queryArgs).toContain(1); // companyId from adminSession
  });
});

describe('GET /api/customers/funnel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildCustomersApp();
    const res = await request(app).get('/api/customers/funnel');
    expect(res.status).toBe(401);
  });

  it('returns funnel data for admin', async () => {
    const { app, setSession } = await buildCustomersApp();
    // Route accesses rows[0].first_contact etc.
    (pool.query as any).mockResolvedValue({
      rows: [{ first_contact: '5', bot_conversation: '4', escalated: '2', meeting_booked: '1', survey_submitted: '1' }],
    });
    setSession(adminSession);
    const res = await request(app).get('/api/customers/funnel');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/customers/:phone/journey', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildCustomersApp();
    const res = await request(app).get('/api/customers/971501234567/journey');
    expect(res.status).toBe(401);
  });

  it('returns full timeline for admin', async () => {
    const { app, setSession } = await buildCustomersApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    const res = await request(app).get('/api/customers/971501234567/journey');
    expect(res.status).toBe(200);
  });
});

// ── Per-company contact name isolation ────────────────────────────────────────

describe('GET /api/contacts — reads name from contact_companies', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SELECT reads cc.name not c.name', async () => {
    const { app, setSession } = await buildCustomersApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    await request(app).get('/api/contacts');
    const [sql] = (pool.query as any).mock.calls[0];
    // Must read cc.name (contact_companies alias)
    expect(sql).toMatch(/cc\.name/i);
    // Must NOT read c.name (global contacts table)
    expect(sql).not.toMatch(/\bc\.name\b/i);
  });
});

describe('PATCH /api/contacts/:id — updates contact_companies.name only', () => {
  beforeEach(() => vi.clearAllMocks());

  it('UPDATE targets contact_companies, not contacts', async () => {
    const { app, setSession } = await buildCustomersApp();
    (pool.query as any).mockResolvedValue({
      rows: [{ id: 1, phone_number: '971501234567', name: 'Alice', source: 'manual', created_at: new Date() }],
    });
    setSession(adminSession);
    await request(app).patch('/api/contacts/1').send({ name: 'Alice' });
    const [sql, params] = (pool.query as any).mock.calls[0];
    // Must UPDATE contact_companies, not contacts
    expect(sql).toMatch(/UPDATE\s+contact_companies/i);
    expect(sql).not.toMatch(/UPDATE\s+contacts\b/i);
    // company_id must be in the WHERE params (scopes to tenant)
    expect(params).toContain(1); // companyId from adminSession
    expect(params).toContain('Alice');
  });

  it('Tenant 1 update does not leak into Tenant 2 (different company_id in params)', async () => {
    // Use contact id=99 so we can assert company_id=1/2 without ambiguity
    const { app: app1, setSession: setSession1 } = await buildCustomersApp();
    (pool.query as any).mockResolvedValue({
      rows: [{ id: 99, phone_number: '971501234567', name: 'T1 Name', source: 'manual', created_at: new Date() }],
    });
    setSession1({ authenticated: true, agentId: 1, role: 'admin', companyId: 1 });
    await request(app1).patch('/api/contacts/99').send({ name: 'T1 Name' });
    const [, params1] = (pool.query as any).mock.calls[0];
    expect(params1).toContain(1);   // company_id=1 in WHERE
    expect(params1).not.toContain(2);

    vi.clearAllMocks();

    const { app: app2, setSession: setSession2 } = await buildCustomersApp();
    (pool.query as any).mockResolvedValue({
      rows: [{ id: 99, phone_number: '971501234567', name: 'T2 Name', source: 'manual', created_at: new Date() }],
    });
    setSession2({ authenticated: true, agentId: 99, role: 'admin', companyId: 2 });
    await request(app2).patch('/api/contacts/99').send({ name: 'T2 Name' });
    const [, params2] = (pool.query as any).mock.calls[0];
    expect(params2).toContain(2);   // company_id=2 in WHERE
    expect(params2).not.toContain(1);
  });
});

describe('POST /api/contacts — writes name to contact_companies', () => {
  beforeEach(() => vi.clearAllMocks());

  it('INSERT into contact_companies carries the name column', async () => {
    const { app, setSession } = await buildCustomersApp();

    // The POST route uses pool.connect() for a transaction client.
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    (pool.connect as any).mockResolvedValue(mockClient);
    // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // INSERT INTO contacts — returns id
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 5, phone_number: '971501234567' }] });
    // INSERT INTO contact_companies — returns link row
    mockClient.query.mockResolvedValueOnce({ rows: [{ source: 'manual', created_at: new Date(), name: 'Bob' }] });
    // COMMIT
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    setSession(adminSession);
    const res = await request(app)
      .post('/api/contacts')
      .send({ phone_number: '971501234567', name: 'Bob' });
    expect(res.status).toBe(200);

    const calls: any[][] = mockClient.query.mock.calls;

    const ccInsert = calls.find(
      ([sql]) => typeof sql === 'string' && /INSERT\s+INTO\s+contact_companies/i.test(sql)
    );
    expect(ccInsert).toBeDefined();
    // name must appear in the INSERT column list
    expect(ccInsert![0]).toMatch(/\bname\b/i);

    // contacts INSERT must NOT include name column
    const contactsInsert = calls.find(
      ([sql]) => typeof sql === 'string' && /INSERT\s+INTO\s+contacts\b/i.test(sql)
    );
    expect(contactsInsert).toBeDefined();
    expect(contactsInsert![0]).not.toMatch(/\bname\b/i);
  });
});
