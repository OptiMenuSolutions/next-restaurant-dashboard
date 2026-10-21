// pages/api/admin/library.js
// Ingredient library. Two views of the same data:
//   Global       the global_ingredients list the menu and invoice parsers
//                match against, with what restaurants actually pay.
//   Restaurant   one restaurant's own ingredients and which global each
//                one is linked to.
//
// There is no link column. A restaurant ingredient is linked to a global
// when its name, or a line name from one of its invoices, matches the
// global's name or one of its aliases. Linking adds the restaurant's name
// as an alias on the global; unlinking removes that alias. The parsers read
// the same aliases, so a link also helps future parsing.
//
// GET                         -> global list, restaurants, every restaurant
//                                ingredient with its link and price
// GET ?history=id,id,...      -> weekly invoice prices for those restaurant
//                                ingredients, last 13 weeks
// POST { action: 'create' | 'update', id?, name, unit, reference_price, reference_unit, aliases }
// POST { action: 'delete', id }
// POST { action: 'link', globalId, name }      adds name as an alias (moves it off any other global)
// POST { action: 'unlink', globalId, alias }
// POST { action: 'import', rows: [{ name, unit, reference_price }] }

import { adminDb as db, requireAdmin, TOUR_RESTAURANT_ID, etDate, addDays } from '../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../lib/admin/withAdminAuth';
import { fetchAll } from '../../../lib/admin/fetchAll';
import { convertInvoiceCostToStandardUnit, getStandardUnitForIngredient } from '../../../lib/standardizedUnits';
import { getShelfLife } from '../../../lib/shelfLife';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const WEEKS = 13;

function priceStatus(g) {
  if (g.is_estimated === false && Number(g.last_price) > 0) return 'INVOICE';
  if (g.price_approved_at && Number(g.last_price) > 0) return 'APPROVED';
  if (Number(g.last_price) > 0) return 'AI GUESS';
  return 'NO PRICE';
}

async function load() {
  const [{ data: globals, error: gErr }, { data: rest }, ingredients, lines, dishes] = await Promise.all([
    db.from('global_ingredients').select('id, name, unit, aliases, reference_price, reference_unit').order('name').limit(10000),
    db.from('restaurants').select('id, name, state, deactivated_at').order('name'),
    fetchAll(() => db.from('ingredients').select('id, restaurant_id, name, unit, last_price, last_ordered_at, is_estimated, price_approved_at').order('id')),
    fetchAll(() => db.from('invoice_items').select('id, ingredient_id, item_name').not('ingredient_id', 'is', null).order('id')),
    fetchAll(() => db.from('component_ingredients').select('id, ingredient_id, menu_item_components!inner(menu_item_id, menu_items!inner(archived_at))').order('id')),
  ]);
  if (gErr) throw new Error(gErr.message);

  const restById = new Map((rest || []).map((r) => [r.id, r]));
  const real = (rid) => rid !== TOUR_RESTAURANT_ID && restById.get(rid) && !restById.get(rid).deactivated_at;

  // Global names and aliases -> global.
  const byKey = new Map();
  for (const g of globals || []) {
    const k = norm(g.name);
    if (k && !byKey.has(k)) byKey.set(k, { g, alias: null });
  }
  for (const g of globals || []) {
    for (const a of g.aliases || []) {
      const k = norm(a);
      if (k && !byKey.has(k)) byKey.set(k, { g, alias: a });
    }
  }

  // Invoice line names per restaurant ingredient.
  const phrases = new Map();
  for (const l of lines) {
    if (!l.item_name) continue;
    const s = phrases.get(l.ingredient_id) || new Set();
    if (s.size < 8) s.add(l.item_name.trim());
    phrases.set(l.ingredient_id, s);
  }

  // Live dishes per ingredient.
  const uses = new Map();
  for (const l of dishes) {
    if (l.menu_item_components?.menu_items?.archived_at) continue;
    const s = uses.get(l.ingredient_id) || new Set();
    s.add(l.menu_item_components.menu_item_id);
    uses.set(l.ingredient_id, s);
  }

  const items = [];
  for (const g of ingredients) {
    if (!real(g.restaurant_id)) continue;
    let link = null;
    const own = byKey.get(norm(g.name));
    if (own) link = { id: own.g.id, name: own.g.name, via: own.alias ? 'alias' : 'name', alias: own.alias };
    if (!link) {
      for (const p of phrases.get(g.id) || []) {
        const hit = byKey.get(norm(p));
        if (hit) { link = { id: hit.g.id, name: hit.g.name, via: 'invoice', alias: hit.alias, phrase: p }; break; }
      }
    }
    items.push({
      id: g.id, restaurant_id: g.restaurant_id, restaurant: restById.get(g.restaurant_id)?.name || 'Unknown',
      name: g.name, unit: g.unit, price: Number(g.last_price) > 0 ? Number(g.last_price) : null,
      status: priceStatus(g), last: g.last_ordered_at || null,
      dishes: uses.get(g.id)?.size || 0, phrases: [...(phrases.get(g.id) || [])], link,
    });
  }

  const linkedTo = new Map();
  for (const it of items) {
    if (!it.link) continue;
    if (!linkedTo.has(it.link.id)) linkedTo.set(it.link.id, []);
    linkedTo.get(it.link.id).push(it);
  }

  const list = (globals || []).map((g) => {
    const mine = linkedTo.get(g.id) || [];
    const paid = mine.filter((x) => x.status === 'INVOICE');
    const units = {};
    for (const x of paid) units[x.unit] = (units[x.unit] || 0) + 1;
    const want = g.reference_unit || g.unit;
    const unit = units[want] ? want : Object.keys(units).sort((a, b) => units[b] - units[a])[0];
    const same = paid.filter((x) => x.unit === unit);
    return {
      id: g.id, name: g.name, unit: g.unit, aliases: g.aliases || [],
      reference_price: g.reference_price != null ? Number(g.reference_price) : null,
      reference_unit: g.reference_unit || null,
      restaurants: new Set(mine.map((x) => x.restaurant_id)).size,
      dishes: mine.reduce((a, x) => a + x.dishes, 0),
      avgPaid: same.length ? { price: same.reduce((a, x) => a + x.price, 0) / same.length, unit, n: same.length } : null,
      shelfLife: getShelfLife(g.name),
    };
  });

  const counts = new Map();
  for (const it of items) counts.set(it.restaurant_id, (counts.get(it.restaurant_id) || 0) + 1);
  return {
    globals: list,
    items,
    restaurants: (rest || []).filter((r) => real(r.id) && counts.get(r.id)).map((r) => ({ id: r.id, name: r.name, n: counts.get(r.id) })),
  };
}

