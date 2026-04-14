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
import { Resend } from 'resend';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { createLogger } from '../lib/logger';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

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
      // Step 1: Validate phoneNumberId + accessToken directly
      const phoneUrl = `https://graph.facebook.com/v19.0/${phoneNumberId}?fields=display_phone_number,verified_name&access_token=${accessToken}`;
      const phoneResp = await fetch(phoneUrl);
      const phoneData = await phoneResp.json();

      if (phoneData.error) {
        logger.warn('WhatsApp phone number ID verification failed', `error: ${phoneData.error.message}`);
        return res.json({ verified: false, error: phoneData.error.message });
      }

      const displayName = phoneData.verified_name || phoneData.display_phone_number || 'Verified';

      // Step 2: Validate wabaId by fetching its phone numbers and confirming phoneNumberId belongs to it
      const wabaUrl = `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?fields=id&access_token=${accessToken}`;
      const wabaResp = await fetch(wabaUrl);
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

  // ── Step 4: Chatbot config ──────────────────────────────────────────────
  app.put('/api/register/chatbot', requireAuth, async (req: any, res: any) => {
    const { botName, greeting, tone, faqs } = req.body;
    const companyId = req.session.companyId;

    try {
      // Build a simple system prompt from the onboarding inputs
      let systemPrompt = `You are a friendly, professional customer service assistant for ${botName || 'our company'}.`;
      if (tone) systemPrompt += ` Your tone is ${tone}.`;
      if (greeting) systemPrompt += `\n\nGREETING:\nStart every new conversation with: "${greeting}"`;

      if (faqs && faqs.length > 0) {
        systemPrompt += '\n\nFREQUENTLY ASKED QUESTIONS:';
        for (const faq of faqs) {
          if (faq.question && faq.answer) {
            systemPrompt += `\nQ: ${faq.question}\nA: ${faq.answer}`;
          }
        }
      }

      systemPrompt += '\n\nTONE & STYLE:\n- Conversational and warm — this is WhatsApp, not email\n- Keep messages short and clear — 2-4 lines maximum per message\n- Use Western numerals only (1, 2, 3)';

      // Upsert chatbot_config for this company
      const existingConfig = await pool.query(
        'SELECT id FROM chatbot_config WHERE company_id = $1',
        [companyId]
      );

      // Build structured_config so the dashboard can read individual fields back
      const structuredConfig = JSON.stringify({
        businessName: botName || '',
        industry: '',
        tone: tone || 'Professional',
        customTone: '',
        greeting: greeting || '',
        questions: [],
        faq: faqs && faqs.length > 0 ? faqs.map((f: any) => ({ question: f.question, answer: f.answer })) : [],
        escalationRules: [],
        closingMessage: '',
      });

      if (existingConfig.rows.length > 0) {
        await pool.query(
          `UPDATE chatbot_config
           SET system_prompt = $1, business_name = $2, tone = $3, greeting = $4,
               structured_config = $5, updated_at = NOW()
           WHERE company_id = $6`,
          [systemPrompt, botName, tone, greeting, structuredConfig, companyId]
        );
      } else {
        await pool.query(
          `INSERT INTO chatbot_config (system_prompt, business_name, tone, greeting, structured_config, company_id, override_active)
           VALUES ($1, $2, $3, $4, $5, $6, false)`,
          [systemPrompt, botName, tone, greeting, structuredConfig, companyId]
        );
      }

      await pool.query(
        `UPDATE companies SET onboarding_step = GREATEST(onboarding_step, 5) WHERE id = $1`,
        [companyId]
      );

      logger.info('Chatbot config saved', `companyId: ${companyId}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Chatbot config failed', `companyId: ${companyId}, error: ${err.message}`);
      res.status(500).json({ error: 'Failed to save chatbot config' });
    }
  });

  // ── Step 5: Invite agents ───────────────────────────────────────────────
  app.post('/api/register/invite', requireAuth, async (req: any, res: any) => {
    const { agents } = req.body;
    const companyId = req.session.companyId;
    const invited: Array<{ email: string }> = [];

    try {
      if (agents && agents.length > 0) {
        for (const agent of agents) {
          if (!agent.email || !agent.name) continue;

          // Check if email already exists
          const existing = await pool.query(
            'SELECT id FROM agents WHERE email = $1',
            [agent.email]
          );
          if (existing.rows.length > 0) continue;

          // Create agent with a temp password (they'll reset on first login)
          const tempPass = Math.random().toString(36).slice(2, 10);
          const hash = await bcrypt.hash(tempPass, 10);
          await pool.query(
            `INSERT INTO agents (name, email, password_hash, role, company_id, is_active)
             VALUES ($1, $2, $3, 'agent', $4, true)`,
            [agent.name, agent.email, hash, companyId]
          );
          invited.push({ email: agent.email });

          // Send invitation email with temp credentials
          if (resend) {
            const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.up.railway.app';
            resend.emails.send({
              from: process.env.RESEND_FROM_EMAIL || 'WAK Solutions <noreply@wak-solutions.com>',
              to: agent.email,
              subject: `You've been invited to WAK Solutions`,
              html: `
                <p>Hi ${agent.name},</p>
                <p>You've been invited to join your team on WAK Solutions.</p>
                <p><strong>Login email:</strong> ${agent.email}<br>
                <strong>Temporary password:</strong> ${tempPass}</p>
                <p>Please <a href="${dashboardUrl}/login">sign in here</a> and change your password after your first login.</p>
                <p>— WAK Solutions</p>
              `,
            }).catch((e: any) => logger.warn('Invite email failed', `email: ${agent.email}, error: ${e.message}`));
          } else {
            logger.warn('RESEND_API_KEY not set — invite email not sent', `email: ${agent.email}`);
          }
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
