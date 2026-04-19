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

  // ── Login ────────────────────────────────────────────────────────────────
  app.post(api.auth.login.path, async (req: any, res: any) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    try {
      const agentRes = await pool.query(
        `SELECT * FROM agents WHERE email=$1 LIMIT 1`,
        [email]
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
      await pool.query(`UPDATE agents SET last_login=NOW() WHERE id=$1`, [agent.id]);
      req.session.authenticated = true;
      req.session.agentId = agent.id;
      req.session.companyId = agent.company_id;
      req.session.role = agent.role;
      req.session.agentName = agent.name;
      return req.session.save((err: any) => {
        if (err) {
          logger.error('Session save failed after login', `agentId: ${agent.id}, error: ${err.message}`);
          return res.status(500).json({ message: 'Session save error' });
        }
        logger.info('Login success', `agentId: ${agent.id}, role: ${agent.role}`);
        res.json({ success: true, role: agent.role, name: agent.name });
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
      let termsAcceptedAt: string | null = null;
      if (req.session.agentId) {
        try {
          const r = await pool.query(
            `SELECT terms_accepted_at FROM agents WHERE id = $1`,
            [req.session.agentId]
          );
          const raw = r.rows[0]?.terms_accepted_at;
          termsAcceptedAt = raw ? new Date(raw).toISOString() : null;
        } catch (err: any) {
          logger.warn('Could not fetch terms_accepted_at', `agentId: ${req.session.agentId}, error: ${err.message}`);
        }
      }
      res.json({
        authenticated: true,
        role: req.session.role || 'admin',
        agentId: req.session.agentId || null,
        companyId: req.session.companyId || null,
        agentName: req.session.agentName || 'Admin',
        termsAcceptedAt,
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
                a.id AS agent_id, a.company_id, a.name AS agent_name, a.role, a.is_active
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
        req.session.authenticated = true;
        req.session.agentId = stored.agent_id;
        req.session.companyId = stored.company_id;
        req.session.role = stored.role;
        req.session.agentName = stored.agent_name;
        (req.session as any).webauthnChallenge = undefined;
        req.session.save((err: any) => {
          if (err) {
            logger.error('Session save failed after WebAuthn login', err.message);
            return res.status(500).json({ message: 'Session error' });
          }
          logger.info('WebAuthn login success', `agentId: ${stored.agent_id}, companyId: ${stored.company_id}`);
          res.json({ success: true });
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
}
