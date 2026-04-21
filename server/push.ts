/**
 * push.ts — Web Push notification state and delivery helpers.
 *
 * Subscriptions are persisted in the push_subscriptions PostgreSQL table so
 * they survive Railway restarts and re-deploys. The notifiedChats dedup set
 * remains in-memory (worst case: one extra notification after a restart, which
 * is acceptable).
 */

import webpush from 'web-push';
import { pool } from './db';
import { createLogger } from './lib/logger';

const logger = createLogger('push');

// ---------------------------------------------------------------------------
// VAPID setup
// ---------------------------------------------------------------------------

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL = process.env.VAPID_EMAIL || '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  if (!VAPID_EMAIL) {
    logger.warn('VAPID_EMAIL not set — push notifications will be disabled');
  } else {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    logger.info('VAPID keys configured');
  }
} else {
  logger.warn('VAPID keys not set — push notifications will be disabled');
}

export { VAPID_PUBLIC_KEY };

// ---------------------------------------------------------------------------
// In-memory dedup set (resets on restart — acceptable)
// ---------------------------------------------------------------------------

/**
 * Tracks which conversation sessions have already triggered a "New Chat"
 * notification. Keyed on `conv:<conversation_id>` so each new session fires
 * exactly once. Cleared via POST /api/notifications/mark-read/:phone.
 */
export const notifiedChats = new Set<string>();

// ---------------------------------------------------------------------------
// DB-backed subscription management
// ---------------------------------------------------------------------------

export async function registerSubscription(
  agentId: number,
  companyId: number,
  subscription: any,
): Promise<void> {
  await pool.query(
    `INSERT INTO push_subscriptions (agent_id, endpoint, subscription, company_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint)
     DO UPDATE SET agent_id = $1, subscription = $3, company_id = $4, updated_at = NOW()`,
    [agentId, subscription.endpoint, JSON.stringify(subscription), companyId],
  );
  logger.info('Push subscription persisted', `agentId: ${agentId}`);
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

// ---------------------------------------------------------------------------
// Low-level delivery — removes expired subscriptions on 410/404
// ---------------------------------------------------------------------------

async function sendPush(
  row: { endpoint: string; subscription: any },
  payload: object,
): Promise<void> {
  const sub =
    typeof row.subscription === 'string'
      ? JSON.parse(row.subscription)
      : row.subscription;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
  } catch (err: any) {
    logger.error(
      'Push delivery failed',
      `endpoint: ...${row.endpoint.slice(-20)}, status: ${err.statusCode ?? 'n/a'}, error: ${err.message}`,
    );
    // 410 Gone = subscription revoked; 404 = endpoint not found → clean up
    if (err.statusCode === 410 || err.statusCode === 404) {
      removeSubscription(row.endpoint).catch(() => {});
      logger.info('Removed expired push subscription', `endpoint: ...${row.endpoint.slice(-20)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public delivery helpers
// ---------------------------------------------------------------------------

/** Broadcast to all subscribed agents (optionally filtered by companyId). */
export async function notifyAll(payload: object, companyId?: number): Promise<void> {
  const res = companyId
    ? await pool.query(
        'SELECT endpoint, subscription FROM push_subscriptions WHERE company_id = $1',
        [companyId],
      )
    : await pool.query('SELECT endpoint, subscription FROM push_subscriptions');
  await Promise.all(res.rows.map((row: any) => sendPush(row, payload)));
  logger.info('Push sent to all agents', `subscribers: ${res.rows.length}${companyId ? `, companyId: ${companyId}` : ''}`);
}

/** Send to a specific agent's registered devices. */
export async function notifyAgent(agentId: number, payload: object): Promise<void> {
  const res = await pool.query(
    'SELECT endpoint, subscription FROM push_subscriptions WHERE agent_id = $1',
    [agentId],
  );
  await Promise.all(res.rows.map((row: any) => sendPush(row, payload)));
  if (res.rows.length > 0) {
    logger.info('Push sent to agent', `agentId: ${agentId}, subscriptions: ${res.rows.length}`);
  }
}

/** Send to all admin-role agents (optionally filtered by companyId). */
export async function notifyAdmins(payload: object, companyId?: number): Promise<void> {
  try {
    const res = companyId
      ? await pool.query(
          `SELECT ps.endpoint, ps.subscription
           FROM push_subscriptions ps
           JOIN agents a ON a.id = ps.agent_id
           WHERE a.role = 'admin' AND a.is_active = true AND ps.company_id = $1`,
          [companyId],
        )
      : await pool.query(
          `SELECT ps.endpoint, ps.subscription
           FROM push_subscriptions ps
           JOIN agents a ON a.id = ps.agent_id
           WHERE a.role = 'admin' AND a.is_active = true`,
        );
    await Promise.all(res.rows.map((row: any) => sendPush(row, payload)));
    logger.info('Push sent to admins', `subscriptions: ${res.rows.length}`);
  } catch (err: any) {
    logger.error('notifyAdmins failed', err.message);
  }
}
