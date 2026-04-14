/**
 * escalations.test.ts — Tests for escalation lifecycle routes.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), on: vi.fn() },
  db: {},
}));

vi.mock('../server/push', () => ({
  notifyAdmins: vi.fn().mockResolvedValue(undefined),
  notifyAgent: vi.fn().mockResolvedValue(undefined),
  notifyAll: vi.fn().mockResolvedValue(undefined),
  notifiedChats: new Set(),
  VAPID_PUBLIC_KEY: '',
}));

vi.mock('../server/surveys', () => ({
  sendSurveyToCustomer: vi.fn().mockResolvedValue(undefined),
  ensureSurveyTables: vi.fn().mockResolvedValue(undefined),
  registerSurveyRoutes: vi.fn(),
}));

vi.mock('../server/storage', () => ({
  storage: {
    getOpenEscalations: vi.fn().mockResolvedValue([]),
    closeEscalation: vi.fn().mockResolvedValue(undefined),
  },
}));

import { pool } from '../server/db';
import { adminSession, agentSession, buildApp } from './helpers/app';

function buildEscApp() {
  const { app, setSession } = buildApp();
  return import('../server/routes/escalations.routes').then(({ registerEscalationRoutes }) => {
    registerEscalationRoutes(app as any);
    return { app, setSession };
  });
}

describe('GET /api/escalations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 with no session', async () => {
    const { app } = await buildEscApp();
    const res = await request(app).get('/api/escalations');
    expect(res.status).toBe(401);
  });

  it('returns 200 for authenticated agent and only own company data', async () => {
    const { app, setSession } = await buildEscApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(agentSession);
    const res = await request(app).get('/api/escalations');
    expect(res.status).toBe(200);
    // query must be scoped to companyId=1
    const queryArgs = (pool.query as any).mock.calls[0][1];
    expect(queryArgs).toContain(1);
  });
});

describe('POST /api/escalate (from Python bot)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without webhook secret', async () => {
    const { app } = await buildEscApp();
    const res = await request(app)
      .post('/api/escalate')
      .send({ customer_phone: '971501234567', escalation_reason: 'test', company_id: '1' });
    expect(res.status).toBe(401);
  });

  it('creates escalation with valid secret', async () => {
    process.env.WEBHOOK_SECRET = 'test-secret';
    const { app } = await buildEscApp();
    (pool.query as any).mockResolvedValue({
      rows: [{ id: 1, customer_phone: '971501234567', status: 'open' }],
    });
    const res = await request(app)
      .post('/api/escalate')
      .set('x-webhook-secret', 'test-secret')
      .send({ customer_phone: '971501234567', escalation_reason: 'wants agent', company_id: '1' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
  });

  it('returns 400 when company_id missing', async () => {
    process.env.WEBHOOK_SECRET = 'test-secret';
    const { app } = await buildEscApp();
    const res = await request(app)
      .post('/api/escalate')
      .set('x-webhook-secret', 'test-secret')
      .send({ customer_phone: '971501234567', escalation_reason: 'test' }); // no company_id
    expect(res.status).toBe(400);
  });
});

describe('POST /api/close', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without auth', async () => {
    const { app } = await buildEscApp();
    const res = await request(app)
      .post('/api/close')
      .send({ customer_phone: '971501234567' });
    expect(res.status).toBe(401);
  });

  it('returns 200 and closes escalation', async () => {
    const { app, setSession } = await buildEscApp();
    (pool.query as any).mockResolvedValue({
      rows: [{ id: 5, assigned_agent_id: 1 }],
    });
    setSession(adminSession);
    const res = await request(app)
      .post('/api/close')
      .send({ customer_phone: '971501234567' });
    expect(res.status).toBe(200);
  });
});
