/**
 * escalations.routes.ts — Escalation management routes.
 *
 * The escalation feature is hidden for now; this module registers no
 * routes. Kept so callers of registerEscalationRoutes still compile.
 */

import type { Express } from 'express';

export function registerEscalationRoutes(_app: Express): void {
  // intentionally empty — escalations feature disabled
}
