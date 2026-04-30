import { pool } from '../db';
import { createLogger } from './logger';

const logger = createLogger('contacts-migration');

/**
 * Replace the single contacts.company_id FK with a contact_companies join
 * table so a contact (identified by phone_number) can belong to multiple
 * companies. Safe to run repeatedly on every startup.
 *
 * Preserves existing data:
 *   1. Ensures the join table exists.
 *   2. Backfills every existing (contact.id, contact.company_id) pair.
 *   3. Merges duplicate-phone contacts (same phone across different
 *      companies) onto the lowest id, re-pointing their company links.
 *   4. Replaces the old (phone_number, company_id) unique constraint with
 *      a global UNIQUE (phone_number) constraint.
 *   5. Drops the now-unused contacts.company_id column last.
 */
export async function ensureContactCompanies(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_companies (
      contact_id INTEGER     NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      company_id INTEGER     NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      source     TEXT        NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (contact_id, company_id)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS contact_companies_company_idx ON contact_companies (company_id)`
  );
  // Per-company name: each tenant can label a shared contact differently.
  await pool.query(
    `ALTER TABLE contact_companies ADD COLUMN IF NOT EXISTS name TEXT`
  );
  // Backfill: copy the global contacts.name into every existing link row
  // so existing data isn't lost. Runs idempotently; already-named rows
  // (cc.name IS NOT NULL) are left untouched.
  await pool.query(`
    UPDATE contact_companies cc
    SET name = c.name
    FROM contacts c
    WHERE cc.contact_id = c.id
      AND cc.name IS NULL
      AND c.name IS NOT NULL
  `);

  // Backfill — only useful while the old contacts.company_id column still exists.
  const colCheck = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'contacts' AND column_name = 'company_id'`
  );
  if (colCheck.rows.length > 0) {
    await pool.query(`
      INSERT INTO contact_companies (contact_id, company_id, source)
      SELECT id, company_id, COALESCE(source, 'manual')
      FROM contacts
      WHERE company_id IS NOT NULL
      ON CONFLICT (contact_id, company_id) DO NOTHING
    `);

    // Merge duplicate-phone rows onto the lowest id. Re-point every link in
    // contact_companies that pointed at a duplicate to the canonical id,
    // then drop the duplicates.
    await pool.query(`
      WITH canonical AS (
        SELECT phone_number, MIN(id) AS keep_id
        FROM contacts
        GROUP BY phone_number
        HAVING COUNT(*) > 1
      ),
      dupes AS (
        SELECT c.id AS dupe_id, canonical.keep_id
        FROM contacts c
        JOIN canonical ON canonical.phone_number = c.phone_number
        WHERE c.id <> canonical.keep_id
      )
      INSERT INTO contact_companies (contact_id, company_id, source, created_at)
      SELECT DISTINCT ON (dupes.keep_id, cc.company_id)
             dupes.keep_id, cc.company_id, cc.source, cc.created_at
      FROM contact_companies cc
      JOIN dupes ON dupes.dupe_id = cc.contact_id
      ORDER BY dupes.keep_id, cc.company_id, cc.created_at
      ON CONFLICT (contact_id, company_id) DO NOTHING
    `);
    await pool.query(`
      DELETE FROM contacts c
      WHERE EXISTS (
        SELECT 1 FROM contacts c2
        WHERE c2.phone_number = c.phone_number AND c2.id < c.id
      )
    `);

    // Replace per-company unique with a global phone_number unique.
    await pool.query(
      `ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_company_key`
    ).catch(() => {});
    await pool.query(
      `ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_number_key`
    ).catch(() => {});
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'contacts_phone_unique'
        ) THEN
          ALTER TABLE contacts ADD CONSTRAINT contacts_phone_unique UNIQUE (phone_number);
        END IF;
      END;
      $$
    `);

    // Finally drop the obsolete column.
    await pool.query(`ALTER TABLE contacts DROP COLUMN IF EXISTS company_id`).catch(() => {});
    logger.info('contact_companies migration applied — contacts.company_id dropped');
  } else {
    logger.info('contact_companies already in place');
  }
}
