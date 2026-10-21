// pages/api/admin/tags/index.js
// GET          -> shelf, kits with each tag's stage, tags in the field, settings
// GET ?kit=id  -> one kit with its tags and restaurant (for the wizard and the print pages)

import { adminDb as db, requireAdmin, TOUR_RESTAURANT_ID, etDate, addDays } from '../../../../lib/admin/requireAdmin';
import { getSettings } from '../../../../lib/admin/settings';
import { fetchAll } from '../../../../lib/admin/fetchAll';
import { tagStage, kitNext } from '../../../../lib/admin/kits';

const tagOut = (t, kit) => ({
  id: t.id, label: t.label, url: `opti-menu.com/t/${t.code}`, status: t.status, spot: t.spot,
  written_at: t.written_at, confirmed_at: t.confirmed_at, last_tap_at: t.last_tap_at, tap_count: t.tap_count,
  stage: tagStage(t, kit),
});

async function oneKit(id) {
  const { data: kit } = await db.from('admin_tag_kits').select('*').eq('id', id).single();
  if (!kit) return null;
  const [{ data: tags }, { data: r }] = await Promise.all([
    db.from('nfc_tags').select('*').eq('kit_id', id).order('label'),
    db.from('restaurants').select('id, name').eq('id', kit.restaurant_id).single(),
  ]);
  return { kit, restaurant: r, tags: (tags || []).map((t) => tagOut(t, kit)), next: kitNext(kit, tags || []) };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.query.kit) {
      const out = await oneKit(req.query.kit);
      if (!out) return res.status(404).json({ error: 'Kit not found' });
      const settings = await getSettings(db);
      return res.status(200).json({ ...out, shipFrom: settings.ship_from || '' });
    }

    const week = addDays(etDate(), -6);
    const [settings, { data: stock }, { data: kits }, { data: tags }, taps, { data: rest }] = await Promise.all([
      getSettings(db),
      db.from('admin_inventory').select('*').order('sort'),
      db.from('admin_tag_kits').select('*').order('created_at', { ascending: false }).limit(200),
      db.from('nfc_tags').select('*').order('label'),
      fetchAll(() => db.from('nfc_tag_taps').select('id, tag_id, tapped_at').gte('tapped_at', week + 'T00:00:00-05:00').order('id')),
      db.from('restaurants').select('id, name, deactivated_at').order('name'),
    ]);
    const names = new Map((rest || []).map((r) => [r.id, r.name]));
    const kitById = new Map((kits || []).map((k) => [k.id, k]));

    const kitRows = (kits || []).map((k) => {
      const kt = (tags || []).filter((t) => t.kit_id === k.id);
      return {
        id: k.id, restaurant_id: k.restaurant_id, restaurant: names.get(k.restaurant_id) || 'Unknown',
        kind: k.kind, delivery: k.delivery, created_at: k.created_at, tracking: k.tracking, carrier: k.carrier,
        sent_at: k.sent_at, delivered_at: k.delivered_at,
        tags: kt.map((t) => tagOut(t, k)), next: kitNext(k, kt),
      };
    });

    // Daily taps for the last 7 days, per tag (oldest first).
    const days = [6, 5, 4, 3, 2, 1, 0].map((b) => addDays(etDate(), -b));
    const tapBy = new Map();
    for (const t of taps) {
      const d = etDate(new Date(t.tapped_at));
      if (!tapBy.has(t.tag_id)) tapBy.set(t.tag_id, {});
      tapBy.get(t.tag_id)[d] = (tapBy.get(t.tag_id)[d] || 0) + 1;
    }
    const field = (tags || []).filter((t) => t.status !== 'pending').map((t) => ({
      ...tagOut(t, kitById.get(t.kit_id)),
      restaurant_id: t.restaurant_id,
      restaurant: names.get(t.restaurant_id) || 'Unknown',
      week: days.map((d) => tapBy.get(t.id)?.[d] || 0),
    }));

    return res.status(200).json({
      stock: stock || [],
      kits: kitRows,
      field,
      restaurants: (rest || []).filter((r) => r.id !== TOUR_RESTAURANT_ID && !r.deactivated_at).map((r) => ({ id: r.id, name: r.name })),
      settings: {
        kit_cost: Number(settings.kit_cost || 0),
        tag_cost: Number(settings.tag_cost || 0),
        extra_tag_price: settings.extra_tag_price != null ? Number(settings.extra_tag_price) : null,
        ship_from: settings.ship_from || '',
      },
    });
  } catch (err) {
    console.error('[admin/tags]', err);
    return res.status(500).json({ error: err.message || 'Could not load tag kits' });
  }
}