// Weekly average invoice price (per the ingredient's own unit) for the last 13 weeks.
async function history(ids) {
  const today = etDate();
  const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
  const thisWeek = addDays(today, -dow);
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(thisWeek, (i - WEEKS + 1) * 7));
  const { data: ings } = await db.from('ingredients').select('id, restaurant_id, name, unit').in('id', ids);
  const { data: rest } = await db.from('restaurants').select('id, name').in('id', [...new Set((ings || []).map((g) => g.restaurant_id))]);
  const restName = new Map((rest || []).map((r) => [r.id, r.name]));
  const rows = await fetchAll(() => db.from('invoice_items')
    .select('id, ingredient_id, unit, unit_cost, invoices!inner(date, is_sample)')
    .in('ingredient_id', ids).gte('invoices.date', weeks[0]).eq('invoices.is_sample', false).order('id'));

  const series = (ings || []).map((g) => {
    const buckets = weeks.map(() => []);
    for (const r of rows) {
      if (r.ingredient_id !== g.id || !(Number(r.unit_cost) > 0) || !r.invoices?.date) continue;
      if (getStandardUnitForIngredient(r.unit, g.name) !== g.unit) continue; // cannot compare
      const w = Math.floor((Date.parse(r.invoices.date) - Date.parse(weeks[0])) / (7 * 86400000));
      if (w >= 0 && w < WEEKS) buckets[w].push(convertInvoiceCostToStandardUnit(Number(r.unit_cost), r.unit, g.name));
    }
    return {
      ingredientId: g.id, name: g.name, unit: g.unit, restaurant: restName.get(g.restaurant_id) || 'Unknown',
      points: buckets.map((b) => (b.length ? b.reduce((a, v) => a + v, 0) / b.length : null)),
    };
  }).filter((s) => s.points.some((p) => p != null));
  return { weeks, series };
}

