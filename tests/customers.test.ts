/**
 * customers.test.ts — Tests for customer list and journey routes.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), on: vi.fn() },
  db: {},
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
