// pages/api/admin/send-message.js
// Sends a direct email to a customer via Resend.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, toName, subject, message } = req.body;

  if (!to || !subject || !message) {
    return res.status(400).json({ error: 'to, subject, and message are required' });
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'Nick <nick@opti-menu.com>',
      to: toName ? `${toName} <${to}>` : to,
      subject,
      html: `
        <div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <div style="background: #0a0908; padding: 24px 32px; border-radius: 8px 8px 0 0;">
            <span style="font-family: Georgia, serif; font-size: 20px; color: #e8e2d8;">
              Opti<span style="color: #02a4ba;">Menu</span>
            </span>
          </div>
          <div style="padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            ${toName ? `<p style="color: #374151; font-size: 15px; margin: 0 0 20px;">Hi ${toName},</p>` : ''}
            <div style="color: #374151; font-size: 15px; line-height: 1.65; white-space: pre-wrap;">${message}</div>
            <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #f3f4f6;">
              <p style="color: #6b7280; font-size: 13px; margin: 0;">Nick Lavin</p>
              <p style="color: #9ca3af; font-size: 12px; margin: 4px 0 0;">OptiMenu · <a href="https://opti-menu.com" style="color: #02a4ba; text-decoration: none;">opti-menu.com</a></p>
            </div>
          </div>
        </div>
      `,
      text: `${toName ? `Hi ${toName},\n\n` : ''}${message}\n\n---\nNick Lavin\nOptiMenu · opti-menu.com`,
    });

    if (error) throw error;

    return res.status(200).json({ success: true, id: data?.id });
  } catch (err) {
    console.error('[send-message] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to send email' });
  }
});