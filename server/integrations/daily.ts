/**
 * daily.ts — Daily.co video room creation.
 *
 * Extracted from the booking route in routes.ts so that the Daily.co API
 * call is isolated, testable, and easy to swap out if the provider changes.
 */

import { createLogger } from '../lib/logger';

const logger = createLogger('daily');

export interface DailyRoom {
  /** The full Daily.co room URL, e.g. https://wak.daily.co/abc123 */
  url: string;
  /** The room name slug */
  name: string;
}

/**
 * Create a Daily.co video room that expires in 24 hours.
 *
 * @throws Error if DAILY_API_KEY is not set or the API call fails.
 */
export async function createDailyRoom(): Promise<DailyRoom> {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    throw new Error('DAILY_API_KEY is not configured — cannot create meeting room');
  }

  logger.info('Creating Daily.co room');

  const response = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      properties: {
        enable_prejoin_ui: false,
        enable_knocking: false,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // expires in 24 hours
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error('Daily.co room creation failed', `status: ${response.status}, body: ${errText.slice(0, 200)}`);
    throw new Error(`Daily.co room creation failed: ${errText}`);
  }

  const data = (await response.json()) as any;
  logger.info('Daily.co room created', `name: ${data.name}`);

  return { url: data.url as string, name: data.name as string };
}
