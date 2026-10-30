// lib/cronAlert.js
// Branded operational emails for OptiMenu administrators.
// Used by cron jobs, service monitoring, and audit-log alerts.
// Requires RESEND_API_KEY, ALERT_EMAIL_TO, and ALERT_EMAIL_FROM.
// Alert failures never interrupt the original operation.

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

function alertHtml(jobName, summary, details, when, notice) {
  const title = notice ? 'System notification' : 'System alert';
  const status = notice ? 'NOTICE' : 'ATTENTION REQUIRED';
  const accent = notice ? '#02a4ba' : '#c05636';

  const detailRows = details.map((detail) => `
    <tr>
      <td style="padding:7px 0;font:13px/1.6 ${FONT};color:#344448;word-break:break-word;">
        ${escapeHtml(detail)}
      </td>
    </tr>
  `).join('');

  const detailsSection = details.length ? `
    <tr>
      <td style="padding:0 32px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="background:#f5f7f7;border-radius:8px;">
          <tr>
            <td style="padding:18px 20px;">
              <div style="font:700 11px ${FONT};letter-spacing:1px;color:#687a7e;margin-bottom:8px;">
                EVENT DETAILS
              </div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${detailRows}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  ` : '';

  const actionSection = notice ? '' : `
    <tr>
      <td align="center" style="padding:0 32px 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td bgcolor="#101819" style="border-radius:8px;">
              <a href="https://vercel.com/dashboard"
                style="display:inline-block;padding:13px 24px;font:600 14px ${FONT};color:#ffffff;text-decoration:none;">
                View Vercel Dashboard
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:#edf1f2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="background:#edf1f2;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="max-width:600px;background:#ffffff;border:1px solid #dce4e6;">

          <tr>
            <td style="background:#101819;padding:22px 32px;border-bottom:4px solid #02a4ba;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <img
                      src="https://www.opti-menu.com/landing/logo-knockout.png"
                      alt="OptiMenu"
                      height="28"
                      style="display:block;height:28px;width:auto;border:0;"
                    >
                  </td>
                  <td align="right" style="font:600 10px ${FONT};letter-spacing:1px;color:#a5b5b8;">
                    SYSTEM MONITORING
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 32px 12px;">
              <div style="font:700 11px ${FONT};letter-spacing:1px;color:${accent};margin-bottom:12px;">
                ${status}
              </div>
              <h1 style="font:700 24px/1.3 ${FONT};color:#172325;margin:0 0 10px;">
                ${escapeHtml(jobName)}
              </h1>
              <div style="font:12px ${FONT};color:#738286;">
                ${escapeHtml(when)} Eastern
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:12px 32px 24px;">
              <div style="border-top:1px solid #e5e9ea;padding-top:20px;font:15px/1.7 ${FONT};color:#273538;">
                ${escapeHtml(summary)}
              </div>
            </td>
          </tr>

          ${detailsSection}

          ${actionSection}

          <tr>
            <td style="background:#f5f7f7;padding:18px 32px;text-align:center;">
              <div style="font:12px ${FONT};color:#78888b;">
                OptiMenu Operations · Automated system notification
              </div>
              <div style="font:11px ${FONT};color:#9ba7a9;margin-top:5px;">
                ${notice
                  ? 'Informational notification.'
                  : 'Review the associated system logs for additional information.'}
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// notice: true sends an informational report instead of a failure alert.
export async function sendCronAlert(jobName, summary, details = [], { notice = false } = {}) {
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM;
  const apiKey = process.env.RESEND_API_KEY;

  if (!to || !from || !apiKey) {
    console.error(`[cronAlert] Not sent (missing ALERT_EMAIL_TO, ALERT_EMAIL_FROM or RESEND_API_KEY): ${jobName}: ${summary}`);
    return;
  }

  const when = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const text = [
    notice
      ? `${jobName} report (${when} Eastern).`
      : `${jobName} had a problem (${when} Eastern).`,
    '',
    summary,
    ...(details.length ? ['', ...details.map((d) => `- ${d}`)] : []),
    '',
    notice
      ? 'No action needed.'
      : 'Check the Vercel logs for additional information.',
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: notice
          ? `OptiMenu notice: ${jobName}`
          : `OptiMenu alert: ${jobName} failed`,
        text,
        html: alertHtml(jobName, summary, details, when, notice),
      }),
    });

    if (!res.ok) {
      console.error('[cronAlert] Resend returned', res.status, await res.text());
    }
  } catch (err) {
    console.error('[cronAlert] Send failed:', err.message);
  }
}