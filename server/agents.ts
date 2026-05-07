import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from './db';
import { createLogger } from './lib/logger';

const logger = createLogger('agents');

// ── Schema migration + default admin seed ─────────────────────────────────────

export async function ensureAgentsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id                  SERIAL PRIMARY KEY,
      name                TEXT NOT NULL,
      email               TEXT UNIQUE NOT NULL,
      password_hash       TEXT NOT NULL,
      role                TEXT NOT NULL DEFAULT 'agent',
      is_active           BOOLEAN DEFAULT true,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      last_login          TIMESTAMPTZ,
      webauthn_credential JSONB
    )
  `);
  await pool.query(`
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ DEFAULT NULL
  `);
  await pool.query(`
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS company_id INTEGER DEFAULT 1 REFERENCES companies(id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_agents_company ON agents(company_id)
  `);
  await pool.query(`
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS assigned_agent_id INTEGER REFERENCES agents(id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_escalations_assigned ON escalations(assigned_agent_id)
  `);

  // Seed default admin from DASHBOARD_PASSWORD + SEED_ADMIN_EMAIL if no agents exist.
  // Refuses to seed with any known-weak or reused credential strings.
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM agents');
  if (count.rows[0].n === 0 && process.env.DASHBOARD_PASSWORD) {
    const seedEmail = process.env.SEED_ADMIN_EMAIL;
    const seedPw = process.env.DASHBOARD_PASSWORD;
    const WEAK_PASSWORDS = new Set([
      'w@k.2026.Dev', 'change_me', 'change_me_immediately', 'password',
      'admin', 'admin123', '123456',
    ]);
    if (!seedEmail) {
      logger.warn('SEED_ADMIN_EMAIL not set — skipping default admin seed');
    } else if (seedPw.length < 16 || WEAK_PASSWORDS.has(seedPw)) {
      logger.error(
        'DASHBOARD_PASSWORD is too weak or is a known default — refusing to seed admin. ' +
        'Set a strong unique password (≥16 chars) and restart.'
      );
    } else {
      const hash = await bcrypt.hash(seedPw, 10);
      await pool.query(
        `INSERT INTO agents (name, email, password_hash, role, company_id) VALUES ($1, $2, $3, 'admin', 1)`,
        ['Admin', seedEmail, hash]
      );
      logger.info('Default admin seeded', `email: ${seedEmail}`);
    }
  }
}

// ── Route registration ─────────────────────────────────────────────────────────

export function registerAgentRoutes(app: any, requireAdmin: any, requireAuth: any): void {

  // POST /api/agents/accept-terms — any authenticated agent accepts T&C
  app.post('/api/agents/accept-terms', requireAuth, async (req: any, res: any) => {
    try {
      const agentId = req.session.agentId;
      const companyId: number = req.companyId;
      if (!agentId) return res.status(400).json({ message: 'No agent ID in session' });
      const result = await pool.query(
        `UPDATE agents SET terms_accepted_at = NOW() WHERE id = $1 AND company_id = $2 RETURNING terms_accepted_at`,
        [agentId, companyId]
      );
      const acceptedAt = result.rows[0]?.terms_accepted_at
        ? new Date(result.rows[0].terms_accepted_at).toISOString()
        : new Date().toISOString();
      // Persist in session so /api/me never falls back to the DB for this
      (req.session as any).termsAcceptedAt = acceptedAt;
      req.session.save(() => {});
      res.json({ success: true, termsAcceptedAt: acceptedAt });
    } catch (err: any) {
      logger.error('acceptTerms failed', `agentId: ${req.session?.agentId}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // GET /api/agents/workload — must be before /api/agents/:id
  app.get('/api/agents/workload', requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
      const result = await pool.query(`
        SELECT
          a.id   AS agent_id,
          a.name,
          a.is_active,
          COUNT(e.customer_phone) FILTER (WHERE e.status = 'open' AND e.company_id = $1)::int  AS active_chats,
          COUNT(e.customer_phone) FILTER (
            WHERE e.status = 'closed' AND e.company_id = $1 AND e.created_at >= CURRENT_DATE
          )::int AS resolved_today,
          COUNT(e.customer_phone) FILTER (
            WHERE e.status = 'closed' AND e.company_id = $1 AND e.created_at >= DATE_TRUNC('week', NOW())
          )::int AS resolved_this_week,
          COUNT(e.customer_phone) FILTER (WHERE e.status = 'closed' AND e.company_id = $1)::int AS total_resolved,
          COUNT(m2.id)::int AS meetings_completed
        FROM agents a
        LEFT JOIN escalations e ON e.assigned_agent_id = a.id
        LEFT JOIN meetings m2 ON m2.agent_id = a.id AND m2.status = 'completed' AND m2.company_id = $1
        WHERE a.company_id = $1
        GROUP BY a.id, a.name, a.is_active
        ORDER BY a.name
      `, [companyId]);
      res.json(result.rows);
    } catch (err: any) {
      logger.error('getWorkload failed', `companyId: ${req.companyId}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // GET /api/agents
  app.get('/api/agents', requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
      const period = ['today', 'week', 'month', 'all'].includes(req.query.period)
        ? req.query.period : 'all';
      const dateFilter =
        period === 'today' ? `AND e.created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')` :
        period === 'week'  ? `AND e.created_at >= DATE_TRUNC('week', NOW() AT TIME ZONE 'UTC')` :
        period === 'month' ? `AND e.created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')` :
        '';
      // Pre-aggregate the per-agent meetings_completed and avg_survey_rating in
      // CTEs so they run as a single scan per metric instead of one correlated
      // subquery per agent (was N+1 for N agents). The LEFT JOIN below leaves
      // agents with no matching rows producing NULL — same as the original
      // subqueries' behavior for avg_survey_rating; meetings_completed is
      // COALESCEd to 0 to match the original `COUNT(*)::int` returning 0.
      const result = await pool.query(`
        WITH meetings_per_agent AS (
          SELECT m.agent_id, COUNT(*)::int AS meetings_completed
          FROM meetings m
          WHERE m.status = 'completed' AND m.company_id = $1
          GROUP BY m.agent_id
        ),
        survey_per_agent AS (
          SELECT sr.agent_id, ROUND(AVG(sa.answer_rating)::numeric, 1) AS avg_survey_rating
          FROM survey_answers sa
          JOIN survey_responses sr ON sr.id = sa.response_id
          WHERE sr.company_id = $1 AND sa.answer_rating IS NOT NULL
          GROUP BY sr.agent_id
        )
        SELECT
          a.id, a.name, a.email, a.role, a.is_active, a.last_login,
          COUNT(e.customer_phone) FILTER (
            WHERE e.status = 'closed' AND e.company_id = $1 ${dateFilter}
          )::int AS resolved_chats,
          COALESCE(mc.meetings_completed, 0) AS meetings_completed,
          sp.avg_survey_rating AS avg_survey_rating
        FROM agents a
        LEFT JOIN escalations e ON e.assigned_agent_id = a.id
        LEFT JOIN meetings_per_agent mc ON mc.agent_id = a.id
        LEFT JOIN survey_per_agent sp ON sp.agent_id = a.id
        WHERE a.company_id = $1
        GROUP BY a.id, mc.meetings_completed, sp.avg_survey_rating
        ORDER BY a.created_at
      `, [companyId]);
      res.json(result.rows);
    } catch (err: any) {
      logger.error('listAgents failed', `companyId: ${req.companyId}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // POST /api/agents — create new agent
  app.post('/api/agents', requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
      const { name, email, password, role } = z.object({
        name:     z.string().min(1),
        email:    z.string().email(),
        password: z.string().min(8).max(128),
        role:     z.enum(['agent', 'admin']),
      }).parse(req.body);
      const hash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        `INSERT INTO agents (name, email, password_hash, role, company_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email, role, is_active, created_at`,
        [name, email, hash, role, companyId]
      );
      logger.info('Agent created', `agentId: ${result.rows[0].id}, role: ${role}`);
      res.status(201).json(result.rows[0]);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: 'Invalid input' });
      if (err.code === '23505') return res.status(409).json({ message: 'Email already in use.' });
      logger.error('createAgent failed', `companyId: ${req.companyId}, actorAgentId: ${req.session?.agentId}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // PUT /api/agents/:id — update name/email/role
  app.put('/api/agents/:id', requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
      const { name, email, role } = z.object({
        name:  z.string().min(1),
        email: z.string().email(),
        role:  z.enum(['agent', 'admin']),
      }).parse(req.body);
      const result = await pool.query(
        `UPDATE agents SET name=$1, email=$2, role=$3 WHERE id=$4 AND company_id=$5
         RETURNING id, name, email, role, is_active`,
        [name, email, role, req.params.id, companyId]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Agent not found' });
      res.json(result.rows[0]);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: 'Invalid input' });
      logger.error('updateAgent failed', `companyId: ${req.companyId}, targetAgentId: ${req.params?.id}, actorAgentId: ${req.session?.agentId}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // PATCH /api/agents/:id/deactivate
  app.patch('/api/agents/:id/deactivate', requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
      const id = parseInt(req.params.id);
      if (req.session.agentId === id) {
        return res.status(400).json({ message: 'You cannot deactivate your own account.' });
      }
      const agentRes = await pool.query(
        `SELECT role FROM agents WHERE id=$1 AND company_id=$2`,
        [id, companyId]
      );
      if (agentRes.rows.length === 0) return res.status(404).json({ message: 'Agent not found' });
      if (agentRes.rows[0].role === 'admin') {
        const adminCount = await pool.query(
          `SELECT COUNT(*)::int AS n FROM agents WHERE role='admin' AND is_active=true AND id!=$1 AND company_id=$2`,
          [id, companyId]
        );
        if (adminCount.rows[0].n === 0) {
          return res.status(400).json({ message: 'Cannot deactivate the last active admin.' });
        }
      }
      await pool.query(`UPDATE agents SET is_active=false WHERE id=$1 AND company_id=$2`, [id, companyId]);
      // Purge all live sessions for this agent so lockout is immediate,
      // not deferred until their next request hits requireAuth.
      await pool.query(`DELETE FROM session WHERE sess->>'agentId' = $1::text`, [id]);
      logger.info('Agent deactivated', `agentId: ${id}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('deactivateAgent failed', `agentId: ${req.params.id}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // PATCH /api/agents/:id/activate
  app.patch('/api/agents/:id/activate', requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
      const result = await pool.query(
        `UPDATE agents SET is_active=true WHERE id=$1 AND company_id=$2 RETURNING id`,
        [req.params.id, companyId]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Agent not found' });
      res.json({ success: true });
    } catch (err: any) {
      logger.error('activateAgent failed', `agentId: ${req.params.id}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // PATCH /api/agents/:id/reset-password
  app.patch('/api/agents/:id/reset-password', requireAdmin, async (req: any, res: any) => {
    try {
      const companyId: number = req.companyId;
      const { new_password } = z.object({ new_password: z.string().min(8).max(128) }).parse(req.body);
      const hash = await bcrypt.hash(new_password, 10);
      const result = await pool.query(
        `UPDATE agents SET password_hash=$1 WHERE id=$2 AND company_id=$3 RETURNING id`,
        [hash, req.params.id, companyId]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Agent not found' });
      res.json({ success: true });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: 'Invalid input' });
      logger.error('resetAgentPassword failed', `companyId: ${req.companyId}, targetAgentId: ${req.params?.id}, actorAgentId: ${req.session?.agentId}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });
}
