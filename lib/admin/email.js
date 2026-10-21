// lib/admin/email.js
// Sends an email from Nick through Resend, in OptiMenu's email layout: a
// dark header bar with the logo and a teal stripe, the message, Nick's
// signature, and (on a support reply) the owner's own message quoted
// underneath. Replies come back to nick@opti-menu.com, so an owner can just
// hit reply.

import { Resend } from 'resend';

const SITE = 'https://www.opti-menu.com';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Escaped text with links made clickable and single line breaks kept.
function rich(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#03808f;text-decoration:underline">$1</a>')
    .replace(/\n/g, '<br>');
}

// Blank lines start a new paragraph.
function paragraphs(s, style) {
  return String(s ?? '').trim().split(/\n\s*\n/).map((p) => `<p style="margin:0 0 14px;${style}">${rich(p.trim())}</p>`).join('');
}

const when = (ts) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ts));

export function emailHtml({ message, quote = null }) {
  const quoted = quote?.body ? `
          <tr><td style="padding:0 32px 28px">
            <div style="border-left:3px solid #d8dfe0;padding:2px 0 2px 14px">
              <div style="font:600 12px/1.5 ${FONT};color:#6f7d81;margin-bottom:6px">${esc(quote.from || 'You')} wrote${quote.at ? ` on ${esc(when(quote.at))}` : ''}:</div>
              ${paragraphs(quote.body, `font:14px/1.6 ${FONT};color:#4b585b`)}
            </div>
          </td></tr>` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#ffffff">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
    <tr><td align="center" style="padding:20px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border:1px solid #e3e8e9;border-radius:10px;overflow:hidden">
        <tr><td style="background:#0e1516;border-bottom:4px solid #02a4ba;padding:18px 32px">
          <a href="${SITE}"><img src="${SITE}/landing/logo-knockout.png" alt="OptiMenu" height="28" style="display:block;height:28px;width:auto;border:0"></a>
        </td></tr>
        <tr><td style="padding:30px 32px 6px">
          ${paragraphs(message, `font:15px/1.65 ${FONT};color:#111819`)}
        </td></tr>
        <tr><td style="padding:6px 32px 28px">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr><td style="padding-top:16px;padding-right:14px;vertical-align:top">
              <div style="width:4px;height:58px;background:#02a4ba;border-radius:2px"></div>
            </td><td style="padding-top:16px;vertical-align:top">
              <div style="font:700 15px/1.4 ${FONT};color:#111819">Nick Lavin</div>
              <div style="font:13px/1.5 ${FONT};color:#4b585b">Founder, OptiMenu</div>
              <div style="font:13px/1.5 ${FONT};color:#4b585b"><a href="mailto:nick@opti-menu.com" style="color:#03808f;text-decoration:none">nick@opti-menu.com</a> · <a href="${SITE}" style="color:#03808f;text-decoration:none">opti-menu.com</a></div>
            </td></tr>
          </table>
        </td></tr>
        ${quoted}
        <tr><td style="background:#f4f6f6;padding:14px 32px;font:12px/1.6 ${FONT};color:#6f7d81">
          Reply to this email to reach Nick directly.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function emailText({ message, quote = null }) {
  const q = quote?.body ? `\n\n${quote.from || 'You'} wrote${quote.at ? ` on ${when(quote.at)}` : ''}:\n${String(quote.body).trim().split('\n').map((l) => `> ${l}`).join('\n')}` : '';
  return `${String(message).trim()}\n\nNick Lavin\nFounder, OptiMenu\nnick@opti-menu.com · opti-menu.com${q}`;
}

// quote: { from, at, body } is the owner's message being answered (optional).
export async function sendFromNick({ to, subject, message, quote = null }) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'Nick at OptiMenu <nick@opti-menu.com>',
    replyTo: 'nick@opti-menu.com',
    to,
    subject,
    text: emailText({ message, quote }),
    html: emailHtml({ message, quote }),
  });
  if (error) throw new Error(error.message || 'Email failed');
}

// The owner of a restaurant (first non-admin profile with an email).
export async function ownerOf(db, restaurantId) {
  if (!restaurantId) return null;
  const { data } = await db.from('profiles').select('full_name, email, role').eq('restaurant_id', restaurantId);
  const p = (data || []).find((x) => x.role !== 'admin' && x.email);
  return p ? { name: p.full_name || p.email, first: String(p.full_name || '').trim().split(/\s+/)[0] || '', email: p.email } : null;
}