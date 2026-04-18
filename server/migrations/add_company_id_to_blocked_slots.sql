-- Migration: scope blocked_slots to company
-- Multi-tenant isolation: each company manages its own blocked calendar slots.
-- Without this, Company A's blocked times appear in Company B's availability.

ALTER TABLE blocked_slots
  ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE;

-- Back-fill existing rows to company 1 (WAK Solutions — the only company at migration time)
UPDATE blocked_slots SET company_id = 1 WHERE company_id IS NULL;

-- Now enforce NOT NULL
ALTER TABLE blocked_slots ALTER COLUMN company_id SET NOT NULL;

-- Replace the old unique constraint (date, time) with a per-company one
ALTER TABLE blocked_slots DROP CONSTRAINT IF EXISTS blocked_slots_date_time_key;
ALTER TABLE blocked_slots ADD CONSTRAINT blocked_slots_company_date_time_key
  UNIQUE (company_id, date, time);
