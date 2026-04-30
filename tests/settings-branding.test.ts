/**
 * settings-branding.test.ts — Tests for GET/PUT /api/settings/branding
 * and the getCompanyBranding helper.
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

import { pool } from '../server/db';
import { adminSession, agentSession, buildApp } from './helpers/app';
import { getCompanyBranding } from '../server/routes/settings.routes';

/* ─────────────────────────────────────────────────────────────────────────────
   getCompanyBranding helper
───────────────────────────────────────────────────────────────────────────── */

describe('getCompanyBranding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns appUrl and brandName when both are set', async () => {
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ app_url: 'https://app.example.com', brand_name: 'Acme Corp' }],
    });
    const result = await getCompanyBranding(1);
    expect(result).toEqual({ appUrl: 'https://app.example.com', brandName: 'Acme Corp' });
  });

  it('throws when app_url is missing', async () => {
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ app_url: null, brand_name: 'Acme Corp' }],
    });
    await expect(getCompanyBranding(1)).rejects.toThrow('app_url');
  });

  it('throws when brand_name is missing', async () => {
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ app_url: 'https://app.example.com', brand_name: null }],
    });
    await expect(getCompanyBranding(1)).rejects.toThrow('brand_name');
  });

  it('throws when company row is not found', async () => {
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    await expect(getCompanyBranding(99)).rejects.toThrow();
  });

  it('queries by the given companyId', async () => {
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ app_url: 'https://x.example.com', brand_name: 'X Corp' }],
    });
    await getCompanyBranding(42);
    const [sql, params] = (pool.query as any).mock.calls[0];
    expect(params).toContain(42);
    expect(sql).toContain('app_url');
    expect(sql).toContain('brand_name');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/settings/branding
───────────────────────────────────────────────────────────────────────────── */

async function buildSettingsApp() {
  const { app, setSession } = buildApp();
  const { registerSettingsRoutes } = await import('../server/routes/settings.routes');
  registerSettingsRoutes(app as any);
  return { app, setSession };
}

describe('GET /api/settings/branding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 for unauthenticated request', async () => {
    const { app } = await buildSettingsApp();
    const res = await request(app).get('/api/settings/branding');
    expect(res.status).toBe(401);
  });

  it('returns brandName for authenticated admin', async () => {
    const { app, setSession } = await buildSettingsApp();
    setSession(adminSession);
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ brand_name: 'Acme Corp' }],
    });
    const res = await request(app).get('/api/settings/branding');
    expect(res.status).toBe(200);
    expect(res.body.brandName).toBe('Acme Corp');
    expect(res.body.appUrl).toBeUndefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   PUT /api/settings/branding
───────────────────────────────────────────────────────────────────────────── */

describe('PUT /api/settings/branding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 for unauthenticated request', async () => {
    const { app } = await buildSettingsApp();
    const res = await request(app)
      .put('/api/settings/branding')
      .send({ brandName: 'X', appUrl: 'https://x.com' });
    expect(res.status).toBe(401);
  });

  it('saves branding and returns 200 for admin', async () => {
    const { app, setSession } = await buildSettingsApp();
    setSession(adminSession);
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .put('/api/settings/branding')
      .send({ brandName: 'Acme Corp', appUrl: 'https://app.example.com' });
    expect(res.status).toBe(200);
  });

  it('returns 400 when brandName is missing', async () => {
    const { app, setSession } = await buildSettingsApp();
    setSession(adminSession);
    const res = await request(app)
      .put('/api/settings/branding')
      .send({});
    expect(res.status).toBe(400);
  });

  it('ignores appUrl in request body — only brandName is saved', async () => {
    const { app, setSession } = await buildSettingsApp();
    setSession(adminSession);
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    await request(app)
      .put('/api/settings/branding')
      .send({ brandName: 'Acme Corp', appUrl: 'https://app.example.com/' });
    const [sql, params] = (pool.query as any).mock.calls[0];
    expect(sql).toContain('UPDATE');
    expect(params).toContain('Acme Corp');
    expect(params).not.toContain('https://app.example.com/');
    expect(params).not.toContain('https://app.example.com');
  });
});
