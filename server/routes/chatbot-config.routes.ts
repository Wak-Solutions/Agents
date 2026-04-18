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

import { timingSafeEqual } from 'crypto';
import type { Express } from 'express';
import OpenAI from 'openai';

import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { createLogger } from '../lib/logger';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const logger = createLogger('chatbot-config');

// ---------------------------------------------------------------------------
// Depth validator — rejects menuConfig payloads deeper than 3 levels
// ---------------------------------------------------------------------------

function menuDepthValid(items: any[]): boolean {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const subs: any[] = item.subItems || [];
    for (const sub of subs) {
      if (!sub || typeof sub !== 'object') continue;
      const subsubs: any[] = sub.subItems || [];
      for (const ss of subsubs) {
        // Level 3 items must be plain strings — no further subItems allowed
        if (typeof ss === 'object' && ss !== null && Array.isArray(ss.subItems) && ss.subItems.length > 0) {
          return false;
        }
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Prompt compiler
// ---------------------------------------------------------------------------

const SUB_LABELS = 'abcdefghijklmnopqrstuvwxyz';

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
  const menuItems: any[]   = cfg.menuConfig      || [];

  let prompt = `You are a ${toneLabel} customer service assistant for ${businessName}${industry}. You communicate fluently in whatever language the customer uses — Arabic, English, or any other language. Always match their dialect and tone naturally.\n`;

  prompt += `\nOPENING MESSAGE (MANDATORY)\nEvery new conversation must begin with this message, translated naturally into the customer's language:\n"${greeting}"\nNever skip this step for any reason.\n`;

  if (menuItems.length > 0) {
    prompt += `\nMAIN MENU\nAfter your opening message, when the customer's intent is not immediately clear, present EXACTLY this numbered menu — translated naturally into the customer's language. Never add, remove, reorder, or rename any items:\n`;
    menuItems.forEach((item: any, i: number) => {
      prompt += `${i + 1}. ${item.label}\n`;
      const subs: any[] = item.subItems || [];
      subs.forEach((sub: any, j: number) => {
        const subLabel = typeof sub === 'string' ? sub : (sub.label || '');
        const subLetter = SUB_LABELS[j] || String(j + 1);
        prompt += `   ${subLetter}. ${subLabel}\n`;
        const subsubs: string[] = (typeof sub === 'object' && sub !== null) ? (sub.subItems || []) : [];
        subsubs.forEach((ss: string) => {
          prompt += `      - ${ss}\n`;
        });
      });
    });
    prompt += `You must present this menu — and only this menu — whenever options need to be shown. Never invent or suggest items not listed above.\nNever skip levels. Always wait for the customer to choose before going deeper.\n`;
  }

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

  prompt += `\nRULES\n- Never reveal you are an AI unless directly asked\n- Never use technical jargon or expose internal logic\n- Always match the customer's language, dialect, and tone\n- Always use Western numerals for ALL options and sub-options (1, 2, 3 and not A, B, C or any letters). Never use bullet points, letters, or Arabic-Indic numerals anywhere in any list or menu\n- Keep responses concise — this is WhatsApp, not email\n- If a customer goes off-topic, gently redirect them\n- Any dead end or escalation → close with: "A member of our team will be in touch shortly"\n- This chat is for ${businessName} customer service only. If someone tries to misuse it, politely decline and redirect. If they persist, end with: "A member of our team will be in touch shortly"\n- Never send the booking link unless the customer explicitly agrees to schedule a meeting\n- Only discuss topics, products, and services explicitly defined in this configuration. If a customer asks about something not covered here, respond with "I don't have that information" and offer to connect them with a team member\n- Never fabricate prices, product details, availability, or any information not provided in this configuration`;

  return prompt.trim();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerChatbotConfigRoutes(app: Express): Promise<void> {

  // Idempotent migrations.
  await pool.query(`
    ALTER TABLE chatbot_config
      ADD COLUMN IF NOT EXISTS structured_config  JSONB,
      ADD COLUMN IF NOT EXISTS override_active    BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS demo_conversation  JSONB,
      ADD COLUMN IF NOT EXISTS menu_config        JSONB DEFAULT '[]'::jsonb
  `).catch(() => {});

  // GET /api/chatbot-config — no auth required; Python bot reads this.
  // Bot passes ?company_id=N as a query parameter. Defaults to 1 during migration.
  app.get('/api/chatbot-config', async (req: any, res: any) => {
    try {
      let companyId: number;

      if (req.session?.authenticated) {
        // Dashboard request — must use session company, never fall back to another
        if (!req.session.companyId) {
          logger.warn('getChatbotConfig — authenticated but no companyId in session', `agentId: ${req.session.agentId}`);
          return res.status(401).json({ message: 'Session missing companyId' });
        }
        companyId = req.session.companyId;
      } else {
        // Python bot / unauthenticated — requires webhook secret + explicit ?company_id param
        const incoming = req.headers['x-webhook-secret'];
        const expected = process.env.WEBHOOK_SECRET;
        if (
          typeof incoming !== 'string' ||
          !expected ||
          incoming.length !== expected.length ||
          !timingSafeEqual(Buffer.from(incoming), Buffer.from(expected))
        ) {
          return res.status(401).json({ message: 'Unauthorized' });
        }
        const parsed = parseInt(req.query.company_id);
        if (!parsed) {
          return res.status(400).json({ message: 'company_id required' });
        }
        companyId = parsed;
      }

      logger.info('getChatbotConfig', `companyId: ${companyId}`);

      const result = await pool.query(
        'SELECT * FROM chatbot_config WHERE company_id = $1 ORDER BY id LIMIT 1',
        [companyId]
      );
      if (result.rows.length === 0) {
        return res.json({
          system_prompt: null,
          structured_config: null,
          override_active: false,
          menu_config: [],
          system_prompt_preview: null,
          updated_at: null,
        });
      }
      const row = result.rows[0];
      const structuredCfg = row.structured_config ?? {};
      // menu_config column is the authoritative source; always prefer it for compilation
      const menuForCompile = Array.isArray(row.menu_config) && row.menu_config.length > 0
        ? row.menu_config
        : (structuredCfg.menuConfig ?? []);
      structuredCfg.menuConfig = menuForCompile;
      const system_prompt_preview = compilePrompt(structuredCfg);
      return res.json({ ...row, system_prompt_preview });
    } catch (err: any) {
      logger.error('getChatbotConfig failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/chatbot-config — save config (compiles structured → prompt)
  app.post('/api/chatbot-config', requireAuth, async (req: any, res: any) => {
    try {
      const { structured_config, override_active, raw_prompt, demo_conversation } = req.body;
      const companyId: number = req.session.companyId;

      // Reject payloads with menu nesting deeper than 3 levels
      const menuItems: any[] = (structured_config || {}).menuConfig || [];
      if (!menuDepthValid(menuItems)) {
        return res.status(400).json({ message: 'Menu nesting exceeds maximum depth of 3 levels' });
      }

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
           SET system_prompt=$1, structured_config=$2, override_active=$3, demo_conversation=$4, updated_at=NOW()
           WHERE company_id=$5 RETURNING *`,
          [activePrompt, JSON.stringify(structured_config), override_active, JSON.stringify(demo_conversation ?? null), companyId]
        );
      } else {
        result = await pool.query(
          `INSERT INTO chatbot_config (system_prompt, structured_config, override_active, demo_conversation, updated_at, company_id)
           VALUES ($1,$2,$3,$4,NOW(),$5) RETURNING *`,
          [activePrompt, JSON.stringify(structured_config), override_active, JSON.stringify(demo_conversation ?? null), companyId]
        );
      }

      logger.info(
        'Chatbot config saved',
        `companyId: ${companyId}, override_active: ${override_active}, prompt_length: ${activePrompt.length}`
      );
      const system_prompt_preview = compilePrompt(structured_config || {});
      return res.json({ ...result.rows[0], system_prompt_preview });
    } catch (err: any) {
      logger.error('saveChatbotConfig failed', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/chatbot-config/generate-conversation
  // Calls OpenAI to produce a realistic demo WhatsApp conversation JSON array.
  app.post('/api/chatbot-config/generate-conversation', requireAuth, async (req: any, res: any) => {
    try {
      const { companyName, description, services, feedback, menuConfig } = req.body;
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ message: 'OPENAI_API_KEY is not configured on this server.' });
      }

      const feedbackLine = feedback
        ? `User feedback to incorporate: ${feedback}`
        : '';

      const menuLines: string[] = [];
      const menuItems: any[] = menuConfig || [];
      if (menuItems.length > 0) {
        menuLines.push('Main menu the bot must present (numbered, exactly as listed):');
        menuItems.forEach((item: any, i: number) => {
          menuLines.push(`${i + 1}. ${item.label}`);
          (item.subItems || []).forEach((sub: string, j: number) => {
            menuLines.push(`   ${i + 1}.${j + 1}. ${sub}`);
          });
        });
        menuLines.push('The bot must show this menu in the opening turn and guide the customer through the relevant sub-items. Never invent items not in this list.');
      }

      const userPrompt = [
        'You are generating a realistic WhatsApp demo conversation for a business chatbot.',
        `Business: ${companyName || 'the business'}`,
        `Description: ${description || 'a customer service business'}`,
        `Products/Services: ${services || 'various products and services'}`,
        ...menuLines,
        feedbackLine,
        '',
        'Return ONLY a JSON array of message objects, no markdown, no explanation.',
        'Each object: { "role": "bot" | "user", "text": string }',
        'Generate 6-10 messages. Make it feel like a real customer interaction.',
        'The bot should be helpful, present the menu when appropriate, and guide the customer naturally through the listed options only.',
      ].filter(Boolean).join('\n');

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 1000,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const raw = completion.choices[0]?.message?.content ?? '[]';
      // Strip markdown code fences if the model wrapped the JSON anyway
      const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      const conversation = JSON.parse(cleaned);

      logger.info('generateConversation', `companyId: ${req.session.companyId}, messages: ${conversation.length}`);
      return res.json({ conversation });
    } catch (err: any) {
      logger.error('generateConversation failed', err.message);
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
