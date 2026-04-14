/**
 * push.ts — Web Push notification state and delivery helpers.
 *
 * Extracted from routes.ts so that push subscriptions and the
 * "already notified" dedup set are not invisible module-level globals
 * scattered across a 1600-line file.
 *
 * NOTE: pushSubscriptions and notifiedChats are process-local in-memory state.
 * They will reset on every Railway deploy. This is acceptable for the current
 * scale but would need a Redis-backed solution for multi-instance deployments.
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
// In-memory state
// ---------------------------------------------------------------------------

/**
 * All active push subscriptions, keyed by endpoint URL.
 * Each entry stores the subscription object and the agentId it belongs to.
 */
export const pushSubscriptions = new Map<
  string,
  { subscription: any; agentId: number }
>();

/**
 * Tracks which chats have already triggered a notification to avoid re-firing
 * on every message. Key format:
 *   "agentId:phone" for assigned chats
 *   "all:phone"     for unassigned chats
 *
 * Cleared when the agent marks a chat as read (POST /api/notifications/mark-read/:phone).
 */
export const notifiedChats = new Set<string>();

// ---------------------------------------------------------------------------
// Delivery helpers
// ---------------------------------------------------------------------------

async function sendPush(subscription: any, payload: object): Promise<void> {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err: any) {
    logger.error('Push delivery failed', `endpoint: ${subscription.endpoint?.slice(-20)}, error: ${err.message}`);
  }
}

/** Send push notification to every connected agent (used for unassigned chats). */
export async function notifyAll(payload: object): Promise<void> {
  const promises = Array.from(pushSubscriptions.values()).map(({ subscription }) =>
    sendPush(subscription, payload)
  );
  await Promise.all(promises);
  logger.info('Push sent to all agents', `subscribers: ${pushSubscriptions.size}`);
}

/** Send push notification only to a specific agent's subscriptions. */
export async function notifyAgent(agentId: number, payload: object): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const { subscription, agentId: aid } of pushSubscriptions.values()) {
    if (aid === agentId) {
      promises.push(sendPush(subscription, payload));
    }
  }
  await Promise.all(promises);
  if (promises.length > 0) {
    logger.info('Push sent to agent', `agentId: ${agentId}, subscriptions: ${promises.length}`);
  }
}

/** Send push notification only to admin agents (used for escalations). */
export async function notifyAdmins(payload: object): Promise<void> {
  try {
    const adminRes = await pool.query(
      "SELECT id FROM agents WHERE role='admin' AND is_active=true"
    );
    const adminIds = new Set<number>(adminRes.rows.map((r: any) => r.id as number));
    const promises: Promise<void>[] = [];
    for (const { subscription, agentId } of pushSubscriptions.values()) {
      if (adminIds.has(agentId)) {
        promises.push(sendPush(subscription, payload));
      }
    }
    await Promise.all(promises);
    logger.info('Push sent to admins', `admin_count: ${adminIds.size}, subscriptions: ${promises.length}`);
  } catch (err: any) {
    logger.error('notifyAdmins failed', err.message);
  }
}
