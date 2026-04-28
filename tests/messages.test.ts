/**
 * messages.test.ts — Tests for POST /api/incoming per-tenant secret resolution.
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

import { pool } from '../server/db';
import { buildApp } from './helpers/app';

function buildMessagesApp() {
  const { app, setSession } = buildApp();
  return import('../server/routes/messages.routes').then(({ registerMessageRoutes }) => {
    registerMessageRoutes(app as any);
    return { app, setSession };
  });
}

describe('POST /api/incoming', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 with no x-webhook-secret header', async () => {
    const { app } = await buildMessagesApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/incoming')
      .send({ customer_phone: '971501234567', message_text: 'hi' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong x-webhook-secret (unknown in DB)', async () => {
    const { app } = await buildMessagesApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/incoming')
      .set('x-webhook-secret', 'bad-secret')
      .send({ customer_phone: '971501234567', message_text: 'hi' });
    expect(res.status).toBe(401);
  });

  it('succeeds with correct secret and derives companyId from DB (not body)', async () => {
    const { app } = await buildMessagesApp();
    // First call: resolveCompanyFromSecret → company id=5
    // Second call: SELECT conversation_id (for notifiedChats dedup)
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 5, name: 'Tenant A' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/incoming')
      .set('x-webhook-secret', 'tenant-a-secret')
      .send({ customer_phone: '971501234567', message_text: 'hello' });
    expect(res.status).toBe(200);
    // The conversation lookup must be scoped to companyId=5
    const convCall = (pool.query as any).mock.calls[1];
    expect(convCall[1]).toContain(5);
  });
});
