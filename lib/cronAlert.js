// lib/cronAlert.js
// Emails an alert when a cron run has a problem, through Resend.
// Needs RESEND_API_KEY, ALERT_EMAIL_TO (where alerts go), and ALERT_EMAIL_FROM
// (an address on a domain verified in Resend). Never throws: a failed alert
// must not change the cron's own result.

// notice: true sends an informational report instead of a failure alert.
export async function sendCronAlert(jobName, summary, details = [], { notice = false } = {}) {
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !from || !apiKey) {
    console.error(`[cronAlert] Not sent (missing ALERT_EMAIL_TO, ALERT_EMAIL_FROM or RESEND_API_KEY): ${jobName}: ${summary}`);
    return;
  }

  const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const text = [
    notice ? `${jobName} report (${when} Eastern).` : `${jobName} had a problem (${when} Eastern).`,
    '',
    summary,
    ...(details.length ? ['', ...details.map(d => `- ${d}`)] : []),
    '',
    notice ? 'No action needed.' : 'Check the Vercel logs for this run for the full error.',
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: notice ? `OptiMenu notice: ${jobName}` : `OptiMenu alert: ${jobName} failed`, text }),
    });
    if (!res.ok) console.error('[cronAlert] Resend returned', res.status, await res.text());
  } catch (err) {
    console.error('[cronAlert] Send failed:', err.message);
  }
}