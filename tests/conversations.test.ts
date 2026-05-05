/**
 * conversations.test.ts — Tests for message and incoming-webhook routes.
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
  addNotified: vi.fn(),
  hasNotified: vi.fn().mockReturnValue(false),
  deleteNotified: vi.fn(),
  VAPID_PUBLIC_KEY: '',
}));

vi.mock('../server/storage', () => ({
  storage: {
    getConversations: vi.fn().mockResolvedValue([]),
    getMessages: vi.fn().mockResolvedValue([]),
  },
}));

import { pool } from '../server/db';
import { adminSession, agentSession, buildApp } from './helpers/app';

function buildConvApp() {
  const { app, setSession } = buildApp();
  return import('../server/routes/messages.routes').then(({ registerMessageRoutes }) => {
    registerMessageRoutes(app as any);
    return { app, setSession };
  });
}

describe('GET /api/messages/:phone', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 with no session', async () => {
    const { app } = await buildConvApp();
    const res = await request(app).get('/api/messages/971501234567');
    expect(res.status).toBe(401);
  });

  it('returns 200 with authenticated session', async () => {
    const { app, setSession } = await buildConvApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    const res = await request(app).get('/api/messages/971501234567');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('scopes query to session companyId', async () => {
    const { app, setSession } = await buildConvApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    await request(app).get('/api/messages/971501234567');
    const callArgs = (pool.query as any).mock.calls[0];
    // companyId=1 (from adminSession) must appear in query params
    expect(callArgs[1]).toContain(1);
  });
});

describe('POST /api/incoming (webhook from Python bot)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without correct webhook secret', async () => {
    const { app } = await buildConvApp();
    const res = await request(app)
      .post('/api/incoming')
      .send({ customer_phone: '971501234567', message_text: 'hello' });
    expect(res.status).toBe(401);
  });

  it('returns 200 when secret resolves a company in DB', async () => {
    const { app } = await buildConvApp();
    // First call: resolveCompanyFromSecret → company id=1
    // Second call: SELECT conversation_id for notifiedChats dedup
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'WAK' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/incoming')
      .set('x-webhook-secret', 'per-tenant-secret')
      .send({ customer_phone: '971501234567', message_text: 'hello' });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/conversations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 with no session', async () => {
    const { app } = buildApp();
    const { registerInboxRoutes } = await import('../server/routes/inbox.routes');
    registerInboxRoutes(app as any);
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(401);
  });

  it('returns 200 with authenticated session', async () => {
    const { app, setSession } = buildApp();
    const { registerInboxRoutes } = await import('../server/routes/inbox.routes');
    registerInboxRoutes(app as any);
    setSession(adminSession);
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(200);
  });
});
