import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_FIELDS = 'id, direction, body, created_at';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }
    const { data: { user } = {}, error: authError } =
      await db.auth.getUser(authorization.slice(7));
    if (authError || !user) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }

    const threadId = req.query.thread;
    if (typeof threadId !== 'string' || !UUID.test(threadId)) {
      return res.status(400).json({ error: 'Invalid conversation.' });
    }

    const { data: profile, error: profileError } = await db
      .from('profiles').select('restaurant_id, role').eq('id', user.id).single();
    if (profileError) throw profileError;
    if (!profile?.restaurant_id || profile.role === 'admin') {
      return res.status(403).json({ error: 'A restaurant account is required.' });
    }

    const { data: restaurant, error: restaurantError } = await db
      .from('restaurants').select('deactivated_at')
      .eq('id', profile.restaurant_id).single();
    if (restaurantError) throw restaurantError;
    if (!restaurant || restaurant.deactivated_at) {
      return res.status(403).json({ error: 'This account is closed.' });
    }

    const { data: thread, error: threadError } = await db
      .from('support_threads').select('id, subject, status')
      .eq('id', threadId).eq('restaurant_id', profile.restaurant_id).maybeSingle();
    if (threadError) throw threadError;
    if (!thread) return res.status(404).json({ error: 'Conversation not found.' });

    if (req.method === 'GET') {
      const before = req.query.before;
      let query = db.from('support_messages').select(MESSAGE_FIELDS)
        .eq('thread_id', thread.id).in('direction', ['in', 'out']);

      if (before !== undefined) {
        if (typeof before !== 'string' || !UUID.test(before)) {
          return res.status(400).json({ error: 'Invalid message cursor.' });
        }
        const { data: cursor, error: cursorError } = await db
          .from('support_messages').select('id, created_at')
          .eq('id', before).eq('thread_id', thread.id)
          .in('direction', ['in', 'out']).maybeSingle();
        if (cursorError) throw cursorError;
        if (!cursor) return res.status(400).json({ error: 'Message cursor not found.' });
        query = query.or(
          `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
        );
      }

      const { data: rows, error: messagesError } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false }).limit(51);
      if (messagesError) throw messagesError;
      const page = (rows || []).slice(0, 50);
      return res.status(200).json({
        thread,
        messages: [...page].reverse(),
        nextCursor: rows?.length > 50 ? page[page.length - 1].id : null,
      });
    }

    const body = req.body?.body;
    const messageId = req.body?.messageId;
    if (
      typeof body !== 'string' || !body.trim() || body.length > 5000 ||
      typeof messageId !== 'string' || !UUID.test(messageId)
    ) {
      return res.status(400).json({ error: 'Write a message of up to 5,000 characters.' });
    }

    const { data: message, error: replyError } = await db.rpc('reply_to_client_support', {
      p_thread_id: thread.id,
      p_user_id: user.id,
      p_message_id: messageId,
      p_body: body.trim(),
    });
    if (replyError?.code === '42501') {
      return res.status(404).json({ error: 'Conversation not found.' });
    }
    if (replyError?.code === '22023') {
      return res.status(400).json({ error: 'Could not accept this message. Refresh and try again.' });
    }
    if (replyError) throw replyError;
    return res.status(200).json({ message });
  } catch (err) {
    console.error('[client/support]', err);
    return res.status(500).json({ error: 'Could not load or save the conversation. Please try again.' });
  }
}