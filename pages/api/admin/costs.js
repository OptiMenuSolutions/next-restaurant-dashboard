// pages/api/admin/costs.js
// Cost approvals: AI cost guesses from menu parsing that owners never see
// until you approve them. A real invoice price replaces any of them later.
//
// GET  -> pending guesses (used in at least one dish), approved and skipped
//         today, and for each guess: the library reference, what other
//         restaurants paid on invoices, how much the price moves, and the
//         same ingredient waiting at other restaurants.
// POST { action: 'approve', ingredientId, price, alsoIds: [] }
// POST { action: 'skip', ingredientId }        stays a missing price until an invoice
// POST { action: 'undo', ingredientId }        puts an approved or skipped guess back
// POST { action: 'approve-bulk', ingredientIds } approves each at its AI guess
// POST { action: 'set-state', restaurantId, state }

import { adminDb as db, requireAdmin, TOUR_RESTAURANT_ID, etDate } from '../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../lib/admin/withAdminAuth';
import { fetchAll } from '../../../lib/admin/fetchAll';
import { recomputeMenuCosts } from '../../../lib/recomputeMenuCosts';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const $ = (n) => `$${Number(n).toFixed(2)}`;

function volatility(values) {
  if (values.length < 3) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!(mean > 0)) return null;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  const cv = sd / mean;
  return cv < 0.08 ? 'STEADY' : cv < 0.2 ? 'MODERATE' : 'SWINGS';
}

