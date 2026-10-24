import { createHash } from 'crypto';
import { adminDb as db } from '../../../lib/admin/requireAdmin';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.body?.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: 'This approval link is invalid.' });
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');

  try {
    const { data: quote, error } = await db.from('admin_testimonials')
      .select('id, permission, permission_token_expires_at')
      .eq('permission_token_hash', tokenHash)
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (
      !quote ||
      quote.permission !== 'asked' ||
      !quote.permission_token_expires_at ||
      new Date(quote.permission_token_expires_at).getTime() < Date.now()
    ) {
      return res.status(410).json({ error: 'This approval link is expired or has already been used.' });
    }

    const { data: approved, error: updateError } = await db.from('admin_testimonials')
      .update({
        permission: 'yes',
        on_website: false,
        permission_token_hash: null,
        permission_token_expires_at: null,
      })
      .eq('id', quote.id)
      .eq('permission', 'asked')
      .eq('permission_token_hash', tokenHash)
      .select('id')
      .maybeSingle();

    if (updateError) throw new Error(updateError.message);
    if (!approved) {
      return res.status(410).json({ error: 'This approval link is expired or has already been used.' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[testimonial-approval]', error);
    return res.status(500).json({ error: 'We could not record your approval. Please reply to Nick.' });
  }
}