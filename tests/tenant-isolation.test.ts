/**
 * tenant-isolation.test.ts — Tests for TEN-017, TEN-018, TEN-019.
 *
 * TEN-017: contact DELETE returns 404 for wrong-tenant contact_id
 * TEN-018: bulk-delete validates ids with zod
 * TEN-019: push subscribe uses req.companyId not ?? 1
 *
 * TEN-015 and TEN-016 (survey mutations) are in tenant-isolation-surveys.test.ts
 * to avoid conflicts with the surveys module mock in this file.
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
  VAPID_PUBLIC_KEY: 'test-vapid-key',
  registerSubscription: vi.fn().mockResolvedValue(undefined),
  removeSubscription: vi.fn().mockResolvedValue(undefined),
  notifyAgent: vi.fn().mockResolvedValue(undefined),
  notifyAll: vi.fn().mockResolvedValue(undefined),
  notifiedChats: new Set(),
}));

import { pool } from '../server/db';
import { adminSession, buildApp } from './helpers/app';

async function buildCustomersApp() {
  const { app, setSession } = buildApp();
  const { registerCustomerRoutes } = await import('../server/routes/customers.routes');
  registerCustomerRoutes(app as any);
  return { app, setSession };
}

async function buildPushApp() {
  const { app, setSession } = buildApp();
  const { registerPushRoutes } = await import('../server/routes/push.routes');
  registerPushRoutes(app as any);
  return { app, setSession };
}

/* ─────────────────────────────────────────────────────────────────────────────
   TEN-017 — contact DELETE verifies tenant ownership
───────────────────────────────────────────────────────────────────────────── */

describe('TEN-017 — contact DELETE tenant ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when contact does not belong to this tenant', async () => {
    const { app, setSession } = await buildCustomersApp();
    setSession(adminSession);
    // contact_companies DELETE returns 0 matching rows → 404
    (pool.query as any).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).delete('/api/contacts/99');
    expect(res.status).toBe(404);
  });

  it('returns 200 and runs orphan cleanup when contact belongs to this tenant', async () => {
    const { app, setSession } = await buildCustomersApp();
    setSession(adminSession);
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ contact_id: 5 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app).delete('/api/contacts/5');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('scopes the link-delete to the tenant company_id', async () => {
    const { app, setSession } = await buildCustomersApp();
    setSession(adminSession);
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ contact_id: 5 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await request(app).delete('/api/contacts/5');
    const [sql, params] = (pool.query as any).mock.calls[0];
    expect(sql).toContain('company_id');
    expect(params).toContain(1); // adminSession companyId
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   TEN-018 — bulk-delete zod validation
───────────────────────────────────────────────────────────────────────────── */

describe('TEN-018 — bulk-delete input validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when ids contains a non-integer string', async () => {
    const { app, setSession } = await buildCustomersApp();
    setSession(adminSession);
    const res = await request(app)
      .post('/api/contacts/bulk-delete')
      .send({ ids: [1, 'abc', 3] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/positive integers/i);
  });

  it('returns 400 when ids is an empty array', async () => {
    const { app, setSession } = await buildCustomersApp();
    setSession(adminSession);
    const res = await request(app)
      .post('/api/contacts/bulk-delete')
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when ids contains a negative number', async () => {
    const { app, setSession } = await buildCustomersApp();
    setSession(adminSession);
    const res = await request(app)
      .post('/api/contacts/bulk-delete')
      .send({ ids: [1, -5, 3] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when ids is missing entirely', async () => {
    const { app, setSession } = await buildCustomersApp();
    setSession(adminSession);
    const res = await request(app)
      .post('/api/contacts/bulk-delete')
      .send({});
    expect(res.status).toBe(400);
  });

  it('succeeds with valid positive integer ids scoped to company', async () => {
    const { app, setSession } = await buildCustomersApp();
    setSession(adminSession);
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 });
    const res = await request(app)
      .post('/api/contacts/bulk-delete')
      .send({ ids: [1, 2, 3] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const [sql, params] = (pool.query as any).mock.calls[0];
    expect(sql).toContain('company_id');
    expect(params).toContain(1); // adminSession companyId
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   TEN-019 — push subscribe uses req.companyId directly
───────────────────────────────────────────────────────────────────────────── */

describe('TEN-019 — push subscribe uses req.companyId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls registerSubscription with companyId from session (not ?? 1 fallback)', async () => {
    const { app, setSession } = await buildPushApp();
    const companySession = { authenticated: true, agentId: 5, companyId: 7, role: 'admin', agentName: 'Agent Seven' };
    setSession(companySession);
    const { registerSubscription } = await import('../server/push');
    const res = await request(app)
      .post('/api/push/subscribe')
      .send({ endpoint: 'https://push.example.com/sub', keys: { p256dh: 'abc', auth: 'xyz' } });
    expect(res.status).toBe(200);
    expect(registerSubscription).toHaveBeenCalledWith(5, 7, expect.objectContaining({ endpoint: 'https://push.example.com/sub' }));
  });

  it('returns 400 when subscription has no endpoint', async () => {
    const { app, setSession } = await buildPushApp();
    setSession(adminSession);
    const res = await request(app)
      .post('/api/push/subscribe')
      .send({ keys: {} });
    expect(res.status).toBe(400);
  });
});
