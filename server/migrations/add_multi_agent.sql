-- Multi-agent support migration

CREATE TABLE IF NOT EXISTS agents (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  email               TEXT UNIQUE NOT NULL,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'agent',
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  last_login          TIMESTAMPTZ,
  webauthn_credential JSONB
);

-- Add agent assignment column to escalations
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS assigned_agent_id INTEGER REFERENCES agents(id);
CREATE INDEX IF NOT EXISTS idx_escalations_assigned ON escalations(assigned_agent_id);
