import { Resend } from "resend";

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

export async function notifyManagerNewBooking(opts: {
  customerPhone: string;
  dateTimeLabel: string;
  meetingLink: string;
  scheduledUtc: Date;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping manager notification email");
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const calUrl = buildGoogleCalendarUrl({
    title: `WAK Solutions Meeting — ${opts.customerPhone}`,
    scheduledUtc: opts.scheduledUtc,
    meetingLink: opts.meetingLink,
  });
  const year = new Date().getFullYear();

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#0F510F;padding:28px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">WAK Solutions</h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">New Meeting Booking</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 24px;color:#222;font-size:15px;line-height:1.6;">
                A customer has just booked a meeting. Here are the details:
              </p>

              <!-- Details card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f0;border:1px solid #c8e6c9;border-radius:10px;margin-bottom:28px;">
                <tr>
                  <td style="padding:22px 26px;">

                    <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;">Customer</p>
                    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#222;">${opts.customerPhone}</p>

                    <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;">Date &amp; Time (AST — UTC+3)</p>
                    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#0F510F;">${opts.dateTimeLabel}</p>

                    <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;">Meeting Link</p>
                    <a href="${opts.meetingLink}" style="font-size:14px;color:#0F510F;font-weight:600;word-break:break-all;text-decoration:none;">${opts.meetingLink}</a>
                    <br />
                    <a href="${opts.meetingLink}" style="display:inline-block;margin-top:12px;background:#0F510F;color:#fff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:600;">Join Meeting</a>

                  </td>
                </tr>
              </table>

              <!-- Google Calendar button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td>
                    <a href="${calUrl}" target="_blank" style="display:inline-block;background:#4285F4;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600;">
                      &#128197; Add to Google Calendar
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:#555;font-size:13px;line-height:1.6;">
                The customer will receive a WhatsApp reminder with the meeting link 15 minutes before the meeting starts.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;border-top:1px solid #eee;padding:16px 32px;">
              <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">
                &copy; ${year} WAK Solutions. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
    to: process.env.MANAGER_EMAIL || "ammarkateb323@gmail.com",
    subject: `New Meeting Booking — ${opts.customerPhone}`,
    html,
  });
}
