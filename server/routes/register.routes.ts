/**
 * register.routes.ts — 6-step onboarding/registration flow.
 *
 * Step 1: POST /api/register — create company + admin agent
 * Step 2: PUT /api/register/business — update company business details
 * Step 3: PUT /api/register/whatsapp — store WhatsApp credentials
 * Step 3b: POST /api/register/whatsapp/verify — test creds against Meta API
 * Step 4: PUT /api/register/chatbot — create initial chatbot config
 * Step 5: POST /api/register/invite — invite team members
 * Step 6: POST /api/register/complete — mark onboarding done, activate
 * Resume: GET /api/register/status — resume interrupted registration
 */

import bcrypt from 'bcrypt';
import type { Express } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { createLogger } from '../lib/logger';
import { sendEmail } from '../email';

const logger = createLogger('register');

/**
 * Ensure the companies table has the columns we need for onboarding.
 * Safe to run multiple times (IF NOT EXISTS).
 */
async function ensureOnboardingColumns(): Promise<void> {
  const cols = [
    { name: 'industry', type: 'TEXT' },
    { name: 'country', type: 'TEXT' },
    { name: 'phone', type: 'TEXT' },
    { name: 'website', type: 'TEXT' },
    { name: 'team_size', type: 'TEXT' },
    { name: 'onboarding_step', type: 'INTEGER DEFAULT 1' },
    { name: 'onboarding_complete', type: 'BOOLEAN DEFAULT false' },
  ];
  for (const col of cols) {
    await pool.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`
    );
  }
  // Fix sequences after manual inserts / seeding to prevent duplicate key errors
  await pool.query(`SELECT setval('companies_id_seq', GREATEST((SELECT COALESCE(MAX(id),0) FROM companies) + 1, nextval('companies_id_seq')), false)`);
  await pool.query(`SELECT setval('agents_id_seq', GREATEST((SELECT COALESCE(MAX(id),0) FROM agents) + 1, nextval('agents_id_seq')), false)`);

  logger.info('Onboarding columns and sequences ensured');
}

export function registerRegistrationRoutes(app: Express): void {

  // ── Step 1: Create account ──────────────────────────────────────────────
  app.post('/api/register', async (req: any, res: any) => {
    const { firstName, lastName, email, password, phone } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if email already exists
      const existing = await client.query(
        'SELECT id FROM agents WHERE email = $1',
        [email]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      // Create company
      const companyName = `${firstName} ${lastName}'s Company`;
      const companyRes = await client.query(
        `INSERT INTO companies (name, email, plan, trial_ends_at, onboarding_step)
         VALUES ($1, $2, 'trial', NOW() + INTERVAL '14 days', 2)
         RETURNING id`,
        [companyName, email]
      );
      const companyId = companyRes.rows[0].id;

      // Create admin agent
      const hash = await bcrypt.hash(password, 10);
      const agentRes = await client.query(
        `INSERT INTO agents (name, email, password_hash, role, company_id, is_active)
         VALUES ($1, $2, $3, 'admin', $4, true)
         RETURNING id`,
        [`${firstName} ${lastName}`, email, hash, companyId]
      );
      const agentId = agentRes.rows[0].id;

      // Store phone on company if provided
      if (phone) {
        await client.query(
          'UPDATE companies SET phone = $1 WHERE id = $2',
          [phone, companyId]
        );
      }

      // Create a blank chatbot_config row so new companies have their own config from day 1
      await client.query(
        `INSERT INTO chatbot_config (system_prompt, override_active, company_id)
         VALUES ('', false, $1)`,
        [companyId]
      );

      await client.query('COMMIT');

      // Set session
      req.session.authenticated = true;
      req.session.agentId = agentId;
      req.session.companyId = companyId;
      req.session.role = 'admin';
      req.session.agentName = `${firstName} ${lastName}`;

      req.session.save((err: any) => {
        if (err) {
          logger.error('Session save failed after registration', `error: ${err.message}`);
          return res.status(500).json({ error: 'Session error' });
        }
        logger.info('Registration complete', `companyId: ${companyId}, agentId: ${agentId}`);
        res.json({ success: true, companyId, agentId });
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error('Registration failed', `error: ${err.message}`);
      res.status(500).json({ error: 'Registration failed' });
    } finally {
      client.release();
    }
  });

  // ── Step 2: Business details ────────────────────────────────────────────
  app.put('/api/register/business', requireAuth, async (req: any, res: any) => {
    const { businessName, industry, country, website, teamSize } = req.body;
    const companyId = req.session.companyId;

    try {
      await pool.query(
        `UPDATE companies
         SET name = COALESCE($1, name),
             industry = $2,
             country = $3,
             website = $4,
             team_size = $5,
             onboarding_step = GREATEST(onboarding_step, 3)
         WHERE id = $6`,
        [businessName, industry, country, website, teamSize, companyId]
      );
      logger.info('Business details saved', `companyId: ${companyId}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Business details failed', `companyId: ${companyId}, error: ${err.message}`);
      res.status(500).json({ error: 'Failed to save business details' });
    }
  });

  // ── Step 3: WhatsApp credentials ────────────────────────────────────────
  app.put('/api/register/whatsapp', requireAuth, async (req: any, res: any) => {
    const { phoneNumberId, wabaId, accessToken } = req.body;
    const companyId = req.session.companyId;

    try {
      await pool.query(
        `UPDATE companies
         SET whatsapp_phone_number_id = $1,
             whatsapp_waba_id = $2,
             whatsapp_token = $3,
             onboarding_step = GREATEST(onboarding_step, 4)
         WHERE id = $4`,
        [phoneNumberId, wabaId, accessToken, companyId]
      );
      logger.info('WhatsApp credentials saved', `companyId: ${companyId}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('WhatsApp save failed', `companyId: ${companyId}, error: ${err.message}`);
      res.status(500).json({ error: 'Failed to save WhatsApp credentials' });
    }
  });

  // ── Step 3b: Verify WhatsApp credentials ────────────────────────────────
  app.post('/api/register/whatsapp/verify', requireAuth, async (req: any, res: any) => {
    const { phoneNumberId, wabaId, accessToken } = req.body;

    if (!phoneNumberId || !accessToken || !wabaId) {
      return res.status(400).json({ verified: false, error: 'Missing credentials' });
    }

    try {
      const metaHeaders = {
        'Authorization': `Bearer ${accessToken}`,
      };

      // Step 1: Validate phoneNumberId + accessToken directly
      const phoneResp = await fetch(
        `https://graph.facebook.com/v19.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
        { headers: metaHeaders }
      );
      const phoneData = await phoneResp.json();

      if (phoneData.error) {
        logger.warn('WhatsApp phone number ID verification failed', `error: ${phoneData.error.message}`);
        return res.json({ verified: false, error: phoneData.error.message });
      }

      const displayName = phoneData.verified_name || phoneData.display_phone_number || 'Verified';

      // Step 2: Validate wabaId by fetching its phone numbers and confirming phoneNumberId belongs to it
      const wabaResp = await fetch(
        `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?fields=id`,
        { headers: metaHeaders }
      );
      const wabaData = await wabaResp.json();

      if (wabaData.error) {
        logger.warn('WhatsApp WABA ID verification failed', `wabaId: ${wabaId}, error: ${wabaData.error.message}`);
        return res.json({
          verified: false,
          wabaError: `Invalid WABA ID: ${wabaData.error.message}`,
        });
      }

      const ownedIds: string[] = (wabaData.data || []).map((p: any) => String(p.id));
      if (!ownedIds.includes(String(phoneNumberId))) {
        logger.warn('Phone number ID not found under WABA', `phoneNumberId: ${phoneNumberId}, wabaId: ${wabaId}`);
        return res.json({
          verified: false,
          wabaError: `Phone Number ID ${phoneNumberId} does not belong to WABA ${wabaId}. Check both values in your Meta Business dashboard.`,
        });
      }

      logger.info('WhatsApp credentials verified', `phoneNumberId: ${phoneNumberId}, wabaId: ${wabaId}`);
      res.json({ verified: true, displayName });
    } catch (err: any) {
      logger.error('WhatsApp verification error', `error: ${err.message}`);
      res.json({ verified: false, error: 'Could not reach Meta API' });
    }
  });

  // ── Step 4: Chatbot config (removed from signup flow) ──────────────────
  // Chatbot configuration is now only accessible from the Agents Dashboard
  // after account creation. A blank config row is created in Step 1.
  // This endpoint is kept as a no-op so in-flight frontend calls don't 404
  // during the transition period; it will be removed once the UI is updated.
  app.put('/api/register/chatbot', requireAuth, async (req: any, res: any) => {
    const companyId = req.session.companyId;
    try {
      await pool.query(
        `UPDATE companies SET onboarding_step = GREATEST(onboarding_step, 5) WHERE id = $1`,
        [companyId]
      );
      logger.info('Register chatbot step skipped (no-op)', `companyId: ${companyId}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Register chatbot no-op failed', `companyId: ${companyId}, error: ${err.message}`);
      res.status(500).json({ error: 'Failed to advance onboarding step' });
    }
  });

  // ── Step 5: Invite agents ───────────────────────────────────────────────
  app.post('/api/register/invite', requireAuth, async (req: any, res: any) => {
    const { agents } = req.body;
    const companyId = req.session.companyId;
    const invited: Array<{ email: string }> = [];

    try {
      if (agents && agents.length > 0) {
        const validAgents = agents.filter((a: any) => a.email && a.name);
        if (validAgents.length > 0) {
          const emails = validAgents.map((a: any) => a.email.toLowerCase());
          const existingRes = await pool.query(
            `SELECT email FROM agents WHERE lower(email) = ANY($1::text[])`,
            [emails]
          );
          if (existingRes.rows.length > 0) {
            const duplicates = existingRes.rows.map((r: any) => r.email);
            return res.status(400).json({ error: 'Some emails are already in use', duplicates });
          }
        }

        for (const agent of agents) {
          if (!agent.email || !agent.name) continue;

          // Create agent with a temp password (they'll set a real one on first login)
          const tempPass = Math.random().toString(36).slice(2, 10);
          const hash = await bcrypt.hash(tempPass, 10);
          await pool.query(
            `INSERT INTO agents (name, email, password_hash, role, company_id, is_active)
             VALUES ($1, $2, $3, 'agent', $4, true)`,
            [agent.name, agent.email, hash, companyId]
          );
          invited.push({ email: agent.email });

          // Send invitation email with credentials
          const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.up.railway.app';
          const _iYear = new Date().getFullYear();
          const inviteHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#0F510F;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">WAK Solutions</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">You've been invited to join your team</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 24px;color:#222;font-size:15px;line-height:1.6;">Hi ${agent.name},</p>
          <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6;">You've been added as a team member on WAK Solutions — an AI-powered customer engagement platform. Use the credentials below to sign in and get started.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f0;border:1px solid #c8e6c9;border-radius:10px;margin-bottom:28px;">
            <tr><td style="padding:22px 26px;">
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Login Email</p>
              <p style="margin:0 0 20px;font-size:15px;font-weight:700;color:#222;">${agent.email}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Temporary Password</p>
              <p style="margin:0 0 20px;font-size:15px;font-weight:700;color:#0F510F;letter-spacing:1px;">${tempPass}</p>
              <a href="${dashboardUrl}/login" style="display:inline-block;background:#0F510F;color:#fff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:600;">Sign In to Dashboard</a>
            </td></tr>
          </table>
          <p style="margin:0 0 10px;color:#444;font-size:14px;font-weight:700;">Getting started</p>
          <ul style="margin:0 0 24px;padding-left:20px;color:#555;font-size:13px;line-height:1.9;">
            <li>Sign in using the email and temporary password above.</li>
            <li>You will be prompted to set a new password on your first login — please do this immediately.</li>
            <li>Once in, you can view conversations, manage meetings, and collaborate with your team.</li>
          </ul>
          <p style="margin:0;color:#555;font-size:13px;line-height:1.6;">If you have any trouble signing in or did not expect this invitation, please contact your team administrator.</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;border-top:1px solid #eee;padding:16px 32px;">
          <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">&copy; ${_iYear} WAK Solutions. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
          sendEmail(
            agent.email,
            `You've been invited to WAK Solutions`,
            inviteHtml,
          ).catch((e: any) => logger.warn('Invite email failed', `email: ${agent.email}, error: ${e.message}`));
        }
      }

      await pool.query(
        `UPDATE companies SET onboarding_step = GREATEST(onboarding_step, 6) WHERE id = $1`,
        [companyId]
      );

      logger.info('Agents invited', `companyId: ${companyId}, count: ${invited.length}`);
      res.json({ success: true, invited });
    } catch (err: any) {
      logger.error('Agent invitation failed', `companyId: ${companyId}, error: ${err.message}`);
      res.status(500).json({ error: 'Failed to invite agents' });
    }
  });

  // ── Step 6: Complete onboarding ─────────────────────────────────────────
  app.post('/api/register/complete', requireAuth, async (req: any, res: any) => {
    const companyId = req.session.companyId;

    try {
      await pool.query(
        `UPDATE companies
         SET onboarding_complete = true, onboarding_step = 6, is_active = true
         WHERE id = $1`,
        [companyId]
      );
      logger.info('Onboarding complete', `companyId: ${companyId}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Complete onboarding failed', `companyId: ${companyId}, error: ${err.message}`);
      res.status(500).json({ error: 'Failed to complete onboarding' });
    }
  });

  // ── Resume: get registration status ─────────────────────────────────────
  app.get('/api/register/status', requireAuth, async (req: any, res: any) => {
    const companyId = req.session.companyId;

    try {
      const result = await pool.query(
        `SELECT name, onboarding_step, onboarding_complete FROM companies WHERE id = $1`,
        [companyId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Company not found' });
      }
      const row = result.rows[0];
      res.json({
        companyName: row.name,
        onboardingStep: row.onboarding_step || 1,
        onboardingComplete: row.onboarding_complete || false,
      });
    } catch (err: any) {
      logger.error('Status check failed', `companyId: ${companyId}, error: ${err.message}`);
      res.status(500).json({ error: 'Failed to check status' });
    }
  });
}

export { ensureOnboardingColumns };
