import { pool } from '../db';
import { createLogger, maskPhone } from './logger';

const logger = createLogger('whatsapp');

function sanitizePhone(phone: string): string {
  return (phone ?? '').replace(/\D/g, '').replace(/^00/, '');
}

export async function sendWhatsAppText(
  companyId: number,
  phone: string,
  body: string
): Promise<boolean> {
  const to = sanitizePhone(phone);
  if (!to) {
    logger.error('sendWhatsAppText skipped — empty phone', `companyId: ${companyId}`);
    return false;
  }

  const credRes = await pool.query(
    `SELECT whatsapp_phone_number_id, whatsapp_token FROM companies WHERE id = $1`,
    [companyId]
  );
  const creds = credRes.rows[0];
  if (!creds?.whatsapp_phone_number_id || !creds?.whatsapp_token) {
    logger.error('sendWhatsAppText — missing credentials', `companyId: ${companyId}`);
    return false;
  }

  const url = `https://graph.facebook.com/v19.0/${creds.whatsapp_phone_number_id}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.whatsapp_token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      logger.error(
        'Meta send failed',
        `phone: ${maskPhone(to)}, status: ${res.status}, body: ${errBody.slice(0, 200)}`
      );
      return false;
    }
    logger.info('WhatsApp sent', `phone: ${maskPhone(to)}`);
    return true;
  } catch (e: any) {
    logger.error('WhatsApp send exception', `phone: ${maskPhone(to)}, error: ${e.message}`);
    return false;
  }
}
