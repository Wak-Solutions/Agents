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

  it('returns prompt and system_prompt_preview with authenticated session', async () => {
    const { app, setSession } = await buildConfigApp();
    const structuredConfig = {
      businessName: 'ACME Corp',
      tone: 'Professional',
      menuConfig: [{ label: 'Product Inquiry', subItems: ['Robots', 'AI'] }],
    };
    (pool.query as any).mockResolvedValue({
      rows: [{
        system_prompt: 'You are a helpful assistant.',
        structured_config: structuredConfig,
        menu_config: structuredConfig.menuConfig,
        override_active: false,
        demo_conversation: null,
      }],
    });
    setSession(adminSession);
    const res = await request(app).get('/api/chatbot-config');
    expect(res.status).toBe(200);
    expect(typeof res.body.system_prompt_preview).toBe('string');
    expect(res.body.system_prompt_preview).toContain('ACME Corp');
  });

  it('includes numbered main menu in system_prompt_preview', async () => {
    const { app, setSession } = await buildConfigApp();
    const menuConfig = [
      { label: 'Product Inquiry', subItems: ['Robots', 'AI Services'] },
      { label: 'Track Order', subItems: [] },
    ];
    (pool.query as any).mockResolvedValue({
      rows: [{
        system_prompt: '',
        structured_config: { businessName: 'WAK', menuConfig },
        menu_config: menuConfig,
        override_active: false,
        demo_conversation: null,
      }],
    });
    setSession(adminSession);
    const res = await request(app).get('/api/chatbot-config');
    expect(res.status).toBe(200);
    expect(res.body.system_prompt_preview).toContain('1. Product Inquiry');
    expect(res.body.system_prompt_preview).toContain('1.1. Robots');
    expect(res.body.system_prompt_preview).toContain('2. Track Order');
  });

  it('returns prompt with valid webhook secret (Python bot access)', async () => {
    process.env.WEBHOOK_SECRET = 'test-secret';
    const { app } = await buildConfigApp();
    (pool.query as any).mockResolvedValue({
      rows: [{
        system_prompt: 'Prompt for bot.',
        structured_config: null,
        menu_config: [],
        override_active: false,
        demo_conversation: null,
      }],
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
    const { app, setSession } = await buildConfigApp();
    setSession(adminSession);
    const res = await request(app)
      .post('/api/chatbot-config/preview')
      .send({ structured_config: { businessName: 'ACME Corp', tone: 'Friendly', greeting: 'Hello!' } });
    expect(res.status).toBe(200);
    expect(typeof res.body.prompt).toBe('string');
    expect(res.body.prompt).toContain('ACME Corp');
  });

  it('compiles menuConfig into numbered menu in preview', async () => {
    const { app, setSession } = await buildConfigApp();
    setSession(adminSession);
    const res = await request(app)
      .post('/api/chatbot-config/preview')
      .send({
        structured_config: {
          businessName: 'Demo Co',
          menuConfig: [
            { label: 'Services', subItems: ['Consulting', 'Support'] },
            { label: 'Billing', subItems: [] },
          ],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.prompt).toContain('1. Services');
    expect(res.body.prompt).toContain('1.1. Consulting');
    expect(res.body.prompt).toContain('2. Billing');
    expect(res.body.prompt).toContain('Never fabricate');
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

  it('saves config and returns system_prompt_preview', async () => {
    const { app, setSession } = await buildConfigApp();
    const savedRow = {
      id: 1,
      system_prompt: '',
      structured_config: { businessName: 'WAK', menuConfig: [] },
      override_active: false,
      demo_conversation: null,
      updated_at: new Date().toISOString(),
    };
    // First call (SELECT existing): return empty, then INSERT: return savedRow
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [] })    // migration ALTER TABLE calls
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })    // SELECT existing
      .mockResolvedValueOnce({ rows: [savedRow] }); // INSERT
    setSession(adminSession);
    const res = await request(app)
      .post('/api/chatbot-config')
      .send({
        structured_config: { businessName: 'WAK', menuConfig: [] },
        override_active: false,
        raw_prompt: '',
        demo_conversation: null,
      });
    expect(res.status).toBe(200);
    expect(typeof res.body.system_prompt_preview).toBe('string');
  });
});
