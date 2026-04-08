/**
 * routes.ts — Route registration orchestrator.
 *
 * This file is intentionally thin. Every domain has its own routes file:
 *
 *   routes/auth.routes.ts           — login, logout, /me, WebAuthn
 *   routes/escalations.routes.ts    — escalation lifecycle + assignment
 *   routes/messages.routes.ts       — messages, voice notes, incoming webhook
 *   routes/inbox.routes.ts          — conversations list + unified inbox
 *   routes/meetings.routes.ts       — booking tokens, calendar, public booking
 *   routes/chatbot-config.routes.ts — system prompt management
 *   routes/statistics.routes.ts     — metrics + AI summary
 *   routes/customers.routes.ts      — customer journey + contacts CRUD
 *   routes/push.routes.ts           — Web Push subscriptions
 *
 *   agents.ts                       — multi-agent CRUD (registerAgentRoutes)
 *   surveys.ts                      — survey management (registerSurveyRoutes)
 */

import type { Express } from 'express';
import { createServer, type Server } from 'http';
import { pool } from './db';

import { registerAuthRoutes }          from './routes/auth.routes';
import { registerEscalationRoutes }    from './routes/escalations.routes';
import { registerMessageRoutes }       from './routes/messages.routes';
import { registerInboxRoutes }         from './routes/inbox.routes';
import { registerMeetingRoutes }       from './routes/meetings.routes';
import { registerChatbotConfigRoutes } from './routes/chatbot-config.routes';
import { registerStatisticsRoutes }    from './routes/statistics.routes';
import { registerCustomerRoutes }      from './routes/customers.routes';
import { registerPushRoutes }          from './routes/push.routes';
import { registerRegistrationRoutes, ensureOnboardingColumns } from './routes/register.routes';
import { ensureAgentsTable, registerAgentRoutes } from './agents';
import { ensureSurveyTables, registerSurveyRoutes } from './surveys';
import { requireAuth, requireAdmin }   from './middleware/auth';

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── Startup migrations ────────────────────────────────────────────────────
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_meetings_meeting_token ON meetings(meeting_token)`
  );
  await ensureAgentsTable();
  await ensureSurveyTables();
  await ensureOnboardingColumns();

  // ── Route modules ─────────────────────────────────────────────────────────
  await registerAuthRoutes(app);
  registerRegistrationRoutes(app);
  registerInboxRoutes(app);
  registerEscalationRoutes(app);
  registerMessageRoutes(app);
  await registerChatbotConfigRoutes(app);
  registerMeetingRoutes(app);
  registerStatisticsRoutes(app);
  registerCustomerRoutes(app);
  registerPushRoutes(app);
  registerSurveyRoutes(app, requireAuth);
  registerAgentRoutes(app, requireAdmin, requireAuth);

  return httpServer;
}
