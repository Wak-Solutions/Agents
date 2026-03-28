import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from './db';

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
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS assigned_agent_id INTEGER REFERENCES agents(id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_escalations_assigned ON escalations(assigned_agent_id)
  `);

  // Seed default admin from DASHBOARD_PASSWORD if no agents exist
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM agents');
  if (count.rows[0].n === 0 && process.env.DASHBOARD_PASSWORD) {
    const hash = await bcrypt.hash(process.env.DASHBOARD_PASSWORD, 10);
    await pool.query(
      `INSERT INTO agents (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
      ['Admin', 'admin@wak-solutions.com', hash]
    );
    console.log('[agents] Default admin created: admin@wak-solutions.com');
  }
}

// ── Route registration ─────────────────────────────────────────────────────────

export function registerAgentRoutes(app: any, requireAdmin: any, requireAuth: any): void {

  // POST /api/agents/accept-terms — any authenticated agent accepts T&C
  app.post('/api/agents/accept-terms', requireAuth, async (req: any, res: any) => {
    try {
      const agentId = req.session.agentId;
      if (!agentId) return res.status(400).json({ message: 'No agent ID in session' });
      await pool.query(
        `UPDATE agents SET terms_accepted_at = NOW() WHERE id = $1`,
        [agentId]
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/agents/workload — must be before /api/agents/:id
  app.get('/api/agents/workload', requireAdmin, async (_req: any, res: any) => {
    try {
      const result = await pool.query(`
        SELECT
          a.id   AS agent_id,
          a.name,
          a.is_active,
          COUNT(e.customer_phone) FILTER (WHERE e.status = 'open')::int  AS active_chats,
          COUNT(e.customer_phone) FILTER (
            WHERE e.status = 'closed' AND e.created_at >= CURRENT_DATE
          )::int AS resolved_today,
          COUNT(e.customer_phone) FILTER (
            WHERE e.status = 'closed' AND e.created_at >= DATE_TRUNC('week', NOW())
          )::int AS resolved_this_week,
          COUNT(e.customer_phone) FILTER (WHERE e.status = 'closed')::int AS total_resolved,
          (SELECT COUNT(*)::int FROM meetings m WHERE m.agent_id = a.id AND m.status = 'completed') AS meetings_completed
        FROM agents a
        LEFT JOIN escalations e ON e.assigned_agent_id = a.id
        GROUP BY a.id, a.name, a.is_active
        ORDER BY a.name
      `);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/agents
  app.get('/api/agents', requireAdmin, async (req: any, res: any) => {
    try {
      const period = ['today', 'week', 'month', 'all'].includes(req.query.period)
        ? req.query.period : 'all';
      const dateFilter =
        period === 'today' ? `AND e.created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')` :
        period === 'week'  ? `AND e.created_at >= DATE_TRUNC('week', NOW() AT TIME ZONE 'UTC')` :
        period === 'month' ? `AND e.created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')` :
        '';
      const result = await pool.query(`
        SELECT
          a.id, a.name, a.email, a.role, a.is_active, a.last_login,
          COUNT(e.customer_phone) FILTER (
            WHERE e.status = 'closed' ${dateFilter}
          )::int AS resolved_chats,
          (SELECT COUNT(*)::int FROM meetings m
           WHERE m.agent_id = a.id AND m.status = 'completed') AS meetings_completed,
          (SELECT ROUND(AVG(sa.answer_rating)::numeric, 1)
           FROM survey_answers sa
           JOIN survey_responses sr ON sr.id = sa.response_id
           WHERE sr.agent_id = a.id AND sa.answer_rating IS NOT NULL) AS avg_survey_rating
        FROM agents a
        LEFT JOIN escalations e ON e.assigned_agent_id = a.id
        GROUP BY a.id
        ORDER BY a.created_at
      `);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/agents — create new agent
  app.post('/api/agents', requireAdmin, async (req: any, res: any) => {
    try {
      const { name, email, password, role } = z.object({
        name:     z.string().min(1),
        email:    z.string().email(),
        password: z.string().min(6),
        role:     z.enum(['agent', 'admin']),
      }).parse(req.body);
      const hash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        `INSERT INTO agents (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, role, is_active, created_at`,
        [name, email, hash, role]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) {
      if (err.code === '23505') return res.status(409).json({ message: 'Email already in use.' });
      res.status(400).json({ message: err.message });
    }
  });

  // PUT /api/agents/:id — update name/email/role
  app.put('/api/agents/:id', requireAdmin, async (req: any, res: any) => {
    try {
      const { name, email, role } = z.object({
        name:  z.string().min(1),
        email: z.string().email(),
        role:  z.enum(['agent', 'admin']),
      }).parse(req.body);
      const result = await pool.query(
        `UPDATE agents SET name=$1, email=$2, role=$3 WHERE id=$4
         RETURNING id, name, email, role, is_active`,
        [name, email, role, req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Agent not found' });
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // PATCH /api/agents/:id/deactivate
  app.patch('/api/agents/:id/deactivate', requireAdmin, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      if (req.session.agentId === id) {
        return res.status(400).json({ message: 'You cannot deactivate your own account.' });
      }
      const agentRes = await pool.query(`SELECT role FROM agents WHERE id=$1`, [id]);
      if (agentRes.rows.length === 0) return res.status(404).json({ message: 'Agent not found' });
      if (agentRes.rows[0].role === 'admin') {
        const adminCount = await pool.query(
          `SELECT COUNT(*)::int AS n FROM agents WHERE role='admin' AND is_active=true AND id!=$1`,
          [id]
        );
        if (adminCount.rows[0].n === 0) {
          return res.status(400).json({ message: 'Cannot deactivate the last active admin.' });
        }
      }
      await pool.query(`UPDATE agents SET is_active=false WHERE id=$1`, [id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/agents/:id/activate
  app.patch('/api/agents/:id/activate', requireAdmin, async (req: any, res: any) => {
    try {
      const result = await pool.query(
        `UPDATE agents SET is_active=true WHERE id=$1 RETURNING id`,
        [req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Agent not found' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/agents/:id/reset-password
  app.patch('/api/agents/:id/reset-password', requireAdmin, async (req: any, res: any) => {
    try {
      const { new_password } = z.object({ new_password: z.string().min(6) }).parse(req.body);
      const hash = await bcrypt.hash(new_password, 10);
      const result = await pool.query(
        `UPDATE agents SET password_hash=$1 WHERE id=$2 RETURNING id`,
        [hash, req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Agent not found' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });
}
