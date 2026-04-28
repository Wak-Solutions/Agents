import { pool } from '../db';
import { createLogger } from '../lib/logger';

const logger = createLogger('resolveCompanyFromSecret');

/**
 * Resolve the active company that owns this per-tenant webhook secret.
 *
 * The DB equality check is the comparison — never compare in JS, since
 * `===` on strings is not timing-safe. PostgreSQL hashes the column
 * before comparing, and the 32-byte secret space makes brute force
 * infeasible regardless of side-channel timing.
 *
 * Returns the company row or null if the secret is missing, unknown,
 * or belongs to an inactive company.
 */
export async function resolveCompanyFromSecret(
  secret: string | undefined,
): Promise<{ id: number; name: string } | null> {
  if (!secret) return null;
  try {
    const result = await pool.query(
      `SELECT id, name FROM companies
       WHERE webhook_secret = $1 AND is_active = true
       LIMIT 1`,
      [secret],
    );
    if (result.rows.length === 0) {
      logger.warn('Webhook secret did not match any active company');
      return null;
    }
    const row = result.rows[0];
    return { id: row.id, name: row.name };
  } catch (err: any) {
    logger.warn('resolveCompanyFromSecret failed', `error: ${err.message}`);
    return null;
  }
}
