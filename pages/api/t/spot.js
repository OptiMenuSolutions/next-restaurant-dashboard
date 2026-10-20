// pages/api/t/spot.js
// Saves where a tag sits, from the prompt on its first tap. Only works while
// the tag has no spot yet, so someone with the link cannot keep renaming it.
// Changing a spot later is done from admin.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const code = String(req.body?.code || '').toLowerCase();
  const spot = String(req.body?.spot || '').trim().slice(0, 40);
  if (!/^[a-z0-9]{12}$/.test(code) || !spot) return res.status(400).json({ error: 'Bad request' });

  const { data, error } = await supabase
    .from('nfc_tags')
    .update({ spot })
    .eq('code', code)
    .eq('status', 'active')
    .is('spot', null)
    .select('id');

  if (error) {
    console.error('[t/spot] update failed:', error.message);
    return res.status(500).json({ error: 'Could not save' });
  }
  if (!data?.length) return res.status(409).json({ error: 'Spot already set' });
  return res.status(200).json({ ok: true });
}