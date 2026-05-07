/**
 * push.ts — Web Push notification state and delivery helpers.
 *
 * Subscriptions are persisted in the push_subscriptions PostgreSQL table so
 * they survive Railway restarts and re-deploys. The notifiedChats dedup set
 * is backed by the chat_notified PostgreSQL table (24 h TTL) so restarts
 * do not produce duplicate "New Chat" notifications for ongoing sessions.
 * The in-memory Map acts as a fast first-layer cache: a DB read only occurs
 * on the first message of a session after a restart (cache miss path).
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
// DB-backed dedup set with in-memory cache
// ---------------------------------------------------------------------------

/**
 * Tracks which conversation sessions have already triggered a "New Chat"
 * notification. Keyed on `conv:<conversation_id>` so each new session fires
 * exactly once. Cleared via POST /api/notifications/mark-read/:phone.
 *
 * The in-memory Map is the fast path: a hit here costs nothing.
 * On a cache miss (first message after restart) the DB is consulted so
 * ongoing sessions do not generate duplicate notifications after a redeploy.
 * Entries in the DB expire after 24 h (same TTL as conversation sessions).
 */
const MAX_NOTIFIED = 10_000;
const notifiedChats = new Map<string, true>();

export async function addNotified(key: string): Promise<void> {
  if (notifiedChats.size >= MAX_NOTIFIED) {
    const oldest = notifiedChats.keys().next().value;
    notifiedChats.delete(oldest!);
  }
  notifiedChats.set(key, true);
  // Persist so the entry survives a restart. Fire-and-forget — a failure
  // here is non-fatal (worst case: one extra notification after restart).
  pool.query(
    `INSERT INTO chat_notified (key, notified_at) VALUES ($1, NOW())
     ON CONFLICT (key) DO UPDATE SET notified_at = NOW()`,
    [key],
  ).catch((err: any) => logger.error('chat_notified insert failed', err.message));
}

export async function hasNotified(key: string): Promise<boolean> {
  if (notifiedChats.has(key)) return true;
  // Cache miss — check the DB (only happens on first message after restart)
  try {
    const r = await pool.query(
      `SELECT 1 FROM chat_notified
       WHERE key = $1 AND notified_at > NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [key],
    );
    if (r.rows.length > 0) {
      notifiedChats.set(key, true); // warm the cache
      return true;
    }
  } catch (err: any) {
    logger.error('chat_notified lookup failed', err.message);
  }
  return false;
}

export async function deleteNotified(key: string): Promise<void> {
  notifiedChats.delete(key);
  pool.query('DELETE FROM chat_notified WHERE key = $1', [key])
    .catch((err: any) => logger.error('chat_notified delete failed', err.message));
}

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

export async function removeSubscriptionForAgent(endpoint: string, agentId: number, companyId: number): Promise<void> {
  await pool.query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1 AND agent_id = $2 AND company_id = $3',
    [endpoint, agentId, companyId],
  );
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
    // 410 Gone = revoked; 404 = not found; 403 = VAPID mismatch / invalid → clean up
    if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403) {
      removeSubscription(row.endpoint).catch(() => {});
      logger.info('Removed invalid push subscription', `endpoint: ...${row.endpoint.slice(-20)}, status: ${err.statusCode}`);
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
