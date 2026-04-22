import crypto from 'crypto';
import { pool } from './db';
import { z } from 'zod';
import { createLogger } from './lib/logger';

const logger = createLogger('surveys');

// ── Migration + seed (runs on startup, fully idempotent) ─────────────────────

export async function ensureSurveyTables(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS surveys (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      is_default  BOOLEAN DEFAULT false,
      is_active   BOOLEAN DEFAULT false,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS survey_questions (
      id            SERIAL PRIMARY KEY,
      survey_id     INTEGER REFERENCES surveys(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL,
      order_index   INTEGER NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS survey_responses (
      id             SERIAL PRIMARY KEY,
      survey_id      INTEGER REFERENCES surveys(id),
      token          TEXT UNIQUE NOT NULL,
      customer_phone TEXT NOT NULL,
      agent_id       INTEGER,
      escalation_id  INTEGER,
      meeting_id     INTEGER REFERENCES meetings(id),
      submitted      BOOLEAN DEFAULT false,
      submitted_at   TIMESTAMPTZ,
      expires_at     TIMESTAMPTZ NOT NULL,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS survey_answers (
      id            SERIAL PRIMARY KEY,
      response_id   INTEGER REFERENCES survey_responses(id) ON DELETE CASCADE,
      question_id   INTEGER REFERENCES survey_questions(id),
      answer_text   TEXT,
      answer_rating INTEGER,
      answer_yes_no BOOLEAN,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS one_active_survey ON surveys (is_active) WHERE is_active = true`,
    // ── Column migrations ──
    `ALTER TABLE surveys          ADD COLUMN IF NOT EXISTS is_default    BOOLEAN DEFAULT false`,
    `ALTER TABLE surveys          ADD COLUMN IF NOT EXISTS company_id    INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS agent_id      INTEGER`,
    `ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS escalation_id INTEGER`,
    `ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS meeting_id    INTEGER REFERENCES meetings(id)`,
    `ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS company_id    INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE survey_answers   ADD COLUMN IF NOT EXISTS answer_yes_no BOOLEAN`,
    // Seed default survey — skipped if one already exists
    `WITH new_survey AS (
       INSERT INTO surveys (title, description, is_default, is_active, company_id)
       SELECT 'WAK Standard Survey', 'Default customer satisfaction survey', true, true, 1
       WHERE NOT EXISTS (SELECT 1 FROM surveys WHERE is_default = true)
       RETURNING id
     )
     INSERT INTO survey_questions (survey_id, question_text, question_type, order_index)
     SELECT id, q.question_text, q.question_type, q.order_index
     FROM new_survey, (VALUES
       ('How would you rate the quality of our service?', 'rating',    1),
       ('Would you recommend WAK Solutions to others?',   'yes_no',    2),
       ('Any additional comments or suggestions?',        'free_text', 3)
     ) AS q(question_text, question_type, order_index)`,
  ];
  for (const sql of statements) {
    await pool.query(sql);
  }
}

// ── Survey trigger helper ─────────────────────────────────────────────────────
// Called after escalation close or meeting complete (fire-and-forget from caller).

export async function sendSurveyToCustomer(
  customerPhone: string,
  agentId: number | null,
  escalationId: number | null,
  meetingId: number | null = null,
  companyId: number = 1,
): Promise<void> {
  try {
    // Prefer a company-scoped active survey; fall back to any active survey.
    let surveyRes = await pool.query(
      `SELECT id FROM surveys WHERE is_active = true AND company_id = $1 LIMIT 1`,
      [companyId]
    );
    if (surveyRes.rows.length === 0) {
      surveyRes = await pool.query(
        `SELECT id FROM surveys WHERE is_active = true LIMIT 1`
      );
    }
    if (surveyRes.rows.length === 0) return;
    const surveyId = surveyRes.rows[0].id;
    if (!surveyId) return;

    const token = crypto.randomUUID();

    await pool.query(
      `INSERT INTO survey_responses (survey_id, token, customer_phone, agent_id, escalation_id, meeting_id, company_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '24 hours')`,
      [surveyId, token, customerPhone, agentId, escalationId, meetingId, companyId]
    );

    const rawBase = (
      process.env.APP_URL ||
      process.env.RAILWAY_PUBLIC_URL ||
      process.env.RAILWAY_PUBLIC_DOMAIN ||
      'wak-agent.up.railway.app'
    ).replace(/\/$/, '');
    const baseUrl = rawBase.startsWith('http') ? rawBase : `https://${rawBase}`;
    const surveyLink = `${baseUrl}/survey/${token}`;
    const message =
      `Thank you for contacting WAK Solutions! 😊\n` +
      `We'd love to hear your feedback — it only takes 1 minute:\n` +
      `${surveyLink}\n` +
      `This link expires in 24 hours.`;

  } catch (e: any) {
    logger.error('sendSurveyToCustomer failed', e.message);
  }
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerSurveyRoutes(app: any, requireAuth: any): void {

  // ── Admin: summary for Statistics tab ─────────────────────────────────────
  // Must come before /api/surveys/:id to avoid "active-summary" matching as id

  app.get('/api/surveys/active-summary', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const activeSurveyRes = await pool.query(
        `SELECT id, title FROM surveys WHERE is_active = true AND company_id = $1 LIMIT 1`,
        [companyId]
      );
      if (activeSurveyRes.rows.length === 0) {
        return res.json({ survey_id: null });
      }
      const { id: survey_id, title } = activeSurveyRes.rows[0];

      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      weekStart.setHours(0, 0, 0, 0);

      const statsRes = await pool.query(
        `SELECT
           COUNT(*)::int AS weekly_sent,
           COUNT(*) FILTER (WHERE submitted = true)::int AS weekly_submitted,
           (SELECT ROUND(AVG(sa.answer_rating)::numeric, 1)
            FROM survey_answers sa
            JOIN survey_responses sr ON sr.id = sa.response_id
            WHERE sr.survey_id = $1 AND sr.submitted = true AND sr.company_id = $3
              AND sa.answer_rating IS NOT NULL AND sr.created_at >= $2
           ) AS avg_rating_this_week
         FROM survey_responses
         WHERE survey_id = $1 AND company_id = $3 AND created_at >= $2`,
        [survey_id, weekStart.toISOString(), companyId]
      );

      const row = statsRes.rows[0];
      res.json({
        survey_id,
        title,
        weekly_sent: row.weekly_sent,
        weekly_submitted: row.weekly_submitted,
        avg_rating_this_week: row.avg_rating_this_week
          ? parseFloat(row.avg_rating_this_week)
          : null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: Survey CRUD ─────────────────────────────────────────────────────

  app.get('/api/surveys', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const result = await pool.query(
        `SELECT s.*,
           (SELECT COUNT(*) FROM survey_questions sq WHERE sq.survey_id = s.id)::int AS question_count,
           (SELECT COUNT(*) FROM survey_responses sr WHERE sr.survey_id = s.id AND sr.company_id = $1)::int AS response_count,
           (SELECT COUNT(*) FROM survey_responses sr WHERE sr.survey_id = s.id AND sr.company_id = $1 AND sr.submitted = true)::int AS submitted_count
         FROM surveys s
         WHERE s.company_id = $1
         ORDER BY s.is_default DESC, s.created_at DESC`,
        [companyId]
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/surveys', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const { title, description } = z.object({
        title: z.string().min(1),
        description: z.string().optional().default(''),
      }).parse(req.body);
      const result = await pool.query(
        `INSERT INTO surveys (title, description, company_id) VALUES ($1, $2, $3) RETURNING *`,
        [title, description, companyId]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get('/api/surveys/:id', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const surveyRes = await pool.query(
        `SELECT * FROM surveys WHERE id = $1 AND company_id = $2`,
        [req.params.id, companyId]
      );
      if (surveyRes.rows.length === 0) return res.status(404).json({ message: 'Survey not found' });
      const questionsRes = await pool.query(
        `SELECT * FROM survey_questions WHERE survey_id = $1 ORDER BY order_index`,
        [req.params.id]
      );
      res.json({ ...surveyRes.rows[0], questions: questionsRes.rows });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put('/api/surveys/:id', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const { title, description } = z.object({
        title: z.string().min(1),
        description: z.string().optional().default(''),
      }).parse(req.body);
      const result = await pool.query(
        `UPDATE surveys SET title=$1, description=$2, updated_at=NOW() WHERE id=$3 AND company_id=$4 RETURNING *`,
        [title, description, req.params.id, companyId]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Survey not found' });
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete('/api/surveys/:id', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const survey = await pool.query(
        `SELECT is_default FROM surveys WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (survey.rows.length === 0) return res.status(404).json({ message: 'Survey not found' });
      if (survey.rows[0].is_default) {
        return res.status(403).json({ message: 'The default survey cannot be deleted.' });
      }
      await pool.query(`DELETE FROM surveys WHERE id=$1 AND company_id=$2`, [req.params.id, companyId]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/surveys/:id/activate', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      await pool.query(`UPDATE surveys SET is_active=false, updated_at=NOW() WHERE company_id=$1`, [companyId]);
      const result = await pool.query(
        `UPDATE surveys SET is_active=true, updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *`,
        [req.params.id, companyId]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Survey not found' });
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/surveys/:id/deactivate', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const result = await pool.query(
        `UPDATE surveys SET is_active=false, updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *`,
        [req.params.id, companyId]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Survey not found' });
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: Question Management ─────────────────────────────────────────────

  app.post('/api/surveys/:id/questions', requireAuth, async (req: any, res: any) => {
    try {
      // Verify the survey belongs to this company before adding questions
      const companyId: number = req.session.companyId;
      const surveyCheck = await pool.query(
        `SELECT id FROM surveys WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (surveyCheck.rows.length === 0) return res.status(404).json({ message: 'Survey not found' });

      const { question_text, question_type, order_index } = z.object({
        question_text: z.string().min(1),
        question_type: z.enum(['rating', 'yes_no', 'free_text']),
        order_index: z.number().int(),
      }).parse(req.body);
      const result = await pool.query(
        `INSERT INTO survey_questions (survey_id, question_text, question_type, order_index)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.params.id, question_text, question_type, order_index]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // IMPORTANT: reorder must come BEFORE /:qid
  app.put('/api/surveys/:id/questions/reorder', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      // Verify survey belongs to this company before touching its questions.
      const surveyCheck = await pool.query(
        `SELECT id FROM surveys WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (surveyCheck.rows.length === 0) return res.status(404).json({ message: 'Survey not found' });

      const items = z.array(z.object({ id: z.number(), order_index: z.number() })).parse(req.body);
      // Batch all updates in a single transaction instead of N individual queries.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const item of items) {
          await client.query(
            `UPDATE survey_questions SET order_index=$1 WHERE id=$2 AND survey_id=$3`,
            [item.order_index, item.id, req.params.id]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.put('/api/surveys/:id/questions/:qid', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      // Verify survey belongs to this company before updating its questions.
      const surveyCheck = await pool.query(
        `SELECT id FROM surveys WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (surveyCheck.rows.length === 0) return res.status(404).json({ message: 'Survey not found' });

      const { question_text, question_type, order_index } = z.object({
        question_text: z.string().min(1),
        question_type: z.enum(['rating', 'yes_no', 'free_text']),
        order_index: z.number().int(),
      }).parse(req.body);
      const result = await pool.query(
        `UPDATE survey_questions
         SET question_text=$1, question_type=$2, order_index=$3
         WHERE id=$4 AND survey_id=$5 RETURNING *`,
        [question_text, question_type, order_index, req.params.qid, req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Question not found' });
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete('/api/surveys/:id/questions/:qid', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      // Verify survey belongs to this company before deleting its questions.
      const surveyCheck = await pool.query(
        `SELECT id FROM surveys WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (surveyCheck.rows.length === 0) return res.status(404).json({ message: 'Survey not found' });

      await pool.query(
        `DELETE FROM survey_questions WHERE id=$1 AND survey_id=$2`,
        [req.params.qid, req.params.id]
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: Results ─────────────────────────────────────────────────────────

  app.get('/api/surveys/:id/results', requireAuth, async (req: any, res: any) => {
    try {
      const companyId: number = req.session.companyId;
      const surveyRes = await pool.query(
        `SELECT * FROM surveys WHERE id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      if (surveyRes.rows.length === 0) return res.status(404).json({ message: 'Survey not found' });

      const totalRes = await pool.query(
        `SELECT COUNT(*)::int AS total_sent,
                COUNT(*) FILTER (WHERE submitted=true)::int AS total_submitted
         FROM survey_responses WHERE survey_id=$1 AND company_id=$2`,
        [req.params.id, companyId]
      );
      const { total_sent, total_submitted } = totalRes.rows[0];

      const questionsRes = await pool.query(
        `SELECT * FROM survey_questions WHERE survey_id=$1 ORDER BY order_index`,
        [req.params.id]
      );

      const answersRes = await pool.query(
        `SELECT sa.question_id, sa.answer_text, sa.answer_rating, sa.answer_yes_no
         FROM survey_answers sa
         JOIN survey_responses sr ON sr.id = sa.response_id
         WHERE sr.survey_id=$1 AND sr.submitted=true AND sr.company_id=$2`,
        [req.params.id, companyId]
      );

      const answerMap = new Map<number, any[]>();
      for (const a of answersRes.rows) {
        if (!answerMap.has(a.question_id)) answerMap.set(a.question_id, []);
        answerMap.get(a.question_id)!.push(a);
      }

      const questions = questionsRes.rows.map((q: any) => {
        const answers = answerMap.get(q.id) ?? [];
        if (q.question_type === 'rating') {
          const rated = answers.filter((a: any) => a.answer_rating != null);
          const avg = rated.length
            ? rated.reduce((s: number, a: any) => s + a.answer_rating, 0) / rated.length
            : null;
          const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
          for (const a of rated) distribution[String(a.answer_rating)] = (distribution[String(a.answer_rating)] || 0) + 1;
          return { question_id: q.id, question_text: q.question_text, question_type: q.question_type,
            avg_score: avg != null ? parseFloat(avg.toFixed(1)) : null, distribution };
        }
        if (q.question_type === 'yes_no') {
          const yes_count = answers.filter((a: any) => a.answer_yes_no === true).length;
          const no_count  = answers.filter((a: any) => a.answer_yes_no === false).length;
          return { question_id: q.id, question_text: q.question_text, question_type: q.question_type,
            yes_count, no_count };
        }
        // free_text
        return { question_id: q.id, question_text: q.question_text, question_type: q.question_type,
          answers: answers.map((a: any) => a.answer_text).filter(Boolean) };
      });

      const agentRes = await pool.query(
        `SELECT sr.agent_id,
           COUNT(DISTINCT sr.id)::int AS chats_handled,
           ROUND(AVG(sa.answer_rating)::numeric, 1) AS avg_rating
         FROM survey_responses sr
         LEFT JOIN survey_answers sa ON sa.response_id = sr.id AND sa.answer_rating IS NOT NULL
         WHERE sr.survey_id=$1 AND sr.submitted=true AND sr.company_id=$2
         GROUP BY sr.agent_id`,
        [req.params.id, companyId]
      );
      const per_agent = agentRes.rows.map((r: any) => ({
        agent_id: r.agent_id,
        agent_name: r.agent_id ? `Agent #${r.agent_id}` : 'Unknown',
        chats_handled: r.chats_handled,
        avg_rating: r.avg_rating ? parseFloat(r.avg_rating) : null,
      }));

      res.json({
        total_sent,
        total_submitted,
        response_rate: total_sent > 0 ? Math.round((total_submitted / total_sent) * 100) : 0,
        questions,
        per_agent,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public: Survey submission ──────────────────────────────────────────────
  // These routes use the token for identity — no company_id needed in the lookup
  // since tokens are globally unique UUIDs.

  app.get('/api/survey/:token', async (req: any, res: any) => {
    try {
      const responseRes = await pool.query(
        `SELECT sr.*, s.title, s.description
         FROM survey_responses sr
         JOIN surveys s ON s.id = sr.survey_id
         WHERE sr.token = $1`,
        [req.params.token]
      );
      if (responseRes.rows.length === 0) return res.status(410).json({ message: 'Invalid or expired survey link.' });
      const response = responseRes.rows[0];
      if (response.submitted) return res.status(410).json({ message: 'This survey has already been submitted.' });
      if (new Date(response.expires_at) < new Date()) return res.status(410).json({ message: 'This survey link has expired.' });

      const questionsRes = await pool.query(
        `SELECT id, question_text, question_type, order_index
         FROM survey_questions WHERE survey_id=$1 ORDER BY order_index`,
        [response.survey_id]
      );
      res.json({
        survey_id: response.survey_id,
        title: response.title,
        description: response.description,
        questions: questionsRes.rows,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/survey/:token/submit', async (req: any, res: any) => {
    try {
      const responseRes = await pool.query(
        `SELECT * FROM survey_responses WHERE token=$1`,
        [req.params.token]
      );
      if (responseRes.rows.length === 0) return res.status(410).json({ message: 'Invalid survey link.' });
      const response = responseRes.rows[0];
      if (response.submitted) return res.status(410).json({ message: 'Already submitted.' });
      if (new Date(response.expires_at) < new Date()) return res.status(410).json({ message: 'Link expired.' });

      const answers = z.array(z.object({
        question_id: z.number(),
        answer_text:   z.string().optional().nullable(),
        answer_rating: z.number().int().min(1).max(5).optional().nullable(),
        answer_yes_no: z.boolean().optional().nullable(),
      })).parse(req.body.answers ?? []);

      for (const a of answers) {
        await pool.query(
          `INSERT INTO survey_answers (response_id, question_id, answer_text, answer_rating, answer_yes_no)
           VALUES ($1, $2, $3, $4, $5)`,
          [response.id, a.question_id, a.answer_text ?? null, a.answer_rating ?? null, a.answer_yes_no ?? null]
        );
      }

      await pool.query(
        `UPDATE survey_responses SET submitted=true, submitted_at=NOW() WHERE id=$1`,
        [response.id]
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });
}
