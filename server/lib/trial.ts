import { pool } from '../db';
import { createLogger } from './logger';

const logger = createLogger('trial');

const DEFAULT_TRIAL_DAYS = 14;

export async function ensureConfigTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  await pool.query(
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`
  ).catch(() => {});
  await pool.query(
    `INSERT INTO config (key, value) VALUES ('trial_days', $1)
     ON CONFLICT (key) DO NOTHING`,
    [String(DEFAULT_TRIAL_DAYS)]
  );
  logger.info('config table ensured, trial_days seeded');
}

let cachedTrialDays: { value: number; at: number } | null = null;
const CACHE_TTL_MS = 30 * 1000;

export async function getTrialDays(): Promise<number> {
  const now = Date.now();
  if (cachedTrialDays && now - cachedTrialDays.at < CACHE_TTL_MS) {
    return cachedTrialDays.value;
  }
  try {
    const r = await pool.query(`SELECT value FROM config WHERE key = 'trial_days'`);
    const raw = r.rows[0]?.value;
    const n = Number.parseInt(raw, 10);
    const v = Number.isFinite(n) && n > 0 ? n : DEFAULT_TRIAL_DAYS;
    cachedTrialDays = { value: v, at: now };
    return v;
  } catch {
    return DEFAULT_TRIAL_DAYS;
  }
}

export interface TrialStatus {
  trialDays: number;
  createdAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  daysRemaining: number;
}

// Always computed from DB — never from session — to prevent bypass via
// session or request manipulation.
export async function getCompanyTrialStatus(companyId: number): Promise<TrialStatus> {
  const trialDays = await getTrialDays();
  const r = await pool.query(
    `SELECT created_at,
            (created_at + ($1 || ' days')::INTERVAL) AS expires_at,
            NOW() > (created_at + ($1 || ' days')::INTERVAL) AS expired,
            GREATEST(
              0,
              CEIL(EXTRACT(EPOCH FROM ((created_at + ($1 || ' days')::INTERVAL) - NOW())) / 86400)
            )::int AS days_remaining
     FROM companies WHERE id = $2`,
    [String(trialDays), companyId]
  );
  const row = r.rows[0];
  if (!row) {
    return { trialDays, createdAt: null, expiresAt: null, expired: true, daysRemaining: 0 };
  }
  return {
    trialDays,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    expired: Boolean(row.expired),
    daysRemaining: Number(row.days_remaining ?? 0),
  };
}

export async function isCompanyTrialExpired(companyId: number): Promise<boolean> {
  const s = await getCompanyTrialStatus(companyId);
  return s.expired;
}
