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
import rateLimit from 'express-rate-limit';
import { pool } from './db';

import { registerAuthRoutes }          from './routes/auth.routes';
import { registerEscalationRoutes }    from './routes/escalations.routes';
import { registerMessageRoutes }       from './routes/messages.routes';
import { registerInboxRoutes }         from './routes/inbox.routes';
import { registerMeetingRoutes, ensureBlockedSlotsCompanyId } from './routes/meetings.routes';
import { registerSettingsRoutes, ensureWorkHoursColumn } from './routes/settings.routes';
import { registerChatbotConfigRoutes } from './routes/chatbot-config.routes';
import { registerStatisticsRoutes }    from './routes/statistics.routes';
import { registerCustomerRoutes }      from './routes/customers.routes';
import { registerPushRoutes }          from './routes/push.routes';
import { registerRegistrationRoutes, ensureOnboardingColumns } from './routes/register.routes';
import { ensureConfigTable, getTrialDays, getCompanyTrialStatus } from './lib/trial';
import { ensureContactCompanies } from './lib/contacts-migration';
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

  // Composite indexes for the hottest query patterns (company_id scoping).
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_company_phone
    ON messages(company_id, customer_phone)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_company_created
    ON messages(company_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_escalations_company_phone
    ON escalations(company_id, customer_phone)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_meetings_company_status
    ON meetings(company_id, status)`);

  // Drop the duplicate escalations index left by a double-migration.
  await pool.query(`DROP INDEX IF EXISTS idx_escalations_assigned`);

  // Fix the one_active_survey unique index: the original has no company_id
  // scope, which prevents more than one company from having an active survey.
  // Replace it with a per-company partial unique index.
  await pool.query(`DROP INDEX IF EXISTS one_active_survey`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS one_active_survey_per_company
    ON surveys(company_id) WHERE is_active = true`);

  await ensureConfigTable();
  await ensureAgentsTable();
  await ensureSurveyTables();
  await ensureOnboardingColumns();
  await ensureBlockedSlotsCompanyId(); // multi-tenant isolation: scope blocked_slots to company
  await ensureWorkHoursColumn();       // per-company working hours
  await ensureContactCompanies();      // join-table linking contacts to companies

  // ── Rate limiting on public-facing endpoints ──────────────────────────────
  // Prevents abuse of the demo booking page, registration, and login.
  const bookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' },
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' },
  });
  app.use('/api/book/', bookingLimiter);
  app.use('/api/register', authLimiter);
  app.use('/api/auth/login', authLimiter);

  // ── Trial config endpoints ────────────────────────────────────────────────
  // Public: lets the landing/register pages render the trial length without
  // hardcoding it. Only returns the number of days, nothing sensitive.
  app.get('/api/config/trial-days', async (_req, res) => {
    try {
      res.json({ trialDays: await getTrialDays() });
    } catch {
      res.status(500).json({ message: 'Failed to load config' });
    }
  });

  // Authenticated: current company's trial status. Always recomputed from
  // the DB so session tampering cannot change the answer.
  app.get('/api/me/trial', async (req: any, res) => {
    if (!req.session.authenticated || !req.session.companyId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
      res.json(await getCompanyTrialStatus(req.session.companyId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

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
  registerSettingsRoutes(app);
  registerSurveyRoutes(app, requireAuth);
  registerAgentRoutes(app, requireAdmin, requireAuth);

  return httpServer;
}
