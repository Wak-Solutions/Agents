/**
 * auth.routes.ts — Authentication and WebAuthn routes.
 *
 * Handles: login (email+password and legacy password), logout,
 * /me session info, and the full WebAuthn biometric register/login flow.
 *
 * NOTE: webAuthnCredential and currentChallenge are process-local in-memory state.
 * This means biometric registration is per-process and will not persist across
 * Railway restarts or multi-instance deployments. A DB-backed credential store
 * would be needed to fix this.
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

// Process-local WebAuthn state — resets on restart.
let webAuthnCredential: any = null;
let currentChallenge: string | undefined;

function getRpId(req: any): string {
  if (process.env.RP_ID) return process.env.RP_ID;
  return req.hostname;
}

function getRpOrigin(req: any): string {
  if (process.env.RP_ORIGIN) return process.env.RP_ORIGIN;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.hostname}`;
}

export function registerAuthRoutes(app: Express): void {

  // ── Login ────────────────────────────────────────────────────────────────
  app.post(api.auth.login.path, async (req: any, res: any) => {
    const { email, password } = req.body;

    // Email + password login (multi-agent)
    if (email) {
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
    }

    // Legacy password-only login (backward compat + WebAuthn flow)
    if (password === process.env.DASHBOARD_PASSWORD) {
      try {
        const adminRes = await pool.query(
          `SELECT * FROM agents WHERE role='admin' AND is_active=true ORDER BY id LIMIT 1`
        );
        const admin = adminRes.rows[0];
        req.session.authenticated = true;
        req.session.agentId = admin?.id ?? null;
        req.session.companyId = admin?.company_id ?? 1;
        req.session.role = 'admin';
        req.session.agentName = admin?.name ?? 'Admin';
        return req.session.save((err: any) => {
          if (err) {
            logger.error('Session save failed after legacy login', err.message);
            return res.status(500).json({ message: 'Session save error' });
          }
          logger.info('Legacy password login success', `agentId: ${admin?.id}`);
          res.json({ success: true });
        });
      } catch (err: any) {
        logger.error('Legacy login error', err.message);
        return res.status(500).json({ message: err.message });
      }
    }

    logger.warn('Login failed — invalid password (legacy path)');
    res.status(401).json({ message: 'Invalid password' });
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
      res.status(401).json({ message: 'Unauthorized' });
    }
  });

  // ── WebAuthn: register options ────────────────────────────────────────────
  app.post('/api/auth/webauthn/register/options', requireAuth, async (req: any, res: any) => {
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: getRpId(req),
      userID: new TextEncoder().encode('wak-agent'),
      userName: 'agent',
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });
    currentChallenge = options.challenge;
    logger.info('WebAuthn register options generated', `agentId: ${req.session.agentId}`);
    res.json(options);
  });

  // ── WebAuthn: register verify ─────────────────────────────────────────────
  app.post('/api/auth/webauthn/register/verify', requireAuth, async (req: any, res: any) => {
    try {
      const { verified, registrationInfo } = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge: currentChallenge!,
        expectedOrigin: getRpOrigin(req),
        expectedRPID: getRpId(req),
      });
      if (verified && registrationInfo) {
        webAuthnCredential = registrationInfo.credential;
        currentChallenge = undefined;
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
    if (!webAuthnCredential) {
      return res.status(400).json({ message: 'No biometric registered' });
    }
    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      allowCredentials: [{ id: webAuthnCredential.id }],
      userVerification: 'required',
    });
    currentChallenge = options.challenge;
    res.json(options);
  });

  // ── WebAuthn: login verify ────────────────────────────────────────────────
  app.post('/api/auth/webauthn/login/verify', async (req: any, res: any) => {
    try {
      const { verified } = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge: currentChallenge!,
        expectedOrigin: getRpOrigin(req),
        expectedRPID: getRpId(req),
        credential: webAuthnCredential,
      });
      if (verified) {
        const adminRes = await pool.query(
          `SELECT * FROM agents WHERE role='admin' AND is_active=true ORDER BY id LIMIT 1`
        );
        const admin = adminRes.rows[0];
        if (!admin) {
          logger.error('WebAuthn login — no active admin account found');
          return res.status(403).json({ message: 'No active admin account found.' });
        }
        req.session.authenticated = true;
        req.session.agentId = admin.id;
        req.session.companyId = admin.company_id ?? 1;
        req.session.role = 'admin';
        req.session.agentName = admin.name;
        req.session.save((err: any) => {
          if (err) {
            logger.error('Session save failed after WebAuthn login', err.message);
            return res.status(500).json({ message: 'Session error' });
          }
          currentChallenge = undefined;
          logger.info('WebAuthn login success', `agentId: ${admin.id}`);
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
  app.get('/api/auth/webauthn/registered', (_req: any, res: any) => {
    res.json({ registered: !!webAuthnCredential });
  });
}
