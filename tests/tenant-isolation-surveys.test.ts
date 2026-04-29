/**
 * tenant-isolation-surveys.test.ts — Tests for TEN-015 and TEN-016.
 *
 * TEN-015: survey_answers INSERT throws on null company_id instead of ?? 1
 * TEN-016: question UPDATE/DELETE include company_id in WHERE clause
 *
 * This file does NOT mock '../server/surveys' so the real route handlers run.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), connect: vi.fn(), on: vi.fn() },
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

vi.mock('../server/routes/settings.routes', () => ({
  getCompanyBranding: vi.fn().mockResolvedValue({ appUrl: 'https://app.example.com', brandName: 'Acme' }),
  registerSettingsRoutes: vi.fn(),
  getWorkHours: vi.fn().mockResolvedValue({}),
}));

import { pool } from '../server/db';
import { adminSession, buildApp } from './helpers/app';
import { requireAdmin, requireAuth } from '../server/middleware/auth';

async function buildSurveysApp() {
  const { app, setSession } = buildApp();
  // Mock connect() client for transaction tests
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  (pool as any).connect = vi.fn().mockResolvedValue(mockClient);
  (pool.query as any).mockResolvedValue({ rows: [] });
  const { registerSurveyRoutes, ensureSurveyTables } = await import('../server/surveys');
  await ensureSurveyTables();
  registerSurveyRoutes(app as any, requireAuth, requireAdmin);
  return { app, setSession, mockClient };
}

/* ─────────────────────────────────────────────────────────────────────────────
   TEN-015 — survey_answers INSERT guards against null company_id
───────────────────────────────────────────────────────────────────────────── */

describe('TEN-015 — survey_answers INSERT', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when survey_response has null company_id (guard instead of ?? 1)', async () => {
    const { app } = await buildSurveysApp();
    (pool.query as any)
      .mockResolvedValueOnce({
        rows: [{ id: 5, survey_id: 1, submitted: false, expires_at: new Date(Date.now() + 86400000), company_id: null }],
      });
    const res = await request(app)
      .post('/api/survey/valid-token/submit')
      .send({ answers: [{ question_id: 1, answer_text: 'Great!' }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/company_id/i);
  });

  it('inserts with the actual company_id from the response row (not 1)', async () => {
    const { app } = await buildSurveysApp();
    (pool.query as any)
      .mockResolvedValueOnce({
        rows: [{ id: 5, survey_id: 1, submitted: false, expires_at: new Date(Date.now() + 86400000), company_id: 7 }],
      })
      .mockResolvedValueOnce({ rows: [] }) // INSERT survey_answers
      .mockResolvedValueOnce({ rows: [] }); // UPDATE submitted
    await request(app)
      .post('/api/survey/valid-token/submit')
      .send({ answers: [{ question_id: 1, answer_text: 'Great!' }] });
    const insertCall = (pool.query as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO survey_answers')
    );
    expect(insertCall).toBeTruthy();
    // Last param is company_id — must be 7 (the row value), not 1 (the old ?? 1 fallback)
    const params: any[] = insertCall[1];
    expect(params[params.length - 1]).toBe(7);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   TEN-016 — question mutations include company_id in WHERE
───────────────────────────────────────────────────────────────────────────── */

describe('TEN-016 — question mutation company_id scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('question UPDATE SQL includes company_id in WHERE clause', async () => {
    const { app, setSession } = await buildSurveysApp();
    setSession(adminSession);
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })  // survey ownership check
      .mockResolvedValueOnce({ rows: [{ id: 42, question_text: 'Updated?', question_type: 'yes_no', order_index: 0 }] }); // update
    await request(app)
      .put('/api/surveys/1/questions/42')
      .send({ question_text: 'Updated?', question_type: 'yes_no', order_index: 0 });
    const updateCall = (pool.query as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE survey_questions')
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[0]).toContain('company_id');
    // adminSession.companyId = 1 is in the params
    expect(updateCall[1]).toContain(1);
  });

  it('question DELETE SQL includes company_id in WHERE clause', async () => {
    const { app, setSession } = await buildSurveysApp();
    setSession(adminSession);
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })  // survey ownership check
      .mockResolvedValueOnce({ rows: [] });             // delete
    await request(app).delete('/api/surveys/1/questions/42');
    const deleteCall = (pool.query as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE FROM survey_questions')
    );
    expect(deleteCall).toBeTruthy();
    expect(deleteCall[0]).toContain('company_id');
    expect(deleteCall[1]).toContain(1); // adminSession companyId
  });

  it('question reorder UPDATE SQL includes company_id in WHERE clause', async () => {
    const { app, setSession, mockClient } = await buildSurveysApp();
    setSession(adminSession);
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // survey ownership check
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockResolvedValueOnce({ rows: [] })  // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    await request(app)
      .put('/api/surveys/1/questions/reorder')
      .send([{ id: 42, order_index: 0 }]);
    const updateCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE survey_questions')
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[0]).toContain('company_id');
    expect(updateCall[1]).toContain(1); // adminSession companyId
  });
});
