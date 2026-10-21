// pages/api/admin/support/index.js
// GET                 -> threads (newest activity first), counts, restaurants, saved replies
// GET ?thread=<id>    -> one thread with its messages and the restaurant panel
//
// Every owner message sent from the app (the feedback table) becomes a
// thread automatically, through the feedback_to_thread trigger.

import { adminDb as db, requireAdmin, TOUR_RESTAURANT_ID } from '../../../../lib/admin/requireAdmin';
import { loadRestaurantFacts } from '../../../../lib/admin/restaurantFacts';
import { ownerOf } from '../../../../lib/admin/email';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.query.thread) {
      const { data: t } = await db.from('support_threads').select('*').eq('id', req.query.thread).single();
      if (!t) return res.status(404).json({ error: 'Thread not found' });
      const [{ data: messages }, facts, owner, { data: testimonial }] = await Promise.all([
        db.from('support_messages').select('id, direction, body, author, emailed, created_at').eq('thread_id', t.id).order('created_at', { ascending: true }),
        t.restaurant_id ? loadRestaurantFacts(db, [t.restaurant_id]) : Promise.resolve([]),
        ownerOf(db, t.restaurant_id),
        db.from('admin_testimonials').select('id').eq('thread_id', t.id).limit(1),
      ]);
      const f = facts[0] || null;
      return res.status(200).json({
        thread: t,
        messages: messages || [],
        owner,
        hasTestimonial: !!testimonial?.length,
        restaurant: f && {
          id: f.id, name: f.name, town: f.town, status: f.status, health: f.health,
          plan: f.subscription_status, lastInvoice: f.lastInvoice, setupDone: f.setupDone, nextStep: f.nextStep,
          pos: f.conn ? `${f.conn.provider || 'POS'} · ${f.conn.status}` : 'Not connected',
          lastDish: f.lastDish, views: f.views.reduce((a, b) => a + b, 0),
        },
      });
    }

    const [{ data: threads, error }, { data: rest }, { data: replies }] = await Promise.all([
      db.from('support_threads').select('id, restaurant_id, subject, kind, status, last_message_at, created_at').order('last_message_at', { ascending: false }).limit(500),
      db.from('restaurants').select('id, name, deactivated_at').order('name'),
      db.from('admin_saved_replies').select('id, label, body, used_count').order('sort', { ascending: true }),
    ]);
    if (error) throw new Error(error.message);
    const names = new Map((rest || []).map((r) => [r.id, r.name]));

    // Last message preview for each thread.
    const ids = (threads || []).map((t) => t.id);
    const last = new Map();
    if (ids.length) {
      const { data: msgs } = await db.from('support_messages').select('thread_id, direction, body, created_at')
        .in('thread_id', ids).order('created_at', { ascending: false }).limit(2000);
      for (const m of msgs || []) if (!last.has(m.thread_id)) last.set(m.thread_id, m);
    }

    const list = (threads || []).map((t) => {
      const m = last.get(t.id);
      return {
        ...t,
        restaurant_name: t.restaurant_id ? names.get(t.restaurant_id) || 'Unknown restaurant' : 'No restaurant',
        preview: m ? `${m.direction === 'out' ? 'You: ' : m.direction === 'note' ? 'Note: ' : ''}${m.body.replace(/\s+/g, ' ').slice(0, 120)}` : '',
      };
    });
    const count = (s) => list.filter((t) => t.status === s).length;

    return res.status(200).json({
      threads: list,
      counts: { new: count('new'), waiting: count('waiting'), done: count('done'), all: list.length },
      restaurants: (rest || []).filter((r) => r.id !== TOUR_RESTAURANT_ID && !r.deactivated_at).map((r) => ({ id: r.id, name: r.name })),
      replies: replies || [],
    });
  } catch (err) {
    console.error('[admin/support]', err);
    return res.status(500).json({ error: err.message || 'Could not load the inbox' });
  }
}