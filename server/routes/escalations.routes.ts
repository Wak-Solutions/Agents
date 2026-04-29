/**
 * escalations.routes.ts — Escalation management routes.
 *
 * Handles: list open escalations, create (from bot webhook), close,
 * list unassigned, claim (agent), and force-assign (admin).
 */

import { z } from 'zod';
import type { Express } from 'express';

import { pool } from '../db';
import { storage } from '../storage';
import { requireAuth, requireAdmin, requireWebhookSecret } from '../middleware/auth';
import { notifyAdmins } from '../push';
import { sendSurveyToCustomer } from '../surveys';
import { createLogger } from '../lib/logger';
import { api } from '@shared/routes';

const logger = createLogger('escalations');

export function registerEscalationRoutes(app: Express): void {

  // ESCALATION — hidden for now

  // // GET /api/escalations — list open escalations
  // app.get(api.escalations.list.path, requireAuth, async (req: any, res: any) => {
  //   try {
  //     const companyId = req.session.companyId;
  //     const result = await pool.query(
  //       `SELECT * FROM escalations WHERE status IN ('open','in_progress') AND company_id = $1 ORDER BY created_at DESC`,
  //       [companyId]
  //     );
  //     res.json(result.rows);
  //   } catch (err: any) {
  //     logger.error('getOpenEscalations failed', err.message);
  //     res.status(500).json({ message: 'Internal error' });
  //   }
  // });

  // // POST /api/escalate — called by the Python bot via webhook
  // app.post(api.escalations.escalate.path, requireWebhookSecret, async (req: any, res: any) => {
  //   try {
  //     const data = api.escalations.escalate.input.parse(req.body);
  //     const companyId = parseInt(req.body.company_id);
  //     if (!companyId) return res.status(400).json({ message: 'company_id is required' });
  //     const result = await pool.query(
  //       `INSERT INTO escalations (customer_phone, escalation_reason, status, company_id)
  //        VALUES ($1, $2, $3, $4) RETURNING *`,
  //       [data.customer_phone, data.escalation_reason, 'open', companyId]
  //     );
  //     const escalation = result.rows[0];
  //     logger.info('Escalation created', `phone: ****${data.customer_phone.slice(-4)}`);
  //     await notifyAdmins({
  //       title: 'Customer requesting agent — WAK',
  //       body: `${data.customer_phone} wants to speak to a human`,
  //       url: '/inbox',
  //     });
  //     res.json(escalation);
  //   } catch (err: any) {
  //     logger.error('createEscalation failed', err.message);
  //     res.status(400).json({ message: err.message });
  //   }
  // });

  // // POST /api/close — close an escalation and fire post-chat survey
  // app.post(api.escalations.close.path, requireAuth, async (req: any, res: any) => {
  //   try {
  //     const { customer_phone } = api.escalations.close.input.parse(req.body);

  //     const companyId = req.session.companyId;
  //     const escRes = await pool.query(
  //       `SELECT id, assigned_agent_id FROM escalations WHERE customer_phone=$1 AND company_id=$2 LIMIT 1`,
  //       [customer_phone, companyId]
  //     );
  //     const escalationId: number | null = escRes.rows[0]?.id ?? null;
  //     const agentId: number | null = (req.session.agentId as number | null) ?? escRes.rows[0]?.assigned_agent_id ?? null;

  //     await pool.query(
  //       `UPDATE escalations SET status='closed' WHERE customer_phone=$1 AND company_id=$2`,
  //       [customer_phone, companyId]
  //     );
  //     logger.info('Escalation closed', `phone: ****${customer_phone.slice(-4)}, agentId: ${agentId}`);

  //     // Send post-chat survey (fire-and-forget)
  //     sendSurveyToCustomer(customer_phone, agentId, escalationId);

  //     res.json({ success: true });
  //   } catch (err: any) {
  //     logger.error('closeEscalation failed', err.message);
  //     res.status(400).json({ message: err.message });
  //   }
  // });

  // // GET /api/escalations/unassigned — any authenticated agent
  // app.get('/api/escalations/unassigned', requireAuth, async (req: any, res: any) => {
  //   try {
  //     const companyId = req.session.companyId;
  //     const result = await pool.query(`
  //       SELECT e.*, a.name AS assigned_agent_name
  //       FROM escalations e
  //       LEFT JOIN agents a ON a.id = e.assigned_agent_id
  //       WHERE e.status = 'open' AND e.assigned_agent_id IS NULL AND e.company_id = $1
  //       ORDER BY e.created_at ASC
  //     `, [companyId]);
  //     res.json(result.rows);
  //   } catch (err: any) {
  //     logger.error('getUnassignedEscalations failed', err.message);
  //     res.status(500).json({ message: 'Internal error' });
  //   }
  // });

  // // PATCH /api/escalations/:phone/claim — agent claims a chat
  // app.patch('/api/escalations/:phone/claim', requireAuth, async (req: any, res: any) => {
  //   try {
  //     const phone = decodeURIComponent(req.params.phone);
  //     const agentId = req.session.agentId;
  //     if (!agentId) return res.status(400).json({ message: 'No agent session found.' });

  //     const companyId = req.session.companyId;
  //     const current = await pool.query(
  //       `SELECT assigned_agent_id FROM escalations WHERE customer_phone=$1 AND company_id=$2`,
  //       [phone, companyId]
  //     );
  //     if (current.rows.length === 0) return res.status(404).json({ message: 'Escalation not found.' });
  //     if (current.rows[0].assigned_agent_id && current.rows[0].assigned_agent_id !== agentId) {
  //       logger.warn('Claim rejected — already assigned', `phone: ****${phone.slice(-4)}, agentId: ${agentId}`);
  //       return res.status(409).json({ message: 'This chat is already assigned to another agent.' });
  //     }

  //     await pool.query(
  //       `UPDATE escalations SET assigned_agent_id=$1, status='in_progress' WHERE customer_phone=$2 AND company_id=$3`,
  //       [agentId, phone, companyId]
  //     );
  //     logger.info('Escalation claimed', `phone: ****${phone.slice(-4)}, agentId: ${agentId}`);
  //     res.json({ success: true });
  //   } catch (err: any) {
  //     logger.error('claimEscalation failed', err.message);
  //     res.status(500).json({ message: 'Internal error' });
  //   }
  // });

  // // PATCH /api/escalations/:phone/assign — admin force-assign
  // app.patch('/api/escalations/:phone/assign', requireAdmin, async (req: any, res: any) => {
  //   try {
  //     const phone = decodeURIComponent(req.params.phone);
  //     const { agentId } = z.object({ agentId: z.number().nullable() }).parse(req.body);
  //     const companyId = req.session.companyId;
  //     await pool.query(
  //       `UPDATE escalations SET assigned_agent_id=$1 WHERE customer_phone=$2 AND company_id=$3`,
  //       [agentId, phone, companyId]
  //     );
  //     logger.info('Escalation assigned', `phone: ****${phone.slice(-4)}, agentId: ${agentId}`);
  //     res.json({ success: true });
  //   } catch (err: any) {
  //     logger.error('assignEscalation failed', err.message);
  //     res.status(500).json({ message: 'Internal error' });
  //   }
  // });
}
