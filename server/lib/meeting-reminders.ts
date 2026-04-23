import { pool } from '../db';
import { createLogger, maskPhone } from './logger';
import { sendWhatsAppText } from './whatsapp';

const logger = createLogger('meeting-reminders');

const CHECK_INTERVAL_MS = 60 * 1000; // every minute
const REMIND_MIN_BEFORE = 15;        // 15 minutes before start

async function tick(): Promise<void> {
  try {
    // Meetings that (a) have a scheduled_at in the next ~15 minutes
    // (14..16 min window to absorb scheduling jitter), (b) haven't had
    // their link sent yet, and (c) still have a meeting_link.
    const result = await pool.query(
      `SELECT id, customer_phone, meeting_link, scheduled_at, company_id
       FROM meetings
       WHERE link_sent = FALSE
         AND meeting_link IS NOT NULL
         AND scheduled_at IS NOT NULL
         AND scheduled_at BETWEEN NOW() + INTERVAL '${REMIND_MIN_BEFORE - 1} minutes'
                              AND NOW() + INTERVAL '${REMIND_MIN_BEFORE + 1} minutes'
       LIMIT 50`
    );

    for (const m of result.rows) {
      // Claim the row first so we don't double-send on overlapping ticks
      const claim = await pool.query(
        `UPDATE meetings SET link_sent = TRUE WHERE id = $1 AND link_sent = FALSE RETURNING id`,
        [m.id]
      );
      if (claim.rows.length === 0) continue;

      const ok = await sendWhatsAppText(
        m.company_id,
        m.customer_phone,
        `Your meeting with WAK Solutions starts in 15 minutes.\n\nJoin here: ${m.meeting_link}`
      );

      if (ok) {
        logger.info('Reminder sent', `meetingId: ${m.id}, phone: ${maskPhone(m.customer_phone)}`);
      } else {
        // Release the claim so a later tick can retry
        await pool.query(`UPDATE meetings SET link_sent = FALSE WHERE id = $1`, [m.id]).catch(() => {});
        logger.error('Reminder send failed — released claim', `meetingId: ${m.id}`);
      }
    }
  } catch (e: any) {
    logger.error('Reminder tick failed', e.message);
  }
}

export function startMeetingReminderCron(): void {
  setInterval(tick, CHECK_INTERVAL_MS);
  logger.info('Meeting reminder cron started', `interval: ${CHECK_INTERVAL_MS}ms`);
}
