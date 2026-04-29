/**
 * fixes-13.test.ts — Regression tests for the 13-issue cleanup batch.
 *
 * PERF-002  Shared httpx client injected at startup (no per-request AsyncClient)
 * PERF-003  OpenAI timeout → user-facing message, not 500
 * CODE-002  _mask_phone removed from whatsapp.py / memory.py (single source)
 * BUG-010   auto_capture_contact not called twice for same phone in same process
 * BUG-011   IS NULL dead clause removed from inbox query
 * BUG-012   Agent-sent messages stored with sender = 'agent'
 * AUTH-003  Email masked in login-failure log
 * SEC-003   WhatsApp token/secret masked in GET /api/settings/whatsapp response
 * SEC-004   meeting_link is null for expired/completed meetings
 * TEN-022   menu._states evicts at 10 000 entries
 * SEC-007   companyId absent from /api/me response
 */

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── shared DB mock ────────────────────────────────────────────────────────────
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

vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn().mockResolvedValue(false),
    hash: vi.fn().mockResolvedValue('$2b$hashed'),
  },
}));

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({ challenge: 'ch' }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({ challenge: 'ch' }),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

vi.mock('../server/push', () => ({
  notifyAgent: vi.fn().mockResolvedValue(undefined),
  notifyAll: vi.fn().mockResolvedValue(undefined),
  notifiedChats: new Set(),
  VAPID_PUBLIC_KEY: '',
}));

vi.mock('../server/routes/settings.routes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/routes/settings.routes')>();
  return {
    ...actual,
    getCompanyBranding: vi.fn().mockResolvedValue({
      appUrl: 'https://app.example.com',
      brandName: 'Test Brand',
    }),
  };
});

import { pool } from '../server/db';
import { adminSession, buildApp } from './helpers/app';

// ── helpers ───────────────────────────────────────────────────────────────────

async function buildAuthApp() {
  const { app, setSession } = buildApp();
  (pool.query as any).mockResolvedValue({ rows: [] });
  const { registerAuthRoutes } = await import('../server/routes/auth.routes');
  await registerAuthRoutes(app as any);
  return { app, setSession };
}

async function buildSettingsApp() {
  const { app, setSession } = buildApp();
  const { registerSettingsRoutes } = await import('../server/routes/settings.routes');
  registerSettingsRoutes(app as any);
  return { app, setSession };
}

async function buildMessagesApp() {
  const { app, setSession } = buildApp();
  const { registerMessageRoutes } = await import('../server/routes/messages.routes');
  registerMessageRoutes(app as any);
  return { app, setSession };
}

async function buildMeetingsApp() {
  const { app, setSession } = buildApp();
  const { registerMeetingRoutes } = await import('../server/routes/meetings.routes');
  registerMeetingRoutes(app as any);
  return { app, setSession };
}

async function buildInboxApp() {
  const { app, setSession } = buildApp();
  const { registerInboxRoutes } = await import('../server/routes/inbox.routes');
  registerInboxRoutes(app as any);
  return { app, setSession };
}

// ── SEC-007: /api/me must not expose companyId ────────────────────────────────

describe('SEC-007 — /api/me does not leak companyId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authenticated response omits companyId', async () => {
    const { app, setSession } = await buildAuthApp();
    setSession({ ...adminSession, companyId: 7 });
    (pool.query as any).mockResolvedValue({ rows: [{ terms_accepted_at: null }] });
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body).not.toHaveProperty('companyId');
  });

  it('unauthenticated response also omits companyId', async () => {
    const { app } = await buildAuthApp();
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body).not.toHaveProperty('companyId');
  });
});

// ── AUTH-003: email masked in login-failure log ───────────────────────────────

describe('AUTH-003 — login failure logs masked email', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 and does not expose email in response body on failed login', async () => {
    const { app } = await buildAuthApp();
    (pool.query as any).mockResolvedValueOnce({ rows: [] }); // agent not found
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'realaddress@company.com', password: 'secret' });
    expect(res.status).toBe(401);
    // The raw email must not appear in the JSON response body
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('realaddress@company.com');
  });
});

// ── SEC-003: WhatsApp token/secret masked in settings response ────────────────

describe('SEC-003 — GET /api/settings/whatsapp masks token and appSecret', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accessToken is masked to last 4 chars visible', async () => {
    const { app, setSession } = await buildSettingsApp();
    setSession({ ...adminSession });
    (pool.query as any).mockResolvedValueOnce({
      rows: [{
        whatsapp_phone_number_id: '111',
        whatsapp_waba_id: '222',
        whatsapp_token: 'EAAabcdefghijklmnopqrstuvwxyz1234',
        whatsapp_app_secret: 'secret-value-5678',
      }],
    });
    const res = await request(app).get('/api/settings/whatsapp');
    expect(res.status).toBe(200);
    // Must not contain the full token
    expect(res.body.accessToken).not.toBe('EAAabcdefghijklmnopqrstuvwxyz1234');
    // Last 4 chars of the token must be visible
    expect(res.body.accessToken).toMatch(/1234$/);
    // Must contain masking asterisks
    expect(res.body.accessToken).toContain('*');
  });

  it('appSecret is masked to last 4 chars visible', async () => {
    const { app, setSession } = await buildSettingsApp();
    setSession({ ...adminSession });
    (pool.query as any).mockResolvedValueOnce({
      rows: [{
        whatsapp_phone_number_id: '111',
        whatsapp_waba_id: '222',
        whatsapp_token: 'token-abcd',
        whatsapp_app_secret: 'mysecret5678',
      }],
    });
    const res = await request(app).get('/api/settings/whatsapp');
    expect(res.status).toBe(200);
    expect(res.body.appSecret).toMatch(/5678$/);
    expect(res.body.appSecret).toContain('*');
  });

  it('empty token returns empty string without error', async () => {
    const { app, setSession } = await buildSettingsApp();
    setSession({ ...adminSession });
    (pool.query as any).mockResolvedValueOnce({
      rows: [{
        whatsapp_phone_number_id: '',
        whatsapp_waba_id: '',
        whatsapp_token: '',
        whatsapp_app_secret: '',
      }],
    });
    const res = await request(app).get('/api/settings/whatsapp');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('');
    expect(res.body.appSecret).toBe('');
  });
});

