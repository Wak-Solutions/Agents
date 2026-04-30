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

vi.mock('../server/lib/whatsapp', () => ({
  sendWhatsAppText: vi.fn().mockResolvedValue(true),
}));

vi.mock('../server/routes/settings.routes', () => ({
  getCompanyBranding: vi.fn().mockResolvedValue({ appUrl: 'https://app.example.com', brandName: 'ACME' }),
  registerSettingsRoutes: vi.fn(),
  getWorkHours: vi.fn().mockResolvedValue({}),
}));

import { pool } from '../server/db';
import { requireAdmin, requireAuth } from '../server/middleware/auth';
import { adminSession, buildApp } from './helpers/app';
import { sendWhatsAppText } from '../server/lib/whatsapp';
import { getCompanyBranding } from '../server/routes/settings.routes';

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

// ── sendSurveyToCustomer unit tests ──────────────────────────────────────────

describe('sendSurveyToCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (pool.query as any).mockReset();
  });

  it('calls sendWhatsAppText with the customer phone and a message containing the survey link', async () => {
    const { sendSurveyToCustomer } = await import('../server/surveys');
    // survey lookup returns an active survey; INSERT returns nothing relevant
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })  // SELECT active survey
      .mockResolvedValueOnce({ rows: [] });            // INSERT survey_response

    await sendSurveyToCustomer('971501234567', null, null, 1, 1);

    expect(sendWhatsAppText).toHaveBeenCalledOnce();
    const [passedCompanyId, passedPhone, passedMessage] = (sendWhatsAppText as any).mock.calls[0];
    expect(passedCompanyId).toBe(1);
    expect(passedPhone).toBe('971501234567');
    expect(passedMessage).toContain('https://app.example.com/survey/');
    expect(passedMessage).toContain('ACME');
  });

  it('uses the passed companyId for the survey lookup — not the default 1', async () => {
    const { sendSurveyToCustomer } = await import('../server/surveys');
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 99 }] })
      .mockResolvedValueOnce({ rows: [] });

    await sendSurveyToCustomer('971509999999', null, null, null, 7);

    const surveyQuery = (pool.query as any).mock.calls[0];
    expect(surveyQuery[1]).toContain(7); // companyId=7 in SELECT params
    expect(sendWhatsAppText).toHaveBeenCalledOnce();
    expect((sendWhatsAppText as any).mock.calls[0][0]).toBe(7); // passed to sendWhatsAppText
  });

  it('does not send if no active survey exists for the company', async () => {
    const { sendSurveyToCustomer } = await import('../server/surveys');
    (pool.query as any).mockResolvedValueOnce({ rows: [] }); // no active survey

    await sendSurveyToCustomer('971501234567', null, null, null, 1);

    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('does not throw if getCompanyBranding fails — still sends message with fallback branding', async () => {
    const { sendSurveyToCustomer } = await import('../server/surveys');
    (getCompanyBranding as any).mockRejectedValueOnce(new Error('app_url not set'));
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(sendSurveyToCustomer('971501234567', null, null, 1, 1)).resolves.not.toThrow();
    // Should still send — with fallback brandName and no link
    expect(sendWhatsAppText).toHaveBeenCalledOnce();
    const message = (sendWhatsAppText as any).mock.calls[0][2];
    expect(message).toContain('Our team');
  });
});
