// lib/admin/email.js
// Sends an email from Nick through Resend. Replies come back to
// nick@opti-menu.com, so an owner can just hit reply.

import { Resend } from 'resend';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function sendFromNick({ to, subject, message }) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'Nick <nick@opti-menu.com>',
    replyTo: 'nick@opti-menu.com',
    to,
    subject,
    text: `${message}\n\nNick Lavin\nOptiMenu · opti-menu.com`,
    html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;color:#111819;font-size:15px;line-height:1.6;white-space:pre-wrap">${esc(message)}</div><p style="font-family:-apple-system,Segoe UI,sans-serif;color:#4b585b;font-size:13px;margin-top:24px">Nick Lavin<br>OptiMenu · <a href="https://www.opti-menu.com" style="color:#03808f">opti-menu.com</a></p>`,
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