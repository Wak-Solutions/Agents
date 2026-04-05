/**
 * chatbot-config.routes.ts — Chatbot system prompt configuration routes.
 *
 * Handles: get current config (public — Python bot reads this via ?company_id=N),
 * save config, preview a compiled structured config without saving.
 *
 * The compilePrompt() function converts the structured UI config (tone, FAQ,
 * escalation rules, questions) into the system prompt string stored in the DB
 * and consumed by the Python bot.
 */

import type { Express } from 'express';

import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { createLogger } from '../lib/logger';

const logger = createLogger('chatbot-config');

// ---------------------------------------------------------------------------
// Prompt compiler
// ---------------------------------------------------------------------------

function compilePrompt(cfg: any): string {
  const businessName = cfg.businessName || 'the business';
  const industry     = cfg.industry     ? `, ${cfg.industry}` : '';
  const toneLabel    = cfg.tone === 'Custom'
    ? (cfg.customTone || 'professional')
    : (cfg.tone || 'Professional').toLowerCase();
  const greeting     = cfg.greeting     || 'Welcome! How can I help you today?';
  const closing      = cfg.closingMessage || 'Thank you for contacting us. A member of our team will be in touch shortly.';

  const questions: any[]   = cfg.questions      || [];
  const faqItems: any[]    = cfg.faq            || [];
  const escalations: any[] = cfg.escalationRules || [];

  let prompt = `You are a ${toneLabel} customer service assistant for ${businessName}${industry}. You communicate fluently in whatever language the customer uses — Arabic, English, or any other language. Always match their dialect and tone naturally.\n`;

  prompt += `\nOPENING MESSAGE (MANDATORY)\nEvery new conversation must begin with this message, translated naturally into the customer's language:\n"${greeting}"\nNever skip this step for any reason.\n`;

  if (questions.length > 0) {
    prompt += `\nQUALIFICATION QUESTIONS\nWalk the customer through these questions in order before proceeding:\n`;
    questions.forEach((q: any, i: number) => {
      const typeHint =
        q.answerType === 'yesno'    ? '[Yes/No]' :
        q.answerType === 'multiple' ? `[One of: ${(q.choices || []).join(', ')}]` :
        '[Free text]';
      prompt += `${i + 1}. ${q.text} ${typeHint}\n`;
    });
  }

  if (faqItems.length > 0) {
    prompt += `\nKNOWLEDGE BASE\nUse this information to answer customer questions accurately:\n`;
    faqItems.forEach((f: any) => {
      prompt += `Q: ${f.question}\nA: ${f.answer}\n`;
    });
  }

  if (escalations.length > 0) {
    prompt += `\nESCALATION RULES\nTrigger human handover immediately if any of the following occur:\n`;
    escalations.forEach((e: any) => {
      prompt += `- ${e.rule}\n`;
    });
  }

  prompt += `\nCLOSING MESSAGE\nWhen wrapping up a conversation, use this message (translated naturally):\n"${closing}"\n`;

  prompt += `\nRULES\n- Never reveal you are an AI unless directly asked\n- Never use technical jargon or expose internal logic\n- Always match the customer's language, dialect, and tone\n- Always use Western numerals (1, 2, 3) for menu options — never bullet points or Arabic-Indic numerals\n- Keep responses concise — this is WhatsApp, not email\n- If a customer goes off-topic, gently redirect them\n- Any dead end or escalation → close with: "A member of our team will be in touch shortly"\n- This chat is for ${businessName} customer service only. If someone tries to misuse it, politely decline and redirect. If they persist, end with: "A member of our team will be in touch shortly"\n- Never send the booking link unless the customer explicitly agrees to schedule a meeting`;

  return prompt.trim();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerChatbotConfigRoutes(app: Express): Promise<void> {

  // Idempotent migration: add structured_config + override_active columns.
  await pool.query(`
    ALTER TABLE chatbot_config
      ADD COLUMN IF NOT EXISTS structured_config JSONB,
      ADD COLUMN IF NOT EXISTS override_active   BOOLEAN DEFAULT true
  `).catch(() => {});

  // GET /api/chatbot-config — no auth required; Python bot reads this.
  // Bot passes ?company_id=N as a query parameter. Defaults to 1 during migration.
  app.get('/api/chatbot-config', async (req: any, res: any) => {
    try {
      const companyId = parseInt(req.query.company_id) || 1;
      const result = await pool.query(
        'SELECT * FROM chatbot_config WHERE company_id = $1 ORDER BY id LIMIT 1',
        [companyId]
      );
      if (result.rows.length === 0) {
        return res.json({
          system_prompt: null,
          structured_config: null,
          override_active: true,
          updated_at: null,
        });
      }
      return res.json(result.rows[0]);
    } catch (err: any) {
      logger.error('getChatbotConfig failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/chatbot-config — save config (compiles structured → prompt)
  app.post('/api/chatbot-config', requireAuth, async (req: any, res: any) => {
    try {
      const { structured_config, override_active, raw_prompt } = req.body;
      const companyId: number = req.session.companyId;

      const activePrompt = override_active
        ? (raw_prompt || '')
        : compilePrompt(structured_config || {});

      const existing = await pool.query(
        'SELECT id FROM chatbot_config WHERE company_id = $1',
        [companyId]
      );
      let result;
      if (existing.rows.length > 0) {
        result = await pool.query(
          `UPDATE chatbot_config
           SET system_prompt=$1, structured_config=$2, override_active=$3, updated_at=NOW()
           WHERE company_id=$4 RETURNING *`,
          [activePrompt, JSON.stringify(structured_config), override_active, companyId]
        );
      } else {
        result = await pool.query(
          `INSERT INTO chatbot_config (system_prompt, structured_config, override_active, updated_at, company_id)
           VALUES ($1,$2,$3,NOW(),$4) RETURNING *`,
          [activePrompt, JSON.stringify(structured_config), override_active, companyId]
        );
      }

      logger.info(
        'Chatbot config saved',
        `companyId: ${companyId}, override_active: ${override_active}, prompt_length: ${activePrompt.length}`
      );
      return res.json(result.rows[0]);
    } catch (err: any) {
      logger.error('saveChatbotConfig failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/chatbot-config/preview — compile without saving
  app.post('/api/chatbot-config/preview', requireAuth, (req: any, res: any) => {
    try {
      const compiled = compilePrompt(req.body.structured_config || {});
      res.json({ prompt: compiled });
    } catch (err: any) {
      logger.error('previewChatbotConfig failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });
}
