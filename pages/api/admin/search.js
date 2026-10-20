// pages/api/admin/search.js
// Jump-to search (⌘K). GET ?q= -> restaurants, tags and invoices that match.
// Pages and actions are matched in the browser, so they need no call.

import { adminDb as db, requireAdmin, TOUR_RESTAURANT_ID } from '../../../lib/admin/requireAdmin';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  // Strip characters PostgREST filters treat specially.
  const q = String(req.query.q || '').replace(/[%,()*\\]/g, ' ').trim().slice(0, 60);
  if (q.length < 2) return res.status(200).json({ restaurants: [], tags: [], invoices: [] });

  const tagNum = q.match(/^om-?(\d{1,6})$/i);
  const [rest, tags, inv] = await Promise.all([
    db.from('restaurants').select('id, name, deactivated_at').ilike('name', `%${q}%`).limit(8),
    tagNum
      ? db.from('nfc_tags').select('label, spot, status, restaurant_id, restaurants(name)').ilike('label', `OM-%${tagNum[1]}%`).limit(6)
      : Promise.resolve({ data: [] }),
    /\d/.test(q)
      ? db.from('invoices').select('id, number, supplier, date, restaurant_id, restaurants(name)').ilike('number', `%${q}%`).eq('is_sample', false).limit(6)
      : Promise.resolve({ data: [] }),
  ]);

  return res.status(200).json({
    restaurants: (rest.data || [])
      .filter((r) => r.id !== TOUR_RESTAURANT_ID)
      .map((r) => ({ id: r.id, title: r.name, sub: r.deactivated_at ? 'Closed account' : 'Restaurant', href: `/admin/restaurants/${r.id}` })),
    tags: (tags.data || []).map((t) => ({
      id: t.label, title: t.label,
      sub: `${t.restaurants?.name || 'Unassigned'}${t.spot ? ' · ' + t.spot : ''}${t.status === 'off' ? ' · turned off' : ''}`,
      href: t.restaurant_id ? `/admin/restaurants/${t.restaurant_id}` : '/admin',
    })),
    invoices: (inv.data || []).map((i) => ({
      id: i.id, title: `Invoice ${i.number}`,
      sub: [i.supplier, i.restaurants?.name, i.date].filter(Boolean).join(' · '),
      href: '/admin/invoice-review',
    })),
  });
}