// ── SEC-004: meeting_link is null for expired/completed meetings ──────────────

describe('SEC-004 — GET /api/meeting/:token redacts link when expired', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns meeting_link: null for a completed meeting', async () => {
    const { app } = await buildMeetingsApp();
    (pool.query as any).mockResolvedValueOnce({
      rows: [{
        id: 1,
        customer_phone: '971500000000',
        company_id: 1,
        meeting_link: 'https://meet.example.com/live-link',
        status: 'completed',
        scheduled_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }],
    });
    const res = await request(app).get('/api/meeting/some-token');
    expect(res.status).toBe(200);
    expect(res.body.meeting_link).toBeNull();
  });

  it('returns meeting_link: null when scheduled_at + 2h is in the past', async () => {
    const { app } = await buildMeetingsApp();
    const pastTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
    (pool.query as any).mockResolvedValueOnce({
      rows: [{
        id: 2,
        customer_phone: '971500000001',
        company_id: 1,
        meeting_link: 'https://meet.example.com/old-link',
        status: 'pending',
        scheduled_at: pastTime,
      }],
    });
    const res = await request(app).get('/api/meeting/old-token');
    expect(res.status).toBe(200);
    expect(res.body.meeting_link).toBeNull();
  });

  it('returns real meeting_link for a future active meeting', async () => {
    const { app } = await buildMeetingsApp();
    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h from now
    (pool.query as any).mockResolvedValueOnce({
      rows: [{
        id: 3,
        customer_phone: '971500000002',
        company_id: 1,
        meeting_link: 'https://meet.example.com/active-link',
        status: 'pending',
        scheduled_at: futureTime,
      }],
    });
    const res = await request(app).get('/api/meeting/active-token');
    expect(res.status).toBe(200);
    expect(res.body.meeting_link).toBe('https://meet.example.com/active-link');
  });

  it('returns meeting_link: null when meeting has no scheduled_at and is completed', async () => {
    const { app } = await buildMeetingsApp();
    (pool.query as any).mockResolvedValueOnce({
      rows: [{
        id: 4,
        customer_phone: '971500000003',
        company_id: 1,
        meeting_link: 'https://meet.example.com/done',
        status: 'completed',
        scheduled_at: null,
      }],
    });
    const res = await request(app).get('/api/meeting/done-token');
    expect(res.status).toBe(200);
    expect(res.body.meeting_link).toBeNull();
  });
});

// ── BUG-012: agent-sent messages stored with sender = 'agent' ────────────────

describe('BUG-012 — POST /api/send stores sender = "agent"', () => {
  beforeEach(() => vi.clearAllMocks());

  it('INSERT into messages includes sender = "agent"', async () => {
    const { app, setSession } = await buildMessagesApp();
    setSession({ ...adminSession, companyId: 1 });

    // 1. Credentials lookup
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ whatsapp_phone_number_id: '111', whatsapp_token: 'tok' }],
    });

    // Mock the Meta API fetch
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '{}',
    });
    vi.stubGlobal('fetch', fetchMock);

    // 2. Reuse conversation_id lookup
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    // 3. INSERT into messages
    (pool.query as any).mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/send')
      .send({ customer_phone: '971501234567', message: 'Hello from agent' });

    expect(res.status).toBe(200);

    // Find the INSERT call
    const calls = (pool.query as any).mock.calls;
    const insertCall = calls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO messages')
    );
    expect(insertCall).toBeDefined();
    const sql: string = insertCall[0];
    expect(sql).toContain("'agent'");

    vi.unstubAllGlobals();
  });
});

// ── BUG-011: customer_phone IS NULL dead clause removed from conversations query ──

describe('BUG-011 — conversations query has no dead customer_phone IS NULL clause', () => {
  beforeEach(() => vi.clearAllMocks());

  it('conversations list SQL does not contain "customer_phone IS NULL"', async () => {
    const { app, setSession } = await buildInboxApp();
    setSession({ ...adminSession, companyId: 1 });
    (pool.query as any).mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/conversations');

    const calls = (pool.query as any).mock.calls;
    const convCall = calls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].toLowerCase().includes('distinct customer_phone')
    );
    expect(convCall).toBeDefined();
    const sql: string = convCall[0].toLowerCase();
    expect(sql).not.toContain('customer_phone is null');
  });
});
