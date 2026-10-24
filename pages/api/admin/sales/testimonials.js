// pages/api/admin/sales/testimonials.js
// Testimonials: quotes saved from the Support inbox (or added by hand) with
// their permission status, plus proof points built from Tonight's Dish
// results over the last 30 nights. A restaurant's name only shows in a
// proof point once one of its quotes is marked OK to use.
//
// GET
// POST { action: 'permission', id, permission }   'not asked' | 'asked' | 'yes' | 'no'
// POST { action: 'website', id, on }
// POST { action: 'save', id?, quote, person, restaurant_id }
// POST { action: 'delete', id }

import { adminDb as db, requireAdmin, etDate, addDays, TOUR_RESTAURANT_ID } from '../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';
import { fetchAll } from '../../../../lib/admin/fetchAll';
import { createHash, randomBytes } from 'crypto';
import { sendFromNick, ownerOf } from '../../../../lib/admin/email';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameDish = (a, b) => a === b || (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a)));
const PERMS = ['not asked', 'asked', 'yes', 'no'];

async function proofPoints(rest, okRestaurants) {
  const today = etDate();
  const live = rest.filter((r) => r.id !== TOUR_RESTAURANT_ID && !r.deactivated_at);
  if (!live.length) return [];
  const [{ data: recs }, sales] = await Promise.all([
    db.from('ai_recommendations').select('restaurant_id, generated_date, recommendations').gte('generated_date', addDays(today, -31)).in('restaurant_id', live.map((r) => r.id)),
    fetchAll(() => db.from('pos_sales').select('id, restaurant_id, item_name, quantity_sold, sale_date').in('restaurant_id', live.map((r) => r.id)).gte('sale_date', addDays(today, -60)).order('id')),
  ]);
  const byRD = new Map();
  for (const s of sales) {
    if (!byRD.has(s.restaurant_id)) byRD.set(s.restaurant_id, new Map());
    const days = byRD.get(s.restaurant_id);
    if (!days.has(s.sale_date)) days.set(s.sale_date, []);
    days.get(s.sale_date).push({ name: norm(s.item_name), qty: Number(s.quantity_sold || 0) });
  }
  const sold = (days, date, dish) => (days.get(date) || []).filter((x) => sameDish(x.name, dish)).reduce((a, x) => a + x.qty, 0);
  const out = [];
  for (const row of recs || []) {
    const days = byRD.get(row.restaurant_id);
    if (!days || !days.has(row.generated_date)) continue;
    const r = live.find((x) => x.id === row.restaurant_id);
    for (const pick of (row.recommendations || []).slice(0, 3)) {
      const dish = norm(pick.title);
      if (!dish) continue;
      const past = [1, 2, 3, 4].map((w) => addDays(row.generated_date, -7 * w)).filter((d) => days.has(d));
      if (!past.length) continue;
      const actual = sold(days, row.generated_date, dish);
      const typical = past.reduce((a, d) => a + sold(days, d, dish), 0) / past.length;
      if (typical < 3 || actual < typical * 1.15) continue;
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(new Date(row.generated_date + 'T12:00:00Z'));
      const who = okRestaurants.has(r.id) ? r.name : `A restaurant${r.state ? ` in ${r.state}` : ''}`;
      out.push({
        lift: actual / typical - 1,
        text: `${pick.title}: ${Math.round(actual)} sold vs ${Math.round(typical)} on a typical ${weekday} after being picked as Tonight’s Dish. ${who}.`,
        when: row.generated_date,
        named: okRestaurants.has(r.id),
      });
    }
  }
  return out.sort((a, b) => b.lift - a.lift).slice(0, 8);
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const log = (action) => writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action });

  try {
    if (req.method === 'GET') {
      const [{ data: quotes, error }, { data: rest }] = await Promise.all([
        db.from('admin_testimonials').select('*').order('created_at', { ascending: false }),
        db.from('restaurants').select('id, name, state, deactivated_at'),
      ]);
      if (error) throw new Error(error.message);
      const names = new Map((rest || []).map((r) => [r.id, r.name]));
      const ok = new Set((quotes || []).filter((q) => q.permission === 'yes' && q.restaurant_id).map((q) => q.restaurant_id));
      let proof = [];
      let proofError = null;
      try { proof = await proofPoints(rest || [], ok); } catch (e) { proofError = e.message; }
      return res.status(200).json({
        quotes: (quotes || []).map((q) => ({ ...q, restaurant: q.restaurant_id ? names.get(q.restaurant_id) || null : null })),
        restaurants: (rest || []).filter((r) => r.id !== TOUR_RESTAURANT_ID && !r.deactivated_at).map((r) => ({ id: r.id, name: r.name })),
        proof, proofError,
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};

    if (b.action === 'ask-permission') {
      const { data: q, error: qError } = await db.from('admin_testimonials')
        .select('id, quote, person, restaurant_id, permission, permission_token_hash, permission_token_expires_at')
        .eq('id', b.id)
        .maybeSingle();
      if (qError) throw new Error(qError.message);
      if (!q) return res.status(404).json({ error: 'Quote not found' });
      if (!['not asked', 'asked'].includes(q.permission)) {
        return res.status(409).json({ error: 'A permission request cannot be sent for this quote.' });
      }

      const owner = await ownerOf(db, q.restaurant_id);
      if (!owner) return res.status(400).json({ error: 'No owner email on file for this restaurant' });

      const { data: restaurant, error: restaurantError } = await db.from('restaurants')
        .select('name')
        .eq('id', q.restaurant_id)
        .maybeSingle();
      if (restaurantError) throw new Error(restaurantError.message);

      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const restaurantName = restaurant?.name || 'your restaurant';
      let attribution = String(q.person || owner.name).trim();
      const restaurantSuffix = `, ${restaurantName}`;
      while (attribution.toLowerCase().endsWith(restaurantSuffix.toLowerCase())) {
        attribution = attribution.slice(0, -restaurantSuffix.length).trim();
      }
      attribution = attribution || owner.name;
      const approvalUrl = `https://www.opti-menu.com/testimonial-approval#token=${token}`;

      let claim = db.from('admin_testimonials')
        .update({
          permission: 'asked',
          permission_token_hash: tokenHash,
          permission_token_expires_at: expiresAt,
        })
        .eq('id', q.id)
        .eq('permission', q.permission);

      claim = q.permission_token_hash
        ? claim.eq('permission_token_hash', q.permission_token_hash)
        : claim.is('permission_token_hash', null);

      const { data: claimed, error: claimError } = await claim.select('id').maybeSingle();
      if (claimError) throw new Error(claimError.message);
      if (!claimed) return res.status(409).json({ error: 'This quote changed. Refresh the page and try again.' });

      try {
        await sendFromNick({
          to: owner.email,
          subject: 'May we share your OptiMenu quote?',
          message: `Hi ${owner.first || 'there'},

You shared this with us:

“${q.quote}”

May we publish this quote on the OptiMenu website with the attribution “${attribution}, ${restaurantName}”? Clicking the button below records your approval. We will not publish it unless you approve. If you do not approve, you can ignore this email or reply to Nick.

Nick`,
          button: { label: 'Yes, you can use my quote', url: approvalUrl },
        });
      } catch (sendError) {
        await db.from('admin_testimonials')
          .update({
            permission: q.permission,
            permission_token_hash: q.permission_token_hash,
            permission_token_expires_at: q.permission_token_expires_at,
          })
          .eq('id', q.id)
          .eq('permission_token_hash', tokenHash);
        throw sendError;
      }

      await log(q.permission === 'asked' ? 'Resent a testimonial permission request' : 'Emailed a testimonial permission request');
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'permission') {
      if (!PERMS.includes(b.permission)) return res.status(400).json({ error: 'Bad status' });
      const patch = { permission: b.permission };
      if (b.permission !== 'yes') patch.on_website = false;
      const { error } = await db.from('admin_testimonials').update(patch).eq('id', b.id);
      if (error) throw new Error(error.message);
      await log(`Set a testimonial to ${b.permission}`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'website') {
      const { data: q } = await db.from('admin_testimonials').select('permission').eq('id', b.id).single();
      if (!q) return res.status(404).json({ error: 'Not found' });
      if (b.on && q.permission !== 'yes') return res.status(400).json({ error: 'Get a yes before it goes on the website' });
      await db.from('admin_testimonials').update({ on_website: !!b.on }).eq('id', b.id);
      await log(`${b.on ? 'Marked' : 'Unmarked'} a testimonial as on the website`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'save') {
      const row = { quote: String(b.quote || '').trim(), person: String(b.person || '').trim() || null, restaurant_id: b.restaurant_id || null };
      if (!row.quote) return res.status(400).json({ error: 'The quote is empty' });
      const q = b.id ? db.from('admin_testimonials').update(row).eq('id', b.id) : db.from('admin_testimonials').insert(row);
      const { error } = await q;
      if (error) throw new Error(error.message);
      await log(`${b.id ? 'Edited' : 'Added'} a testimonial`);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'delete') {
      await db.from('admin_testimonials').delete().eq('id', b.id);
      await log('Deleted a testimonial');
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin/sales/testimonials]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}