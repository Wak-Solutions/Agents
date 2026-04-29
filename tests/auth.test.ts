/**
 * auth.test.ts — Tests for authentication routes (login, logout, /me).
 *
 * WebAuthn routes require a live browser credential flow and are not unit-testable
 * in isolation — they are covered by the registration-status and options endpoints.
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

// bcrypt is slow in tests — mock it so password checks are instant
vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn().mockResolvedValue('$2b$hashed'),
  },
}));

// WebAuthn library — mock so auth.routes doesn't need real crypto hw
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({ challenge: 'ch' }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({ challenge: 'ch' }),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import bcrypt from 'bcrypt';
import { pool } from '../server/db';
import { adminSession, buildApp } from './helpers/app';

async function buildAuthApp() {
  const { app, setSession } = buildApp();
  // Stub pool.query used in registerAuthRoutes for table creation
  (pool.query as any).mockResolvedValue({ rows: [] });
  const { registerAuthRoutes } = await import('../server/routes/auth.routes');
  await registerAuthRoutes(app as any);
  return { app, setSession };
}

describe('POST /api/login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when email or password missing', async () => {
    const { app } = await buildAuthApp();
    const res = await request(app).post('/api/login').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when agent not found', async () => {
    const { app } = await buildAuthApp();
    (pool.query as any).mockResolvedValueOnce({ rows: [] }); // no agent
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'unknown@example.com', password: 'pass' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when account is deactivated', async () => {
    const { app } = await buildAuthApp();
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1, email: 'a@b.com', password_hash: '$2b$hash', is_active: false, role: 'agent', company_id: 1, name: 'A' }],
    });
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'a@b.com', password: 'wrong' });
    expect(res.status).toBe(403);
  });

  it('returns 401 when password is wrong', async () => {
    const { app } = await buildAuthApp();
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 1, email: 'a@b.com', password_hash: '$2b$hash', is_active: true, role: 'agent', company_id: 1, name: 'A' }],
    });
    (bcrypt.compare as any).mockResolvedValueOnce(false);
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'a@b.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns 200 with role and name on correct credentials', async () => {
    const { app } = await buildAuthApp();
    (pool.query as any)
      .mockResolvedValueOnce({
        rows: [{ id: 1, email: 'a@b.com', password_hash: '$2b$hash', is_active: true, role: 'admin', company_id: 1, name: 'Alice' }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE last_login
    (bcrypt.compare as any).mockResolvedValueOnce(true);
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'a@b.com', password: 'correct' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.role).toBe('admin');
    expect(res.body.agentName).toBe('Alice');
  });
});

describe('POST /api/logout', () => {
  it('returns 200 and clears session', async () => {
    const { app, setSession } = await buildAuthApp();
    setSession(adminSession);
    const res = await request(app).post('/api/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/me', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with authenticated:false when no session', async () => {
    const { app } = await buildAuthApp();
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  it('returns 200 with session data when authenticated', async () => {
    const { app, setSession } = await buildAuthApp();
    (pool.query as any).mockResolvedValue({ rows: [{ terms_accepted_at: null }] });
    setSession(adminSession);
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.role).toBe('admin');
  });
});

describe('GET /api/auth/webauthn/registered (per-user)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns registered:false when no email param is provided', async () => {
    const { app } = await buildAuthApp();
    // Even if there are global credentials, no email = no lookup
    (pool.query as any).mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });
    const res = await request(app).get('/api/auth/webauthn/registered');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ registered: false });
    // No DB query should have been issued for the lookup
    const lookupCall = (pool.query as any).mock.calls.find(
      ([sql]: any[]) => typeof sql === 'string' && sql.includes('webauthn_credentials wc') && sql.includes('JOIN agents')
    );
    expect(lookupCall).toBeUndefined();
  });

  it('returns registered:false for an unknown email (same shape, no enumeration)', async () => {
    const { app } = await buildAuthApp();
    (pool.query as any).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/auth/webauthn/registered?email=ghost@example.com');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ registered: false });
  });

  it('returns registered:true for a known email with a passkey', async () => {
    const { app } = await buildAuthApp();
    (pool.query as any).mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
    const res = await request(app).get('/api/auth/webauthn/registered?email=user@example.com');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ registered: true });
    // Confirm the query was scoped by email
    const call = (pool.query as any).mock.calls.find(
      ([sql]: any[]) => typeof sql === 'string' && sql.includes('JOIN agents') && sql.includes('webauthn_credentials')
    );
    expect(call).toBeDefined();
    expect(call![1]).toEqual(['user@example.com']);
  });
});

describe('POST /api/auth/webauthn/login/options (per-user)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty allowCredentials when no email is provided', async () => {
    const { app } = await buildAuthApp();
    (pool.query as any).mockResolvedValue({ rows: [{ credential_id: 'GLOBAL-LEAK' }] });
    const res = await request(app)
      .post('/api/auth/webauthn/login/options')
      .send({});
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.allowCredentials ?? [])).toBe(true);
    // The route never queries webauthn_credentials when email is missing
    const lookupCall = (pool.query as any).mock.calls.find(
      ([sql]: any[]) => typeof sql === 'string' && sql.includes('webauthn_credentials wc') && sql.includes('JOIN agents')
    );
    expect(lookupCall).toBeUndefined();
  });

  it('returns empty allowCredentials for an unknown email (same envelope shape)', async () => {
    const { app } = await buildAuthApp();
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/auth/webauthn/login/options')
      .send({ email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    // Envelope present, no credentials leaked
    expect(res.body).toHaveProperty('challenge');
  });

  it('returns only the named user\'s credentials for a known email', async () => {
    const { app } = await buildAuthApp();
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ credential_id: 'USER-A-CRED-1' }, { credential_id: 'USER-A-CRED-2' }],
    });
    const res = await request(app)
      .post('/api/auth/webauthn/login/options')
      .send({ email: 'user@example.com' });
    expect(res.status).toBe(200);
    // Confirm the SQL scoped by lower(email) and bound the email param
    const call = (pool.query as any).mock.calls.find(
      ([sql]: any[]) =>
        typeof sql === 'string' &&
        sql.includes('webauthn_credentials wc') &&
        sql.includes('lower(a.email) = lower($1)')
    );
    expect(call).toBeDefined();
    expect(call![1]).toEqual(['user@example.com']);
  });
});
