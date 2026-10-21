// pages/api/admin/support/action.js
// POST { action, ... }
//   reply       { threadId, body, email }   your answer; emailed to the owner unless email is false
//   their-reply { threadId, body }          paste in an answer they sent by email
//   note        { threadId, body }          a private note, never sent
//   status      { threadId, status }        new | waiting | done
//   kind        { threadId, kind }
//   start       { restaurantId, subject, body }   a new conversation you start
//   testimonial { threadId, quote, person }
//   used-reply  { replyId }                 counts a saved reply as used

import { adminDb as db, requireAdmin } from '../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';
import { sendFromNick, ownerOf } from '../../../../lib/admin/email';

const KINDS = ['general', 'bug', 'feature', 'invoice', 'billing', 'praise', 'other'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const b = req.body || {};
  const now = new Date().toISOString();
  const text = (s, n = 5000) => String(s || '').trim().slice(0, n);

  try {
    if (b.action === 'used-reply') {
      const { data: r } = await db.from('admin_saved_replies').select('used_count').eq('id', b.replyId).single();
      if (r) await db.from('admin_saved_replies').update({ used_count: (r.used_count || 0) + 1 }).eq('id', b.replyId);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'start') {
      const subject = text(b.subject, 150);
      const body = text(b.body);
      if (!b.restaurantId || !subject || !body) return res.status(400).json({ error: 'Pick a restaurant and write a subject and message' });
      const { data: r } = await db.from('restaurants').select('id, name').eq('id', b.restaurantId).single();
      if (!r) return res.status(404).json({ error: 'Restaurant not found' });
      const owner = await ownerOf(db, r.id);
      if (!owner) return res.status(400).json({ error: 'No owner email on file for this restaurant' });
      await sendFromNick({ to: owner.email, subject, message: body });
      const { data: t, error } = await db.from('support_threads')
        .insert({ restaurant_id: r.id, subject, kind: 'general', status: 'waiting', last_message_at: now })
        .select('id').single();
      if (error) throw new Error(error.message);
      await db.from('support_messages').insert({ thread_id: t.id, direction: 'out', body, author: admin.name, emailed: true });
      await writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action: `Messaged the owner: ${subject}`, target_restaurant_id: r.id, target_restaurant_name: r.name, metadata: { thread_id: t.id } });
      return res.status(200).json({ ok: true, threadId: t.id });
    }

    const { data: t } = await db.from('support_threads').select('*').eq('id', b.threadId).single();
    if (!t) return res.status(404).json({ error: 'Thread not found' });
    const { data: r } = t.restaurant_id ? await db.from('restaurants').select('id, name').eq('id', t.restaurant_id).single() : { data: null };
    const log = (action, metadata = {}) => writeAuditLog({
      admin_id: admin.user.id, admin_name: admin.name, action,
      target_restaurant_id: r?.id || null, target_restaurant_name: r?.name || null, metadata: { thread_id: t.id, ...metadata },
    });
    // Keep the old feedback row in step, so anything still reading it agrees.
    const syncFeedback = (status) => (t.feedback_id
      ? db.from('feedback').update({ status: status === 'done' ? 'resolved' : status === 'waiting' ? 'reviewed' : 'new' }).eq('id', t.feedback_id)
      : Promise.resolve());

    if (b.action === 'reply') {
      const body = text(b.body);
      if (!body) return res.status(400).json({ error: 'The reply is empty' });
      let emailed = false;
      if (b.email !== false) {
        const owner = await ownerOf(db, t.restaurant_id);
        if (!owner) return res.status(400).json({ error: 'No owner email on file. Untick email to save it without sending.' });
        const subject = t.subject ? `Re: ${t.subject.replace(/^Re:\s*/i, '').slice(0, 120)}` : 'OptiMenu support';
        const { data: last } = await db.from('support_messages').select('body, created_at')
          .eq('thread_id', t.id).eq('direction', 'in').order('created_at', { ascending: false }).limit(1).maybeSingle();
        await sendFromNick({ to: owner.email, subject, message: body, quote: last ? { from: owner.name, at: last.created_at, body: last.body } : null });
        emailed = true;
      }
      await db.from('support_messages').insert({ thread_id: t.id, direction: 'out', body, author: admin.name, emailed });
      await db.from('support_threads').update({ status: 'waiting', last_message_at: now }).eq('id', t.id);
      await syncFeedback('waiting');
      await log(emailed ? 'Replied to a support message by email' : 'Added a reply without emailing');
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'their-reply') {
      const body = text(b.body);
      if (!body) return res.status(400).json({ error: 'Paste their reply first' });
      await db.from('support_messages').insert({ thread_id: t.id, direction: 'in', body, author: 'owner' });
      await db.from('support_threads').update({ status: 'new', last_message_at: now }).eq('id', t.id);
      await syncFeedback('new');
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'note') {
      const body = text(b.body);
      if (!body) return res.status(400).json({ error: 'The note is empty' });
      await db.from('support_messages').insert({ thread_id: t.id, direction: 'note', body, author: admin.name });
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'status') {
      if (!['new', 'waiting', 'done'].includes(b.status)) return res.status(400).json({ error: 'Unknown status' });
      await db.from('support_threads').update({ status: b.status }).eq('id', t.id);
      await syncFeedback(b.status);
      await log(b.status === 'done' ? 'Closed a support thread' : `Moved a support thread to ${b.status}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'kind') {
      if (!KINDS.includes(b.kind)) return res.status(400).json({ error: 'Unknown type' });
      await db.from('support_threads').update({ kind: b.kind }).eq('id', t.id);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'testimonial') {
      const quote = text(b.quote, 1000);
      if (!quote) return res.status(400).json({ error: 'The quote is empty' });
      await db.from('admin_testimonials').insert({ restaurant_id: t.restaurant_id, thread_id: t.id, quote, person: text(b.person, 120) || null });
      await log('Saved a quote as a testimonial');
      return res.status(200).json({ ok: true, message: 'Saved. Ask them before you use it anywhere.' });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('[admin/support action]', e);
    return res.status(500).json({ error: e.message || 'Something went wrong' });
  }
}