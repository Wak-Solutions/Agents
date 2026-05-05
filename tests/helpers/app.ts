/**
 * helpers/app.ts — Minimal Express app factory for integration tests.
 *
 * Creates a fresh Express instance and wires up session middleware so routes
 * that call requireAuth / requireAdmin work correctly. The session store is
 * in-memory (MemoryStore) — no database required.
 *
 * Usage:
 *   const { app, setSession } = buildApp();
 *   registerFooRoutes(app);
 *   const agent = request(app);
 */

import express from 'express';
import session from 'express-session';

export interface TestSession {
  authenticated?: boolean;
  agentId?: number;
  companyId?: number;
  role?: string;
  agentName?: string;
  isActive?: boolean;
}

/**
 * Build a test Express app.
 *
 * Returns:
 *   app        — the Express application (pass to supertest)
 *   setSession — call before a request to inject session data onto the next hit
 */
export function buildApp() {
  const app = express();
  app.use(express.json());

  // Shared session state that middleware below will inject
  let pendingSession: TestSession | null = null;

  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );

  // Middleware that injects the pending session before every handler.
  // isActive defaults to true for authenticated sessions so tests that
  // don't explicitly set it still pass requireAuth without a DB round-trip.
  app.use((req: any, _res, next) => {
    if (pendingSession) {
      Object.assign(req.session, pendingSession);
      if (req.session.authenticated && req.session.isActive === undefined) {
        req.session.isActive = true;
      }
      pendingSession = null;
    }
    next();
  });

  const setSession = (s: TestSession) => {
    pendingSession = s;
  };

  return { app, setSession };
}

/** Pre-built authenticated admin session. */
export const adminSession: TestSession = {
  authenticated: true,
  agentId: 1,
  companyId: 1,
  role: 'admin',
  agentName: 'Test Admin',
  isActive: true,
};

/** Pre-built authenticated agent (non-admin) session. */
export const agentSession: TestSession = {
  authenticated: true,
  agentId: 2,
  companyId: 1,
  role: 'agent',
  agentName: 'Test Agent',
  isActive: true,
};
