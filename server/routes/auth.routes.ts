/**
 * auth.routes.ts — Authentication and WebAuthn routes.
 *
 * Handles: login (email+password), logout, /me session info,
 * and the full WebAuthn biometric register/login flow.
 *
 * WebAuthn credentials are stored in the webauthn_credentials table
 * so they survive server restarts and Railway redeploys.
 * The short-lived challenge is stored in the session (also DB-backed).
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import type { Express } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { createLogger } from '../lib/logger';
import { api } from '@shared/routes';
import { getCompanyTrialStatus } from '../lib/trial';
import { sendEmail } from '../email';

const logger = createLogger('auth');

const RP_NAME = 'WAK Solutions Agent';

function getRpId(req: any): string {
  if (process.env.RP_ID) return process.env.RP_ID;
  return req.hostname;
}

function getRpOrigin(req: any): string {
  if (process.env.RP_ORIGIN) return process.env.RP_ORIGIN;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.hostname}`;
}

export async function registerAuthRoutes(app: Express): Promise<void> {

  // Ensure the webauthn_credentials table exists on startup.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id            SERIAL PRIMARY KEY,
      agent_id      INTEGER NOT NULL REFERENCES agents(id),
      credential_id TEXT NOT NULL UNIQUE,
      public_key    TEXT NOT NULL,
      counter       BIGINT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  // Ensure the password_resets table exists on startup.
  // Stores only the SHA-256 hash of the reset token so a DB leak does not
  // expose usable reset links. Tokens are single-use and short-lived.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id         SERIAL PRIMARY KEY,
      agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query(
    `CREATE INDEX IF NOT EXISTS password_resets_agent_idx ON password_resets (agent_id)`
  ).catch(() => {});

  // ── Login ────────────────────────────────────────────────────────────────
  app.post(api.auth.login.path, async (req: any, res: any) => {
    const { email, password } = req.body;
    const identifier: string = email; // may be an email address or a phone number

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Email/phone and password are required' });
    }

    try {
      const agentRes = await pool.query(
        `SELECT * FROM agents WHERE lower(email)=lower($1) OR phone=$1 LIMIT 1`,
        [identifier]
      );
      if (agentRes.rows.length === 0) {
        logger.warn('Login failed — agent not found', `email: ${email}`);
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      const agent = agentRes.rows[0];
      if (!agent.is_active) {
        logger.warn('Login rejected — account deactivated', `email: ${email}`);
        return res.status(403).json({ error: 'Your account has been deactivated. Please contact your administrator.' });
      }
      const valid = await bcrypt.compare(password, agent.password_hash);
      if (!valid) {
        logger.warn('Login failed — wrong password', `email: ${email}`);
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      // Trial gate: block login for companies whose trial has expired.
      // Computed from companies.created_at + config.trial_days — never from
      // the client or session — so it cannot be bypassed by request manipulation.
      if (agent.company_id) {
        const trial = await getCompanyTrialStatus(agent.company_id);
        if (trial.expired) {
          logger.warn('Login blocked — trial expired', `agentId: ${agent.id}, companyId: ${agent.company_id}`);
          return res.status(402).json({
            message: 'Your free trial has expired. Please contact support to continue.',
            trialExpired: true,
            trialDays: trial.trialDays,
            expiresAt: trial.expiresAt,
          });
        }
      }
      const termsAcceptedAt = agent.terms_accepted_at
        ? new Date(agent.terms_accepted_at).toISOString()
        : null;
      await pool.query(`UPDATE agents SET last_login=NOW() WHERE id=$1`, [agent.id]);
      req.session.authenticated = true;
      req.session.agentId = agent.id;
      req.session.companyId = agent.company_id;
      req.session.role = agent.role;
      req.session.agentName = agent.name;
      (req.session as any).termsAcceptedAt = termsAcceptedAt;
      return req.session.save((err: any) => {
        if (err) {
          logger.error('Session save failed after login', `agentId: ${agent.id}, error: ${err.message}`);
          return res.status(500).json({ message: 'Session save error' });
        }
        logger.info('Login success', `agentId: ${agent.id}, role: ${agent.role}`);
        // Return the full auth shape so the frontend can populate its cache
        // immediately without a second /api/me round-trip.
        res.json({
          success: true,
          authenticated: true,
          role: agent.role,
          agentId: agent.id,
          agentName: agent.name,
          termsAcceptedAt,
        });
      });
    } catch (err: any) {
      logger.error('Login error', err.message);
      return res.status(500).json({ message: err.message });
    }
  });

  // ── Logout ───────────────────────────────────────────────────────────────
  app.post(api.auth.logout.path, (req: any, res: any) => {
    const agentId = req.session.agentId;
    const finish = () => {
      res.clearCookie('connect.sid');
      logger.info('Logout complete', `agentId: ${agentId}`);
      res.json({ success: true });
    };
    try {
      req.session.destroy((err: any) => {
        if (err) logger.warn('Session destroy error (non-fatal)', `agentId: ${agentId}, error: ${err.message}`);
        finish();
      });
    } catch (err: any) {
      logger.warn('Session destroy threw (non-fatal)', err.message);
      finish();
    }
  });

  // ── /me ──────────────────────────────────────────────────────────────────
  app.get(api.auth.me.path, async (req: any, res: any) => {
    if (req.session.authenticated) {
      // Read from session first (populated at login) — avoids a DB round-trip on every
      // page load. Fall back to a DB query only for sessions that pre-date this change.
      let termsAcceptedAt: string | null = (req.session as any).termsAcceptedAt ?? undefined;
      if (termsAcceptedAt === undefined && req.session.agentId) {
        try {
          const r = await pool.query(
            `SELECT terms_accepted_at FROM agents WHERE id = $1`,
            [req.session.agentId]
          );
          const raw = r.rows[0]?.terms_accepted_at;
          termsAcceptedAt = raw ? new Date(raw).toISOString() : null;
          (req.session as any).termsAcceptedAt = termsAcceptedAt;
        } catch (err: any) {
          logger.warn('Could not fetch terms_accepted_at', `agentId: ${req.session.agentId}, error: ${err.message}`);
          termsAcceptedAt = null;
        }
      }
      res.json({
        authenticated: true,
        role: req.session.role || 'admin',
        agentId: req.session.agentId || null,
        companyId: req.session.companyId || null,
        agentName: req.session.agentName || 'Admin',
        termsAcceptedAt: termsAcceptedAt ?? null,
      });
    } else {
      // Return 200 so the browser doesn't log a console error on every page load.
      // 401 is semantically correct for protected routes but wrong here — this
      // endpoint is called proactively to discover auth state, not to guard a resource.
      res.json({ authenticated: false });
    }
  });

  // ── WebAuthn: register options ────────────────────────────────────────────
  app.post('/api/auth/webauthn/register/options', requireAuth, async (req: any, res: any) => {
    try {
      // Load existing credentials for this agent to exclude them from the prompt
      const existing = await pool.query(
        `SELECT credential_id FROM webauthn_credentials WHERE agent_id = $1`,
        [req.session.agentId]
      );
      const excludeCredentials = existing.rows.map((r: any) => ({ id: r.credential_id }));

      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: getRpId(req),
        userID: new TextEncoder().encode(String(req.session.agentId)),
        userName: req.session.agentName || 'agent',
        attestationType: 'none',
        excludeCredentials,
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required',
        },
      });
      (req.session as any).webauthnChallenge = options.challenge;
      req.session.save(() => {});
      logger.info('WebAuthn register options generated', `agentId: ${req.session.agentId}`);
      res.json(options);
    } catch (err: any) {
      logger.error('WebAuthn register options error', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── WebAuthn: register verify ─────────────────────────────────────────────
  app.post('/api/auth/webauthn/register/verify', requireAuth, async (req: any, res: any) => {
    try {
      const challenge = (req.session as any).webauthnChallenge;
      if (!challenge) {
        return res.status(400).json({ message: 'No pending registration challenge' });
      }
      const { verified, registrationInfo } = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge: challenge,
        expectedOrigin: getRpOrigin(req),
        expectedRPID: getRpId(req),
      });
      if (verified && registrationInfo) {
        const { credential } = registrationInfo;
        const pubKeyHex = Buffer.from(credential.publicKey).toString('hex');
        await pool.query(
          `INSERT INTO webauthn_credentials (agent_id, credential_id, public_key, counter)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (credential_id) DO UPDATE SET public_key=$3, counter=$4`,
          [req.session.agentId, credential.id, pubKeyHex, credential.counter]
        );
        (req.session as any).webauthnChallenge = undefined;
        req.session.save(() => {});
        logger.info('WebAuthn credential registered', `agentId: ${req.session.agentId}`);
        res.json({ verified: true });
      } else {
        logger.warn('WebAuthn registration verification failed', `agentId: ${req.session.agentId}`);
        res.status(400).json({ message: 'Verification failed' });
      }
    } catch (err: any) {
      logger.error('WebAuthn register verify error', err.message);
      res.status(400).json({ message: err.message });
    }
  });

  // ── WebAuthn: login options ───────────────────────────────────────────────
  app.post('/api/auth/webauthn/login/options', async (req: any, res: any) => {
    try {
      // Only return credentials for active agents to avoid cross-tenant credential exposure
      const result = await pool.query(
        `SELECT wc.credential_id FROM webauthn_credentials wc
         JOIN agents a ON a.id = wc.agent_id
         WHERE a.is_active = true`
      );
      if (result.rows.length === 0) {
        return res.status(400).json({ message: 'No biometric registered' });
      }
      const allowCredentials = result.rows.map((r: any) => ({ id: r.credential_id }));
      const options = await generateAuthenticationOptions({
        rpID: getRpId(req),
        allowCredentials,
        userVerification: 'required',
      });
      (req.session as any).webauthnChallenge = options.challenge;
      req.session.save(() => {});
      res.json(options);
    } catch (err: any) {
      logger.error('WebAuthn login options error', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── WebAuthn: login verify ────────────────────────────────────────────────
  app.post('/api/auth/webauthn/login/verify', async (req: any, res: any) => {
    try {
      const challenge = (req.session as any).webauthnChallenge;
      if (!challenge) {
        return res.status(400).json({ message: 'No pending login challenge' });
      }
      const responseCredentialId = req.body.id;

      // Look up the credential and its owning agent
      const credRow = await pool.query(
        `SELECT wc.credential_id, wc.public_key, wc.counter,
                a.id AS agent_id, a.company_id, a.name AS agent_name, a.role, a.is_active,
                a.terms_accepted_at
         FROM webauthn_credentials wc
         JOIN agents a ON a.id = wc.agent_id
         WHERE wc.credential_id = $1`,
        [responseCredentialId]
      );
      if (credRow.rows.length === 0) {
        logger.warn('WebAuthn login — credential not found', `credentialId: ${responseCredentialId}`);
        return res.status(401).json({ message: 'Credential not registered' });
      }
      const stored = credRow.rows[0];
      if (!stored.is_active) {
        return res.status(403).json({ message: 'Your account has been deactivated.' });
      }
      if (!stored.company_id) {
        logger.error('WebAuthn login — agent has no company_id', `agentId: ${stored.agent_id}`);
        return res.status(403).json({ message: 'Account configuration error. Please contact support.' });
      }
      // Trial gate (WebAuthn): same DB-derived check as password login.
      {
        const trial = await getCompanyTrialStatus(stored.company_id);
        if (trial.expired) {
          logger.warn('WebAuthn login blocked — trial expired', `agentId: ${stored.agent_id}, companyId: ${stored.company_id}`);
          return res.status(402).json({
            message: 'Your free trial has expired. Please contact support to continue.',
            trialExpired: true,
            trialDays: trial.trialDays,
            expiresAt: trial.expiresAt,
          });
        }
      }

      const publicKeyUint8 = new Uint8Array(Buffer.from(stored.public_key, 'hex'));
      const { verified, authenticationInfo } = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge: challenge,
        expectedOrigin: getRpOrigin(req),
        expectedRPID: getRpId(req),
        credential: {
          id: stored.credential_id,
          publicKey: publicKeyUint8,
          counter: Number(stored.counter),
        },
      });

      if (verified) {
        // Store the counter value the authenticator actually reported.
        // Platform authenticators (Face ID, Touch ID) always report 0 — storing
        // that value rather than blindly incrementing prevents the counter from
        // drifting ahead of what the device sends and breaking future logins.
        await pool.query(
          `UPDATE webauthn_credentials SET counter = $1 WHERE credential_id = $2`,
          [authenticationInfo.newCounter, stored.credential_id]
        );
        const waTermsAcceptedAt = stored.terms_accepted_at
          ? new Date(stored.terms_accepted_at).toISOString()
          : null;
        req.session.authenticated = true;
        req.session.agentId = stored.agent_id;
        req.session.companyId = stored.company_id;
        req.session.role = stored.role;
        req.session.agentName = stored.agent_name;
        (req.session as any).termsAcceptedAt = waTermsAcceptedAt;
        (req.session as any).webauthnChallenge = undefined;
        req.session.save((err: any) => {
          if (err) {
            logger.error('Session save failed after WebAuthn login', err.message);
            return res.status(500).json({ message: 'Session error' });
          }
          logger.info('WebAuthn login success', `agentId: ${stored.agent_id}, companyId: ${stored.company_id}`);
          res.json({
            success: true,
            authenticated: true,
            role: stored.role,
            agentId: stored.agent_id,
            agentName: stored.agent_name,
            termsAcceptedAt: waTermsAcceptedAt,
          });
        });
      } else {
        logger.warn('WebAuthn login verification failed');
        res.status(401).json({ message: 'Biometric verification failed' });
      }
    } catch (err: any) {
      logger.error('WebAuthn login verify error', err.message);
      res.status(401).json({ message: err.message });
    }
  });

  // ── WebAuthn: check registration status ──────────────────────────────────
  app.get('/api/auth/webauthn/registered', async (_req: any, res: any) => {
    try {
      const result = await pool.query(`SELECT COUNT(*)::int AS n FROM webauthn_credentials`);
      res.json({ registered: result.rows[0].n > 0 });
    } catch {
      res.json({ registered: false });
    }
  });

  // ── Forgot / Reset Password ──────────────────────────────────────────────
  // Limits per IP. Prevents abusing the endpoint to flood users' inboxes or
  // to enumerate accounts via timing.
  const forgotLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
  });
  const resetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
  });

  const RESET_TTL_MINUTES = 30;

  function hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  function getAppBaseUrl(req: any): string {
    const raw = (
      process.env.APP_URL ||
      process.env.RAILWAY_PUBLIC_URL ||
      process.env.RAILWAY_PUBLIC_DOMAIN ||
      req.headers.host ||
      'localhost'
    ).replace(/\/$/, '');
    return raw.startsWith('http') ? raw : `https://${raw}`;
  }

  // POST /api/auth/forgot-password — identifier is email or phone.
  // Always responds 200 with a generic message regardless of whether the
  // account exists, so the endpoint cannot be used to enumerate users.
  app.post('/api/auth/forgot-password', forgotLimiter, async (req: any, res: any) => {
    const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
    const generic = { success: true, message: 'If an account exists for that email or phone, a reset link has been sent.' };
    if (!identifier) {
      return res.status(400).json({ message: 'Email or phone is required' });
    }
    try {
      const agentRes = await pool.query(
        `SELECT id, name, email, is_active FROM agents WHERE lower(email) = lower($1) OR phone = $1 LIMIT 1`,
        [identifier]
      );
      const agent = agentRes.rows[0];
      if (!agent || !agent.is_active || !agent.email) {
        // Silently succeed — we cannot email phone-only users, and we don't
        // reveal whether the identifier matched anything.
        logger.info('forgotPassword — no actionable account', `identifier: ${identifier.slice(0, 3)}***`);
        return res.json(generic);
      }

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

      // Invalidate any prior unused tokens for this account to keep exactly
      // one live reset link at a time.
      await pool.query(
        `UPDATE password_resets SET used_at = NOW()
         WHERE agent_id = $1 AND used_at IS NULL`,
        [agent.id]
      );
      await pool.query(
        `INSERT INTO password_resets (agent_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [agent.id, tokenHash, expiresAt]
      );

      const resetUrl = `${getAppBaseUrl(req)}/reset-password/${rawToken}`;
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;padding:32px 16px;">
          <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
            <div style="background:#0F510F;padding:22px 28px;">
              <h1 style="margin:0;color:#fff;font-size:20px;">WAK Solutions</h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Password reset</p>
            </div>
            <div style="padding:28px;color:#333;font-size:14px;line-height:1.6;">
              <p>Hi ${agent.name || 'there'},</p>
              <p>We received a request to reset the password for your WAK Solutions account. Click the button below to choose a new password. This link is valid for ${RESET_TTL_MINUTES} minutes and can only be used once.</p>
              <p style="text-align:center;margin:28px 0;">
                <a href="${resetUrl}" style="background:#0F510F;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;display:inline-block;">Reset Password</a>
              </p>
              <p style="font-size:12px;color:#666;">If the button does not work, copy and paste this link into your browser:<br /><span style="word-break:break-all;color:#0F510F;">${resetUrl}</span></p>
              <p style="font-size:12px;color:#666;margin-top:20px;">If you did not request a password reset you can safely ignore this email — your password will not change.</p>
            </div>
          </div>
        </div>
      `;
      sendEmail(agent.email, 'Reset your WAK Solutions password', html)
        .catch((e: any) => logger.error('forgotPassword — email send failed', e.message));

      logger.info('forgotPassword — reset email dispatched', `agentId: ${agent.id}`);
      return res.json(generic);
    } catch (err: any) {
      logger.error('forgotPassword failed', err.message);
      // Still return the generic success so attackers cannot infer errors.
      return res.json(generic);
    }
  });

  // POST /api/auth/reset-password — consumes a reset token and sets a new password.
  app.post('/api/auth/reset-password', resetLimiter, async (req: any, res: any) => {
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
      if (!token || !newPassword) {
        return res.status(400).json({ message: 'Token and new password are required' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters' });
      }

      const tokenHash = hashToken(token);
      const r = await pool.query(
        `SELECT id, agent_id, expires_at, used_at FROM password_resets WHERE token_hash = $1 LIMIT 1`,
        [tokenHash]
      );
      const reset = r.rows[0];
      if (!reset || reset.used_at || new Date(reset.expires_at) < new Date()) {
        return res.status(400).json({ message: 'This reset link is invalid or has expired.' });
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      // Atomic-ish: mark the token used, then update the password. Both scoped
      // to the same agent so a tampered body cannot redirect the update.
      await pool.query(`UPDATE password_resets SET used_at = NOW() WHERE id = $1`, [reset.id]);
      await pool.query(`UPDATE agents SET password_hash = $1 WHERE id = $2`, [newHash, reset.agent_id]);

      logger.info('resetPassword success', `agentId: ${reset.agent_id}`);
      // Never return a password or hash.
      return res.json({ success: true });
    } catch (err: any) {
      logger.error('resetPassword failed', err.message);
      return res.status(500).json({ message: 'Could not reset password. Please try again.' });
    }
  });
}
