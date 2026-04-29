/**
 * email.ts — All email is sent via Brevo HTTP API.
 *
 * Requires env vars: BREVO_API_KEY, BREVO_FROM_EMAIL, BREVO_FROM_NAME (optional)
 * Admin recipients are resolved from the agents table.
 */

import { BrevoClient } from '@getbrevo/brevo';
import { pool } from "./db";
import { createLogger } from "./lib/logger";
import { getCompanyBranding } from "./routes/settings.routes";

const logger = createLogger("email");

// ── SMTP DISABLED — Railway blocks outbound SMTP (ports 25, 465, 587)
// ── Kept for reference in case SMTP becomes available later
// ── All email sending now goes through Brevo HTTP API
//
// import nodemailer from 'nodemailer';
//
// const transporter = nodemailer.createTransport({
//   service: 'gmail',
//   auth: {
//     user: process.env.GMAIL_ADDRESS,
//     pass: process.env.GMAIL_APP_PASSWORD,
//   },
// });
//
// /** Send an email via Gmail SMTP using nodemailer. Fire-and-forget safe. */
// export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
//   const gmailAddress = process.env.GMAIL_ADDRESS;
//   if (!gmailAddress) {
//     logger.warn("sendEmail — GMAIL_ADDRESS not set, skipping email", `to: ${maskEmail(to)}`);
//     return;
//   }
//   console.log(`[EMAIL] BEFORE send — to: ${to}, subject: ${subject}`);
//   try {
//     const info = await transporter.sendMail({
//       from: `WAK Solutions <${gmailAddress}>`,
//       to,
//       subject,
//       html: body,
//     });
//     console.log(`[EMAIL] AFTER send — messageId: ${info.messageId}`);
//     logger.info("sendEmail — sent", `to: ${maskEmail(to)}, messageId: ${info.messageId}`);
//   } catch (err: any) {
//     console.log(`[EMAIL] ERROR send — ${err.message}`);
//     logger.error("sendEmail — failed", `to: ${maskEmail(to)}, error: ${err.message}`);
//   }
// }

const brevoClient = new BrevoClient({ apiKey: process.env.BREVO_API_KEY! });

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.charAt(0)}***@${domain}`;
}

function buildGoogleCalendarUrl(opts: {
  title: string;
  scheduledUtc: Date;
  meetingLink: string;
}): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const start = fmt(opts.scheduledUtc);
  const end = fmt(new Date(opts.scheduledUtc.getTime() + 3600000));
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${start}/${end}`,
    details: `Join the meeting: ${opts.meetingLink}`,
    sf: "true",
    output: "xml",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

async function resolveAdminEmails(companyId: number): Promise<string[]> {
  const emails: string[] = [];
  try {
    const result = await pool.query(
      `SELECT email FROM agents
       WHERE company_id = $1 AND role = 'admin' AND is_active = true AND email IS NOT NULL`,
      [companyId]
    );
    for (const row of result.rows) {
      if (row.email && !emails.includes(row.email)) emails.push(row.email);
    }
    if (emails.length > 0) {
      logger.info("resolveAdminEmails", `companyId: ${companyId}, found: ${emails.length} admin(s)`);
    } else {
      logger.warn("resolveAdminEmails — no admin emails found in DB", `companyId: ${companyId}`);
    }
  } catch (err: any) {
    logger.error("resolveAdminEmails — DB lookup failed", `companyId: ${companyId}, error: ${err.message}`);
  }
  const override = process.env.MANAGER_EMAIL;
  if (override && !emails.includes(override)) {
    emails.push(override);
    logger.info("resolveAdminEmails — appended MANAGER_EMAIL override", maskEmail(override));
  }
  return emails;
}

/** Send an email via Brevo HTTP API. Fire-and-forget safe. */
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  try {
    const result = await brevoClient.transactionalEmails.sendTransacEmail({
      sender: {
        email: process.env.BREVO_FROM_EMAIL!,
        name: process.env.BREVO_FROM_NAME || 'Notifications',
      },
      to: [{ email: to }],
      subject,
      htmlContent: body,
    });
    console.log('[EMAIL] Brevo sent —', to);
    logger.info("sendEmail — sent via Brevo", `to: ${maskEmail(to)}, messageId: ${(result as any)?.messageId ?? 'n/a'}`);
  } catch (error: any) {
    console.error('[EMAIL] Brevo error —', error.message);
    logger.error("sendEmail — Brevo failed", `to: ${maskEmail(to)}, error: ${error.message}`);
  }
}

export async function notifyManagerNewBooking(opts: {
  companyId: number;
  customerPhone: string;
  dateTimeLabel: string;
  meetingLink: string;
  scheduledUtc: Date;
}): Promise<void> {
  const recipients = await resolveAdminEmails(opts.companyId);
  if (recipients.length === 0) {
    logger.error(
      "notifyManagerNewBooking — no recipient email found",
      `companyId: ${opts.companyId} — set MANAGER_EMAIL or ensure an admin has an email address`
    );
    return;
  }

  const { brandName } = await getCompanyBranding(opts.companyId);

  const calUrl = buildGoogleCalendarUrl({
    title: `${brandName} Meeting — ${opts.customerPhone}`,
    scheduledUtc: opts.scheduledUtc,
    meetingLink: opts.meetingLink,
  });
  const year = new Date().getFullYear();

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#0F510F;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${brandName}</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">New Meeting Booking</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 24px;color:#222;font-size:15px;line-height:1.6;">A customer has just booked a meeting:</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f0;border:1px solid #c8e6c9;border-radius:10px;margin-bottom:28px;">
            <tr><td style="padding:22px 26px;">
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Customer</p>
              <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#222;">${opts.customerPhone}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Date &amp; Time (AST — UTC+3)</p>
              <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#0F510F;">${opts.dateTimeLabel}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Meeting Link</p>
              <a href="${opts.meetingLink}" style="font-size:14px;color:#0F510F;font-weight:600;word-break:break-all;">${opts.meetingLink}</a><br />
              <a href="${opts.meetingLink}" style="display:inline-block;margin-top:12px;background:#0F510F;color:#fff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:600;">Join Meeting</a>
            </td></tr>
          </table>
          <a href="${calUrl}" target="_blank" style="display:inline-block;background:#4285F4;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600;margin-bottom:24px;">&#128197; Add to Google Calendar</a>
          <p style="margin:0;color:#555;font-size:13px;">The customer will receive a WhatsApp reminder 15 minutes before the meeting.</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;border-top:1px solid #eee;padding:16px 32px;">
          <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">&copy; ${year} ${brandName}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  for (const to of recipients) {
    logger.info("notifyManagerNewBooking — sending", `to: ${maskEmail(to)}, companyId: ${opts.companyId}`);
    await sendEmail(to, `New Meeting Booking — ${opts.customerPhone}`, html);
  }
}
