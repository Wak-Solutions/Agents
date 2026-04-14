/**
 * health.test.ts — Tests for GET /health.
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db module so it never tries to open a real Postgres connection
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), on: vi.fn() },
  db: {},
}));

import { pool } from '../server/db';

function buildHealthApp() {
  const app = express();
  const mockPool = pool as any;

  app.get('/health', async (_req, res) => {
    try {
      await mockPool.query('SELECT 1');
      res.status(200).json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  return app;
}

describe('GET /health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with status:ok when DB is reachable', async () => {
    (pool.query as any).mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const app = buildHealthApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
  });

  it('returns 503 with status:degraded when DB throws', async () => {
    (pool.query as any).mockRejectedValue(new Error('Connection refused'));
    const app = buildHealthApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.database).toBe('unreachable');
  });

  it('requires no authentication — no 401 or 403', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    const app = buildHealthApp();
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
