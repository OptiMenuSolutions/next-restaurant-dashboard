// pages/api/admin/restaurant/[id]/action.js
// POST { action: 'note', body }       adds a note to the restaurant
// POST { action: 'delete-note', noteId }
// POST { action: 'run-dish' }         runs Tonight's Dish now and replaces
//                                     today's picks
// Each one is written to the audit log.

import { adminDb as db, requireAdmin } from '../../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../../lib/admin/withAdminAuth';
import { generateForRestaurant } from '../../../ai-recommendations';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { id } = req.query;
  const { action } = req.body || {};
  const { data: r } = await db.from('restaurants').select('id, name').eq('id', id).single();
  if (!r) return res.status(404).json({ error: 'Restaurant not found' });
  const log = (said, metadata = {}) => writeAuditLog({
    admin_id: admin.user.id, admin_name: admin.name, action: said,
    target_restaurant_id: r.id, target_restaurant_name: r.name, metadata,
  });

  if (action === 'note') {
    const body = String(req.body.body || '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'The note is empty' });
    const { data, error } = await db.from('admin_restaurant_notes')
      .insert({ restaurant_id: r.id, body, admin_id: admin.user.id, admin_name: admin.name })
      .select('id').single();
    if (error) return res.status(500).json({ error: error.message });
    await log('Added a note', { note_id: data.id });
    return res.status(200).json({ ok: true });
  }

  if (action === 'delete-note') {
    const { error } = await db.from('admin_restaurant_notes').delete().eq('id', req.body.noteId).eq('restaurant_id', r.id);
    if (error) return res.status(500).json({ error: error.message });
    await log('Deleted a note', { note_id: req.body.noteId });
    return res.status(200).json({ ok: true });
  }

  if (action === 'run-dish') {
    try {
      const estDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const currentDate = estDate.toISOString().split('T')[0];
      const dayOfWeek = estDate.toLocaleDateString('en-US', { weekday: 'long' });
      const recs = await generateForRestaurant(r.id, currentDate, dayOfWeek);
      await log('Ran Tonight’s Dish by hand', { picks: recs.map((x) => x.title) });
      return res.status(200).json({ ok: true, picks: recs.map((x) => x.title) });
    } catch (e) {
      console.error('[admin/run-dish]', e);
      return res.status(500).json({ error: e.message || 'Tonight’s Dish failed' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}