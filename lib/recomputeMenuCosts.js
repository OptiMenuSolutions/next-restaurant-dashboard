// lib/recomputeMenuCosts.js
// One place that recomputes dish costs after ingredient prices change, called
// by every costing path (confirm-invoice, link-item). For every dish using a
// changed ingredient, from both component recipes and the older flat recipe
// table, it recomputes the cost from current prices, saves menu_items.cost,
// and records a cost history row dated to the invoice rather than the upload
// time, so uploading a backlog of invoices in one sitting still gives a true
// cost timeline.
import { calculateStandardizedCost } from './standardizedUnits';

export async function recomputeMenuCosts(supabase, restaurantId, ingredientIds, { effectiveDate, reason = 'invoice_update' } = {}) {
  const ids = [...new Set((ingredientIds || []).filter(Boolean))];
  if (!ids.length) return { updated: 0 };

  // Dishes that use any changed ingredient, in either recipe structure.
  const [{ data: compRows }, { data: flatRows }] = await Promise.all([
    supabase.from('component_ingredients').select('menu_item_components(menu_item_id)').in('ingredient_id', ids),
    supabase.from('menu_item_ingredients').select('menu_item_id').in('ingredient_id', ids),
  ]);
  const dishIds = [...new Set([
    ...(compRows || []).map((r) => r.menu_item_components?.menu_item_id),
    ...(flatRows || []).map((r) => r.menu_item_id),
  ].filter(Boolean))];
  if (!dishIds.length) return { updated: 0 };

  const ing = 'id, name, unit, last_price';
  const [{ data: dishes }, { data: comps }, { data: flat }] = await Promise.all([
    supabase.from('menu_items').select('id, name, cost').in('id', dishIds).eq('restaurant_id', restaurantId),
    supabase.from('menu_item_components').select(`menu_item_id, component_ingredients(quantity, unit, ingredients:ingredient_id(${ing}))`).in('menu_item_id', dishIds),
    supabase.from('menu_item_ingredients').select(`menu_item_id, quantity, ingredients(${ing})`).in('menu_item_id', dishIds),
  ]);

  const lineCost = (qty, recipeUnit, g) => {
    const price = Number(g?.last_price) || 0;
    const q = Number(qty) || 0;
    if (!(price > 0) || !(q > 0)) return 0;
    const ingUnit = g.unit || 'oz';
    return calculateStandardizedCost(q, recipeUnit || ingUnit, price, ingUnit, g.name || '');
  };

  const newCost = {};
  const hasComponents = new Set();
  for (const c of comps || []) {
    hasComponents.add(c.menu_item_id);
    for (const ci of c.component_ingredients || []) {
      newCost[c.menu_item_id] = (newCost[c.menu_item_id] || 0) + lineCost(ci.quantity, ci.unit || ci.ingredients?.unit, ci.ingredients);
    }
  }
  // The flat table (no unit column) only counts for dishes with no
  // components, so a dish recorded both ways is not costed twice.
  for (const f of flat || []) {
    if (hasComponents.has(f.menu_item_id)) continue;
    newCost[f.menu_item_id] = (newCost[f.menu_item_id] || 0) + lineCost(f.quantity, f.ingredients?.unit, f.ingredients);
  }

  const changes = [];
  for (const d of dishes || []) {
    if (!(d.id in newCost)) continue;
    const rounded = Math.round(newCost[d.id] * 100) / 100;
    const old = Number(d.cost) || 0;
    if (!(rounded > 0) || Math.abs(rounded - old) <= 0.001) continue;
    changes.push({ d, rounded, old });
  }
  if (!changes.length) return { updated: 0 };

  // Latest recorded cost per dish: a row that would repeat it is skipped
  // (two invoices saved close together used to write near-duplicates).
  const { data: history } = await supabase
    .from('menu_item_cost_history')
    .select('menu_item_id, new_cost, created_at')
    .in('menu_item_id', changes.map((c) => c.d.id))
    .order('created_at', { ascending: false });
  const latest = {};
  for (const h of history || []) {
    if (!(h.menu_item_id in latest)) latest[h.menu_item_id] = Number(h.new_cost);
  }

  // Noon UTC keeps the invoice's calendar date in US time zones.
  const t = effectiveDate ? new Date(`${String(effectiveDate).slice(0, 10)}T12:00:00Z`) : null;
  const createdAt = t && !isNaN(t) ? t.toISOString() : new Date().toISOString();

  await Promise.all(changes.map(async ({ d, rounded, old }) => {
    await supabase.from('menu_items').update({ cost: rounded }).eq('id', d.id).eq('restaurant_id', restaurantId);
    if (latest[d.id] !== undefined && Math.abs(latest[d.id] - rounded) <= 0.001) return;
    await supabase.from('menu_item_cost_history').insert({
      menu_item_id: d.id,
      menu_item_name: d.name,
      old_cost: old,
      new_cost: rounded,
      change_reason: reason,
      restaurant_id: restaurantId,
      created_at: createdAt,
    });
  }));

  return { updated: changes.length };
}