const cleanAliases = (list, name) => {
  const seen = new Set([norm(name)]);
  const out = [];
  for (const a of list || []) {
    const t = String(a || '').trim();
    if (!t || seen.has(norm(t))) continue;
    seen.add(norm(t));
    out.push(t);
  }
  return out;
};

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const log = (action, metadata) => writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action, metadata });

  try {
    if (req.method === 'GET') {
      if (req.query.history) {
        const ids = String(req.query.history).split(',').filter(Boolean).slice(0, 60);
        return res.status(200).json(await history(ids));
      }
      return res.status(200).json(await load());
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const b = req.body || {};
    const { data: all } = await db.from('global_ingredients').select('id, name, aliases').limit(10000);
    const nameTaken = (name, exceptId) => (all || []).some((g) => g.id !== exceptId && norm(g.name) === norm(name));

    if (b.action === 'create' || b.action === 'update') {
      const name = String(b.name || '').trim();
      const unit = String(b.unit || '').trim();
      if (!name || !unit) return res.status(400).json({ error: 'Name and unit are required' });
      if (nameTaken(name, b.id)) return res.status(400).json({ error: `${name} is already in the library` });
      const price = b.reference_price === '' || b.reference_price == null ? null : Number(b.reference_price);
      if (price != null && !(price >= 0)) return res.status(400).json({ error: 'Reference price must be a number' });
      const row = {
        name, unit,
        reference_price: price,
        reference_unit: price == null ? null : String(b.reference_unit || unit).trim(),
        aliases: cleanAliases(b.aliases, name),
      };
      const q = b.action === 'create'
        ? db.from('global_ingredients').insert(row).select('id').single()
        : db.from('global_ingredients').update(row).eq('id', b.id).select('id').single();
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      await log(`${b.action === 'create' ? 'Added' : 'Edited'} global ingredient ${name}`, { id: data.id });
      return res.status(200).json({ ok: true, id: data.id });
    }

    if (b.action === 'delete') {
      const g = (all || []).find((x) => x.id === b.id);
      if (!g) return res.status(404).json({ error: 'Not found' });
      const { error } = await db.from('global_ingredients').delete().eq('id', g.id);
      if (error) throw new Error(error.message);
      await log(`Deleted global ingredient ${g.name}`, { id: g.id });
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'link') {
      const name = String(b.name || '').trim();
      const target = (all || []).find((x) => x.id === b.globalId);
      if (!target || !name) return res.status(400).json({ error: 'Pick a global ingredient' });
      // Take the name off any other global first, so it points to one place.
      for (const g of all || []) {
        if (g.id === target.id) continue;
        const kept = (g.aliases || []).filter((a) => norm(a) !== norm(name));
        if (kept.length !== (g.aliases || []).length) await db.from('global_ingredients').update({ aliases: kept }).eq('id', g.id);
      }
      if (norm(target.name) !== norm(name) && !(target.aliases || []).some((a) => norm(a) === norm(name))) {
        const { error } = await db.from('global_ingredients').update({ aliases: [...(target.aliases || []), name] }).eq('id', target.id);
        if (error) throw new Error(error.message);
      }
      await log(`Linked ${name} to global ${target.name}`, { id: target.id });
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'unlink') {
      const g = (all || []).find((x) => x.id === b.globalId);
      if (!g) return res.status(404).json({ error: 'Not found' });
      const kept = (g.aliases || []).filter((a) => norm(a) !== norm(b.alias));
      await db.from('global_ingredients').update({ aliases: kept }).eq('id', g.id);
      await log(`Removed alias ${b.alias} from global ${g.name}`, { id: g.id });
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'import') {
      const seen = new Set((all || []).map((g) => norm(g.name)));
      const rows = [];
      let skipped = 0;
      for (const r of (b.rows || []).slice(0, 2000)) {
        const name = String(r.name || '').trim();
        const unit = String(r.unit || '').trim();
        const price = r.reference_price === '' || r.reference_price == null ? null : Number(r.reference_price);
        if (!name || !unit || seen.has(norm(name)) || (price != null && !(price >= 0))) { skipped++; continue; }
        seen.add(norm(name));
        rows.push({ name, unit, aliases: [], reference_price: price, reference_unit: price == null ? null : unit });
      }
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('global_ingredients').insert(rows.slice(i, i + 500));
        if (error) throw new Error(error.message);
      }
      if (rows.length) await log(`Imported ${rows.length} global ingredients`, { skipped });
      return res.status(200).json({ ok: true, added: rows.length, skipped });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin/library]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}