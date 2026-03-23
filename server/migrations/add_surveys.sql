-- Survey system migration v2
-- Codebase adaptations:
--   agent_id INTEGER  — nullable, always null (no integer agent IDs in this system)
--   escalation_id INTEGER — nullable, no FK (escalations PK is customer_phone, not an int)

CREATE TABLE IF NOT EXISTS surveys (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  is_default  BOOLEAN DEFAULT false,
  is_active   BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS survey_questions (
  id            SERIAL PRIMARY KEY,
  survey_id     INTEGER REFERENCES surveys(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('rating', 'yes_no', 'free_text')),
  order_index   INTEGER NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id             SERIAL PRIMARY KEY,
  survey_id      INTEGER REFERENCES surveys(id),
  token          TEXT UNIQUE NOT NULL,
  customer_phone TEXT NOT NULL,
  agent_id       INTEGER,
  escalation_id  INTEGER,
  submitted      BOOLEAN DEFAULT false,
  submitted_at   TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS survey_answers (
  id            SERIAL PRIMARY KEY,
  response_id   INTEGER REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id   INTEGER REFERENCES survey_questions(id),
  answer_text   TEXT,
  answer_rating INTEGER CHECK (answer_rating IS NULL OR (answer_rating BETWEEN 1 AND 5)),
  answer_yes_no BOOLEAN,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Enforce only one active survey at a time
CREATE UNIQUE INDEX IF NOT EXISTS one_active_survey ON surveys (is_active) WHERE is_active = true;

-- Seed the default survey (idempotent — skipped if a default already exists)
WITH new_survey AS (
  INSERT INTO surveys (title, description, is_default, is_active)
  SELECT 'WAK Standard Survey', 'Default customer satisfaction survey', true, true
  WHERE NOT EXISTS (SELECT 1 FROM surveys WHERE is_default = true)
  RETURNING id
)
INSERT INTO survey_questions (survey_id, question_text, question_type, order_index)
SELECT id, q.question_text, q.question_type, q.order_index
FROM new_survey, (VALUES
  ('How would you rate the quality of our service?', 'rating',    1),
  ('Would you recommend WAK Solutions to others?',   'yes_no',    2),
  ('Any additional comments or suggestions?',        'free_text', 3)
) AS q(question_text, question_type, order_index);
