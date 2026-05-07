/**
 * rate-limit.test.ts — CR-023
 *
 * Verifies that express-rate-limit actually enforces thresholds and returns
 * 429 once the limit is exceeded. Uses a self-contained app with a tight
 * test-only limiter (max:3) so the test completes instantly without needing
 * fake timers or CI-scale request volumes.
 *
 * The production limiters use the same library and options shape so this
 * proves the mechanism works. The key strategy: each test uses a fresh
 * Express app + fresh limiter instance so tests never share rate-limit state.
 */

import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

function buildLimitedApp(max: number, keyPrefix: string) {
  const app = express();
  app.use(express.json());

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max,
    // Explicitly use ipKeyGenerator so express-rate-limit doesn't emit
    // the ERR_ERL_KEY_GEN_IPV6 validation warning in tests.
    keyGenerator: (req: any) => `${keyPrefix}:${ipKeyGenerator(req) ?? req.ip ?? 'unknown'}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests' },
  });

  app.get('/test', limiter, (_req, res) => res.json({ ok: true }));
  return app;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Core rate-limit enforcement
───────────────────────────────────────────────────────────────────────────── */

describe('Rate limiter — basic threshold enforcement', () => {
  it('allows requests up to the max', async () => {
    const app = buildLimitedApp(3, 'basic');
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 on the request immediately after the limit', async () => {
    const app = buildLimitedApp(3, 'exceed');
    for (let i = 0; i < 3; i++) {
      await request(app).get('/test');
    }
    const res = await request(app).get('/test'); // 4th — over limit
    expect(res.status).toBe(429);
  });

  it('429 response body matches the format used by production limiters', async () => {
    const app = buildLimitedApp(1, 'body');
    await request(app).get('/test'); // consume the 1 allowed request
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ message: 'Too many requests' });
  });

  it('sets RateLimit-* standard headers on the last allowed request', async () => {
    const app = buildLimitedApp(5, 'headers');
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    // RFC 6585 / draft-ietf-httpapi-ratelimit-headers-06
    expect(res.headers['ratelimit-limit'] ?? res.headers['x-ratelimit-limit']).toBeDefined();
  });

  it('sets Retry-After or RateLimit-Reset on a 429 response', async () => {
    const app = buildLimitedApp(1, 'retry');
    await request(app).get('/test');
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    // At least one of these must be present so clients can back off
    const hasRetryAfter = 'retry-after' in res.headers;
    const hasReset = 'ratelimit-reset' in res.headers || 'x-ratelimit-reset' in res.headers;
    expect(hasRetryAfter || hasReset).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   Key isolation — different keys don't share quota
───────────────────────────────────────────────────────────────────────────── */

describe('Rate limiter — key isolation', () => {
  it('two different key prefixes each get their own full quota', async () => {
    // Build two apps with the same max but different key prefixes —
    // exhausting one must not affect the other
    const appA = buildLimitedApp(2, 'tenant-a');
    const appB = buildLimitedApp(2, 'tenant-b');

    // Exhaust appA
    await request(appA).get('/test');
    await request(appA).get('/test');
    const blockedA = await request(appA).get('/test');
    expect(blockedA.status).toBe(429);

    // appB should still have its full quota untouched
    const okB = await request(appB).get('/test');
    expect(okB.status).toBe(200);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   Login-equivalent limiter — matches production auth config (max:20)
───────────────────────────────────────────────────────────────────────────── */

describe('Rate limiter — login endpoint simulation', () => {
  it('allows 20 requests and blocks the 21st (mirrors authLimiter max:20)', async () => {
    const MAX = 20;
    const app = buildLimitedApp(MAX, 'login-sim');

    for (let i = 0; i < MAX; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).get('/test'); // 21st
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe('Too many requests');
  });
});
