/**
 * surveys.test.ts — Tests for survey management and public submission routes.
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
import { requireAdmin, requireAuth } from '../server/middleware/auth';
import { adminSession, buildApp } from './helpers/app';

async function buildSurveysApp() {
  const { app, setSession } = buildApp();
  (pool.query as any).mockResolvedValue({ rows: [] }); // for ensureSurveyTables
  const { registerSurveyRoutes, ensureSurveyTables } = await import('../server/surveys');
  await ensureSurveyTables();
  // Pass real middleware so auth checks work correctly
  registerSurveyRoutes(app as any, requireAuth, requireAdmin);
  return { app, setSession };
}

describe('GET /api/surveys', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildSurveysApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/surveys');
    expect(res.status).toBe(401);
  });

  it('returns surveys list for authenticated user', async () => {
    const { app, setSession } = await buildSurveysApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    const res = await request(app).get('/api/surveys');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/surveys', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildSurveysApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/surveys')
      .send({ title: 'Post-chat survey', questions: [] });
    expect(res.status).toBe(401);
  });

  it('creates survey and returns 201', async () => {
    const { app, setSession } = await buildSurveysApp();
    (pool.query as any).mockResolvedValue({
      rows: [{ id: 1, title: 'Post-chat survey', is_active: false, company_id: 1 }],
    });
    setSession(adminSession);
    const res = await request(app)
      .post('/api/surveys')
      .send({ title: 'Post-chat survey', questions: [] });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/survey/:token/submit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 410 for unknown or expired token', async () => {
    // Route returns 410 Gone when the survey response row is not found
    const { app } = await buildSurveysApp();
    (pool.query as any).mockResolvedValue({ rows: [] }); // no row found
    const res = await request(app)
      .post('/api/survey/nonexistent-token/submit')
      .send({ answers: [] });
    expect(res.status).toBe(410);
  });

  it('stores submission for valid token', async () => {
    const { app } = await buildSurveysApp();
    (pool.query as any)
      .mockResolvedValueOnce({
        rows: [{ id: 5, survey_id: 1, submitted: false, expires_at: new Date(Date.now() + 86400000), company_id: 1 }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/survey/valid-token/submit')
      .send({ answers: [{ question_id: 1, answer_text: 'Great!' }] });
    expect([200, 201]).toContain(res.status);
  });
});
