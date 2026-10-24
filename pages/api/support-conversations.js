import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Please sign in again.' });
    const { data: { user } = {}, error: authError } = await db.auth.getUser(auth.slice(7));
    if (authError || !user) return res.status(401).json({ error: 'Please sign in again.' });

    const { beforeAt, beforeId } = req.query;
    const hasCursor = beforeAt !== undefined || beforeId !== undefined;
    if (hasCursor && (
      typeof beforeAt !== 'string' || Number.isNaN(Date.parse(beforeAt)) ||
      typeof beforeId !== 'string' || !UUID.test(beforeId)
    )) {
      return res.status(400).json({ error: 'Invalid conversation cursor.' });
    }

    const { data, error } = await db.rpc('list_client_support_conversations', {
      p_user_id: user.id,
      p_before_at: hasCursor ? beforeAt : null,
      p_before_id: hasCursor ? beforeId : null,
    });
    if (error) throw error;

    const threads = (data || []).slice(0, 20);
    const last = threads[threads.length - 1];
    return res.status(200).json({
      threads,
      nextCursor: data?.length > 20
        ? { at: last.last_message_at, id: last.id }
        : null,
    });
  } catch (err) {
    console.error('[client/support-conversations]', err);
    return res.status(500).json({ error: 'Could not load conversations. Please try again.' });
  }
}