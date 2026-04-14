/**
 * chatbot-config.test.ts — Tests for system prompt configuration routes.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), on: vi.fn() },
  db: {},
}));

import { pool } from '../server/db';
import { adminSession, buildApp } from './helpers/app';

async function buildConfigApp() {
  const { app, setSession } = buildApp();
  (pool.query as any).mockResolvedValue({ rows: [] });
  const { registerChatbotConfigRoutes } = await import('../server/routes/chatbot-config.routes');
  await registerChatbotConfigRoutes(app as any);
  return { app, setSession };
}

describe('GET /api/chatbot-config', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session or webhook secret', async () => {
    const { app } = await buildConfigApp();
    const res = await request(app).get('/api/chatbot-config');
    expect(res.status).toBe(401);
  });

  it('returns prompt with authenticated session', async () => {
    const { app, setSession } = await buildConfigApp();
    (pool.query as any).mockResolvedValue({
      rows: [{ system_prompt: 'You are a helpful assistant.', structured_config: null }],
    });
    setSession(adminSession);
    const res = await request(app).get('/api/chatbot-config');
    expect(res.status).toBe(200);
  });

  it('returns prompt with valid webhook secret (Python bot access)', async () => {
    process.env.WEBHOOK_SECRET = 'test-secret';
    const { app } = await buildConfigApp();
    (pool.query as any).mockResolvedValue({
      rows: [{ system_prompt: 'Prompt for bot.', structured_config: null }],
    });
    const res = await request(app)
      .get('/api/chatbot-config?company_id=1')
      .set('x-webhook-secret', 'test-secret');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/chatbot-config/preview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildConfigApp();
    const res = await request(app)
      .post('/api/chatbot-config/preview')
      .send({ businessName: 'ACME', tone: 'Professional' });
    expect(res.status).toBe(401);
  });

  it('returns compiled prompt text with session', async () => {
    // Route reads req.body.structured_config, not flat body fields
    const { app, setSession } = await buildConfigApp();
    setSession(adminSession);
    const res = await request(app)
      .post('/api/chatbot-config/preview')
      .send({ structured_config: { businessName: 'ACME Corp', tone: 'Friendly', greeting: 'Hello!' } });
    expect(res.status).toBe(200);
    expect(typeof res.body.prompt).toBe('string');
    expect(res.body.prompt).toContain('ACME Corp');
  });
});

describe('POST /api/chatbot-config', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without session', async () => {
    const { app } = await buildConfigApp();
    const res = await request(app)
      .post('/api/chatbot-config')
      .send({ system_prompt: 'New prompt' });
    expect(res.status).toBe(401);
  });

  it('saves config and returns success', async () => {
    const { app, setSession } = await buildConfigApp();
    (pool.query as any).mockResolvedValue({ rows: [] });
    setSession(adminSession);
    const res = await request(app)
      .post('/api/chatbot-config')
      .send({ system_prompt: 'Updated prompt', businessName: 'WAK' });
    expect(res.status).toBe(200);
  });
});
