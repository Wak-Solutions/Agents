/**
 * statistics.routes.ts — Dashboard metrics and AI summary routes.
 */

import { z } from 'zod';
import type { Express } from 'express';

import { pool } from '../db';
import { storage } from '../storage';
import { requireAuth } from '../middleware/auth';
import { createLogger } from '../lib/logger';

const logger = createLogger('statistics');

export function registerStatisticsRoutes(app: Express): void {

  // GET /api/statistics?from=YYYY-MM-DD&to=YYYY-MM-DD
  app.get('/api/statistics', requireAuth, async (req: any, res: any) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      if (!from || !to) {
        return res.status(400).json({ message: 'Missing from/to query params' });
      }
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ message: 'Invalid date format' });
      }
      const MAX_RANGE_DAYS = 366;
      const rangeDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
      if (rangeDays < 0) {
        return res.status(400).json({ message: "'from' must be before 'to'" });
      }
      if (rangeDays > MAX_RANGE_DAYS) {
        return res.status(400).json({ message: `Date range may not exceed ${MAX_RANGE_DAYS} days` });
      }
      const companyId: number = req.companyId;
      const [totalCustomers, perDay] = await Promise.all([
        storage.getTotalUniqueCustomers(fromDate, toDate, companyId),
        storage.getStatsCustomersPerDay(fromDate, toDate, companyId),
      ]);
      res.json({ totalCustomers, perDay });
    } catch (err: any) {
      logger.error('getStatistics failed', `companyId: ${req.companyId}, agentId: ${req.session?.agentId}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  // POST /api/statistics/summary — AI-generated summary of inbound messages
  app.post('/api/statistics/summary', requireAuth, async (req: any, res: any) => {
    try {
      const { from, to } = z.object({ from: z.string(), to: z.string() }).parse(req.body);
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ message: 'Invalid date format' });
      }
      const summaryRangeDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
      if (summaryRangeDays < 0 || summaryRangeDays > 366) {
        return res.status(400).json({ message: 'Date range must be between 0 and 366 days' });
      }
      const companyId: number = req.companyId;

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          message: 'OPENAI_API_KEY is not configured. Add it to wak-dash/.env and restart.',
        });
      }

      const msgs = await storage.getInboundMessagesForSummary(fromDate, toDate, companyId);
      if (msgs.length === 0) {
        return res.json({ summary: 'No customer messages found in the selected period.' });
      }

      const companyRes = await pool.query('SELECT name FROM companies WHERE id = $1', [companyId]);
      const companyName = companyRes.rows[0]?.name ?? 'your company';

      const msgBlock = msgs
        .map(
          (m) =>
            `[${new Date(m.created_at!).toLocaleDateString()}] ${m.customer_phone.replace(/^(.*)(.{4})$/, '****$2')}: ${m.message_text.slice(0, 200)}`
        )
        .join('\n');

      const prompt = [
        `You are reviewing customer support conversations for ${companyName}.`,
        `Period: ${fromDate.toDateString()} to ${toDate.toDateString()}. Total inbound messages: ${msgs.length}.`,
        ``,
        `Summarise the following customer messages in 3–5 sentences covering:`,
        `1. The most common topics or questions`,
        `2. Any recurring complaints or issues`,
        `3. Overall customer sentiment`,
        ``,
        `Messages (most recent first):`,
        msgBlock,
      ].join('\n');

      logger.info(
        'OpenAI summary request',
        `model: ${process.env.OPENAI_MODEL ?? 'gpt-4o-mini'}, messages: ${msgs.length}, period: ${from} to ${to}`
      );

      const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 400,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!openAiRes.ok) {
        const errText = await openAiRes.text();
        logger.error('OpenAI summary failed', `status: ${openAiRes.status}, body: ${errText.slice(0, 200)}`);
        return res.status(502).json({ message: 'OpenAI request failed. Check server logs.' });
      }

      const json = (await openAiRes.json()) as any;
      const summary: string =
        json.choices?.[0]?.message?.content?.trim() ?? 'Could not generate summary.';

      logger.info('OpenAI summary success', `model: ${process.env.OPENAI_MODEL ?? 'gpt-4o-mini'}, summary_chars: ${summary.length}`);
      res.json({ summary });
    } catch (err: any) {
      logger.error('getSummary failed', `companyId: ${req.companyId}, agentId: ${req.session?.agentId}, error: ${err.message}`);
      res.status(500).json({ message: 'Internal error' });
    }
  });
}
