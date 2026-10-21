// pages/api/admin/review/menus.js
// The menu side of the Review queue: dishes the menu reader created that
// you have not checked yet (menu_items.admin_reviewed_at is empty).
// GET                     -> restaurants with dishes waiting, and counts
// GET ?restaurant=<id>    -> those dishes, each with its components and
//                            ingredient lines, plus the ingredient list
// POST { action: 'save', dishId, lines, removed, added }
//        lines:   [{ id, quantity, unit, ingredient_id }]   edits to existing lines
//        removed: [lineId]
//        added:   [{ component_id, ingredient_id, quantity, unit }]
// POST { action: 'checked', dishIds }   marks dishes checked

import { adminDb as db, requireAdmin, TOUR_RESTAURANT_ID } from '../../../../lib/admin/requireAdmin';
import { writeAuditLog } from '../../../../lib/admin/withAdminAuth';
import { fetchAll } from '../../../../lib/admin/fetchAll';
import { recomputeMenuCosts } from '../../../../lib/recomputeMenuCosts';
import { calculateStandardizedCost } from '../../../../lib/standardizedUnits';

const priced = (g) => g && (g.is_estimated === false || !!g.price_approved_at);

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      if (!req.query.restaurant) {
        const rows = await fetchAll(() => db.from('menu_items').select('id, restaurant_id, created_at').is('admin_reviewed_at', null).is('archived_at', null).order('id'));
        const by = new Map();
        for (const d of rows) {
          if (d.restaurant_id === TOUR_RESTAURANT_ID) continue;
          const cur = by.get(d.restaurant_id) || { n: 0, oldest: d.created_at };
          cur.n++;
          if (d.created_at < cur.oldest) cur.oldest = d.created_at;
          by.set(d.restaurant_id, cur);
        }
        const ids = [...by.keys()];
        const { data: rest } = ids.length ? await db.from('restaurants').select('id, name').in('id', ids) : { data: [] };
        return res.status(200).json({
          restaurants: (rest || []).map((r) => ({ id: r.id, name: r.name, dishes: by.get(r.id).n, oldest: by.get(r.id).oldest }))
            .sort((a, b) => (a.oldest < b.oldest ? -1 : 1)),
        });
      }

      const rid = req.query.restaurant;
      const [{ data: rest }, dishes, ingredients] = await Promise.all([
        db.from('restaurants').select('id, name').eq('id', rid).single(),
        fetchAll(() => db.from('menu_items').select(`
          id, name, price, category, description, created_at,
          menu_item_components ( id, name, component_ingredients ( id, quantity, unit, ingredient_id ) )
        `).eq('restaurant_id', rid).is('admin_reviewed_at', null).is('archived_at', null).order('id')),
        fetchAll(() => db.from('ingredients').select('id, name, unit, last_price, is_estimated, price_approved_at').eq('restaurant_id', rid).order('id')),
      ]);
      const ingById = new Map(ingredients.map((g) => [g.id, g]));

      const out = dishes.map((d) => {
        let cost = 0;
        let waiting = 0;
        const components = (d.menu_item_components || []).map((c) => {
          let sub = 0;
          const lines = (c.component_ingredients || []).map((l) => {
            const g = ingById.get(l.ingredient_id);
            const lineCost = g && Number(g.last_price) > 0
              ? calculateStandardizedCost(Number(l.quantity) || 0, l.unit || g.unit || 'each', Number(g.last_price), g.unit || l.unit || 'each', g.name)
              : null;
            if (lineCost != null) sub += lineCost;
            if (!priced(g)) waiting++;
            return { id: l.id, quantity: l.quantity, unit: l.unit, ingredient_id: l.ingredient_id, ingredient: g?.name || 'Missing ingredient', priced: priced(g), cost: lineCost };
          });
          cost += sub;
          return { id: c.id, name: c.name, cost: sub, lines };
        });
        return { id: d.id, name: d.name, price: d.price, category: d.category, description: d.description, created_at: d.created_at, components, cost, waiting };
      }).sort((a, b) => String(a.category).localeCompare(String(b.category)) || a.name.localeCompare(b.name));

      return res.status(200).json({
        restaurant: rest,
        dishes: out,
        ingredients: ingredients.map((g) => ({ id: g.id, name: g.name, unit: g.unit, priced: priced(g) })).sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};

    if (b.action === 'checked') {
      const ids = (b.dishIds || []).filter(Boolean);
      if (!ids.length) return res.status(400).json({ error: 'No dishes given' });
      const { data: dishes } = await db.from('menu_items').select('id, restaurant_id').in('id', ids);
      const { error } = await db.from('menu_items').update({ admin_reviewed_at: new Date().toISOString() }).in('id', ids);
      if (error) throw new Error(error.message);
      const rid = dishes?.[0]?.restaurant_id;
      const { data: r } = rid ? await db.from('restaurants').select('id, name').eq('id', rid).single() : { data: null };
      await writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action: `Checked ${ids.length} parsed dish${ids.length === 1 ? '' : 'es'}`, target_restaurant_id: r?.id, target_restaurant_name: r?.name });
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'save') {
      const { data: dish } = await db.from('menu_items').select('id, name, restaurant_id, menu_item_components(id)').eq('id', b.dishId).single();
      if (!dish) return res.status(404).json({ error: 'Dish not found' });
      const rid = dish.restaurant_id;
      const compIds = new Set((dish.menu_item_components || []).map((c) => c.id));

      // Lines must belong to this dish, ingredients to this restaurant.
      const { data: ownLines } = compIds.size
        ? await db.from('component_ingredients').select('id, ingredient_id, component_id').in('component_id', [...compIds])
        : { data: [] };
      const lineById = new Map((ownLines || []).map((l) => [l.id, l]));
      const wanted = [...new Set([...(b.lines || []), ...(b.added || [])].map((l) => l.ingredient_id).filter(Boolean))];
      const { data: owned } = wanted.length ? await db.from('ingredients').select('id').eq('restaurant_id', rid).in('id', wanted) : { data: [] };
      const ok = new Set((owned || []).map((g) => g.id));
      const touched = new Set();
      const num = (v) => (isNaN(Number(v)) ? 0 : Number(v));

      for (const l of b.lines || []) {
        const old = lineById.get(l.id);
        if (!old || !ok.has(l.ingredient_id)) continue;
        await db.from('component_ingredients').update({ quantity: num(l.quantity), unit: String(l.unit || 'each').trim(), ingredient_id: l.ingredient_id }).eq('id', l.id);
        touched.add(old.ingredient_id);
        touched.add(l.ingredient_id);
      }
      for (const id of b.removed || []) {
        const old = lineById.get(id);
        if (!old) continue;
        await db.from('component_ingredients').delete().eq('id', id);
        touched.add(old.ingredient_id);
      }
      const adds = (b.added || []).filter((a) => compIds.has(a.component_id) && ok.has(a.ingredient_id))
        .map((a) => ({ component_id: a.component_id, ingredient_id: a.ingredient_id, quantity: num(a.quantity), unit: String(a.unit || 'each').trim() }));
      if (adds.length) {
        const { error } = await db.from('component_ingredients').insert(adds);
        if (error) throw new Error(error.message);
        adds.forEach((a) => touched.add(a.ingredient_id));
      }
      // Include every ingredient still on the dish, so its cost is redone
      // even when the only change was a removed line.
      const { data: nowLines } = compIds.size ? await db.from('component_ingredients').select('ingredient_id').in('component_id', [...compIds]) : { data: [] };
      (nowLines || []).forEach((l) => touched.add(l.ingredient_id));
      touched.delete(undefined);
      touched.delete(null);
      if (touched.size) await recomputeMenuCosts(db, rid, [...touched], { effectiveDate: new Date().toISOString().slice(0, 10), reason: 'admin_recipe_edit' });
      const { data: r } = await db.from('restaurants').select('id, name').eq('id', rid).single();
      await writeAuditLog({ admin_id: admin.user.id, admin_name: admin.name, action: `Edited the recipe for ${dish.name}`, target_restaurant_id: r?.id, target_restaurant_name: r?.name });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin/review/menus]', err);
    return res.status(500).json({ error: err.message || 'Something went wrong' });
  }
}