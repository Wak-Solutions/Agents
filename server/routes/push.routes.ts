/**
 * push.routes.ts — Web Push subscription management routes.
 */

import type { Express } from 'express';
import { VAPID_PUBLIC_KEY, registerSubscription, removeSubscription } from '../push';
import { requireAuth } from '../middleware/auth';
import { createLogger } from '../lib/logger';
import { api } from '@shared/routes';

const logger = createLogger('push');

export function registerPushRoutes(app: Express): void {

  app.get(api.push.vapidPublicKey.path, requireAuth, (_req: any, res: any) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  app.post(api.push.subscribe.path, requireAuth, async (req: any, res: any) => {
    try {
      const subscription = req.body;
      if (!subscription?.endpoint) {
        return res.status(400).json({ message: 'Invalid subscription object' });
      }
      const agentId = req.session.agentId as number;
      const companyId = req.companyId as number;
      await registerSubscription(agentId, companyId, subscription);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Subscribe failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  app.post(api.push.unsubscribe.path, requireAuth, async (req: any, res: any) => {
    try {
      const { endpoint } = req.body;
      if (endpoint) await removeSubscription(endpoint);
      logger.info('Push subscription removed', `agentId: ${req.session.agentId}`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Unsubscribe failed', err.message);
      res.status(500).json({ message: 'Internal error' });
    }
  });
}