async function load() {
  const today = etDate();
  const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const [{ data: rest }, ingredients, dishes, { data: globals }] = await Promise.all([
    db.from('restaurants').select('id, name, state, deactivated_at'),
    fetchAll(() => db.from('ingredients').select('id, restaurant_id, name, unit, last_price, last_ordered_at, is_estimated, price_approved_at, price_skipped_at, ai_estimate').order('id')),
    fetchAll(() => db.from('component_ingredients').select('id, ingredient_id, menu_item_components!inner(menu_item_id, menu_items!inner(archived_at))').order('id')),
    db.from('global_ingredients').select('name, aliases, reference_price, reference_unit'),
  ]);
  const restById = new Map((rest || []).map((r) => [r.id, r]));
  const real = (rid) => rid !== TOUR_RESTAURANT_ID && restById.get(rid) && !restById.get(rid).deactivated_at;

  // Dishes using each ingredient (live dishes only).
  const uses = new Map();
  for (const l of dishes) {
    if (l.menu_item_components?.menu_items?.archived_at) continue;
    const s = uses.get(l.ingredient_id) || new Set();
    s.add(l.menu_item_components.menu_item_id);
    uses.set(l.ingredient_id, s);
  }

  // Library reference prices by name and alias.
  const refs = new Map();
  for (const g of globals || []) {
    if (g.reference_price == null) continue;
    const ref = { price: Number(g.reference_price), unit: g.reference_unit || null };
    refs.set(norm(g.name), ref);
    for (const a of g.aliases || []) if (!refs.has(norm(a))) refs.set(norm(a), ref);
  }

  // Invoice-priced ingredients by name, across restaurants.
  const pricedByName = new Map();
  for (const g of ingredients) {
    if (g.is_estimated !== false || !(Number(g.last_price) > 0) || !real(g.restaurant_id)) continue;
    const k = norm(g.name);
    if (!pricedByName.has(k)) pricedByName.set(k, []);
    pricedByName.get(k).push(g);
  }

  // Price history for those, from their invoice lines (last 180 days).
  const pricedIds = [...pricedByName.values()].flat().map((g) => g.id);
  const history = new Map();
  for (let i = 0; i < pricedIds.length; i += 300) {
    const chunk = pricedIds.slice(i, i + 300);
    const rows = await fetchAll(() => db.from('invoice_items').select('id, ingredient_id, unit, unit_cost, invoices!inner(date)').in('ingredient_id', chunk).gte('invoices.date', since).order('id'));
    for (const r of rows) {
      if (!(Number(r.unit_cost) > 0)) continue;
      const key = `${r.ingredient_id}|${r.unit || ''}`;
      if (!history.has(key)) history.set(key, []);
      history.get(key).push(Number(r.unit_cost));
    }
  }
  const moveFor = (name) => {
    let best = null;
    for (const g of pricedByName.get(norm(name)) || []) {
      for (const [key, vals] of history) {
        if (!key.startsWith(g.id + '|')) continue;
        const v = volatility(vals);
        if (v && (!best || vals.length > best.n)) best = { v, n: vals.length };
      }
    }
    return best?.v || null;
  };

  const pendingAll = ingredients.filter((g) => g.is_estimated !== false && !g.price_approved_at && !g.price_skipped_at && real(g.restaurant_id) && uses.has(g.id));
  const byName = new Map();
  for (const g of pendingAll) {
    const k = norm(g.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(g);
  }

  const row = (g) => {
    const r = restById.get(g.restaurant_id);
    const ref = refs.get(norm(g.name)) || null;
    const paid = (pricedByName.get(norm(g.name)) || []).sort((a, b) => String(b.last_ordered_at || '').localeCompare(String(a.last_ordered_at || '')));
    const lastPaid = paid[0] || null;
    const guess = Number(g.last_price) > 0 ? Number(g.last_price) : null;
    const why = [`AI estimate from reading the ${r?.name || ''} menu.`];
    if (ref) why.push(`Library reference is ${$(ref.price)}${ref.unit ? '/' + ref.unit : ''}.`);
    if (lastPaid) why.push(`${restById.get(lastPaid.restaurant_id)?.name || 'Another restaurant'} paid ${$(lastPaid.last_price)}/${lastPaid.unit} on an invoice${lastPaid.last_ordered_at ? ' dated ' + lastPaid.last_ordered_at : ''}.`);
    if (!ref && !lastPaid) why.push('Nothing to check it against yet.');
    const compare = lastPaid && lastPaid.unit === g.unit ? Number(lastPaid.last_price) : ref && ref.unit === g.unit ? ref.price : null;
    const warn = guess && compare && Math.abs(guess - compare) / compare >= 0.4 ? `${guess > compare ? '+' : ''}${Math.round(((guess - compare) / compare) * 100)}% vs ${lastPaid && lastPaid.unit === g.unit ? 'what was paid' : 'library'}` : null;
    const others = (byName.get(norm(g.name)) || []).filter((o) => o.id !== g.id).map((o) => {
      const or = restById.get(o.restaurant_id);
      return {
        ingredientId: o.id, restaurant: or?.name || 'Unknown', state: or?.state || null,
        sameState: !!(r?.state && or?.state && r.state.toUpperCase() === or.state.toUpperCase()),
        sameUnit: o.unit === g.unit, unit: o.unit, guess: Number(o.last_price) > 0 ? Number(o.last_price) : null,
      };
    });
    return {
      id: g.id, name: g.name, unit: g.unit, restaurant_id: g.restaurant_id, restaurant: r?.name || 'Unknown', state: r?.state || null,
      dishes: uses.get(g.id)?.size || 0, guess, ai_estimate: g.ai_estimate != null ? Number(g.ai_estimate) : guess,
      library: lastPaid ? { price: Number(lastPaid.last_price), unit: lastPaid.unit, where: restById.get(lastPaid.restaurant_id)?.name || '', date: lastPaid.last_ordered_at } : ref ? { price: ref.price, unit: ref.unit, where: 'Library reference' } : null,
      move: moveFor(g.name), why: why.join(' '), warn, others,
    };
  };

  const pending = pendingAll.map(row).sort((a, b) => a.restaurant.localeCompare(b.restaurant) || b.dishes - a.dishes || a.name.localeCompare(b.name));
  const startET = new Date(`${today}T00:00:00-05:00`).toISOString();
  const approvedToday = ingredients.filter((g) => g.price_approved_at && g.price_approved_at >= startET && real(g.restaurant_id))
    .map((g) => ({ id: g.id, name: g.name, unit: g.unit, price: Number(g.last_price), restaurant: restById.get(g.restaurant_id)?.name }));
  const skipped = ingredients.filter((g) => g.price_skipped_at && g.is_estimated !== false && !g.price_approved_at && real(g.restaurant_id))
    .map((g) => ({ id: g.id, name: g.name, unit: g.unit, restaurant: restById.get(g.restaurant_id)?.name, when: g.price_skipped_at }));

  const from = new Map();
  for (const p of pending) from.set(p.restaurant_id, { id: p.restaurant_id, name: p.restaurant, n: (from.get(p.restaurant_id)?.n || 0) + 1 });
  return {
    pending, approvedToday, skipped, from: [...from.values()],
    restaurants: (rest || []).filter((r) => real(r.id)).map((r) => ({ id: r.id, name: r.name, state: r.state || null })),
  };
}

async function approveOne(id, price, now) {
  const { data: g } = await db.from('ingredients').select('id, restaurant_id, name, last_price, ai_estimate, price_approved_at, is_estimated').eq('id', id).single();
  if (!g || g.is_estimated === false || g.price_approved_at) return null;
  const { error } = await db.from('ingredients')
    .update({ last_price: price, price_approved_at: now, price_skipped_at: null, ai_estimate: g.ai_estimate ?? g.last_price })
    .eq('id', id);
  if (error) throw new Error(error.message);
  return g;
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') return res.status(200).json(await load());
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const b = req.body || {};
    const now = new Date().toISOString();
    const log = (action, r) => writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action, target_restaurant_id: r?.id || null, target_restaurant_name: r?.name || null });
    const restName = async (id) => (await db.from('restaurants').select('id, name').eq('id', id).single()).data;
    const recompute = async (byRest) => {
      for (const [rid, ids] of byRest) {
        try { await recomputeMenuCosts(db, rid, ids, { effectiveDate: now.slice(0, 10), reason: 'price_approved' }); } catch (e) { console.error('[admin/costs] recompute', e.message); }
      }
    };

    if (b.action === 'approve' || b.action === 'approve-bulk') {
      const jobs = b.action === 'approve'
        ? [b.ingredientId, ...(b.alsoIds || [])].map((id) => ({ id, price: Number(b.price) }))
        : (b.ingredientIds || []).map((id) => ({ id, price: null }));
      const byRest = new Map();
      let n = 0;
      for (const j of jobs) {
        let price = j.price;
        if (price == null) {
          const { data: g } = await db.from('ingredients').select('last_price').eq('id', j.id).single();
          price = Number(g?.last_price);
        }
        if (!(price > 0)) continue;
        const g = await approveOne(j.id, price, now);
        if (!g) continue;
        n++;
        if (!byRest.has(g.restaurant_id)) byRest.set(g.restaurant_id, []);
        byRest.get(g.restaurant_id).push(g.id);
        await log(`Approved ${g.name} at $${price.toFixed(2)}`, await restName(g.restaurant_id));
      }
      await recompute(byRest);
      return res.status(200).json({ ok: true, approved: n });
    }

    if (b.action === 'skip') {
      const { data: g } = await db.from('ingredients').select('id, name, restaurant_id').eq('id', b.ingredientId).single();
      if (!g) return res.status(404).json({ error: 'Not found' });
      await db.from('ingredients').update({ price_skipped_at: now }).eq('id', g.id);
      await log(`Skipped the guess for ${g.name}`, await restName(g.restaurant_id));
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'undo') {
      const { data: g } = await db.from('ingredients').select('id, name, restaurant_id, ai_estimate, is_estimated, price_approved_at').eq('id', b.ingredientId).single();
      if (!g) return res.status(404).json({ error: 'Not found' });
      if (g.is_estimated === false) return res.status(400).json({ error: 'An invoice has priced it since. Nothing to undo.' });
      const patch = { price_skipped_at: null, price_approved_at: null };
      if (g.price_approved_at && g.ai_estimate != null) patch.last_price = g.ai_estimate;
      await db.from('ingredients').update(patch).eq('id', g.id);
      if (g.price_approved_at) await recompute(new Map([[g.restaurant_id, [g.id]]]));
      await log(`Undid the decision on ${g.name}`, await restName(g.restaurant_id));
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'set-state') {
      const state = String(b.state || '').trim().toUpperCase().slice(0, 2) || null;
      await db.from('restaurants').update({ state }).eq('id', b.restaurantId);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin/costs]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}