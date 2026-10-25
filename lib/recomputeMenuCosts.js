// lib/recomputeMenuCosts.js
// One place that recomputes dish costs after ingredient prices change, called
// by every costing path (confirm-invoice, link-item). For every dish using a
// changed ingredient, from both component recipes and the older flat recipe
// table, it recomputes the cost from current prices, saves menu_items.cost,
// and records a cost history row dated to the invoice rather than the upload
// time, so uploading a backlog of invoices in one sitting still gives a true
// cost timeline.
import { fetchAll } from './admin/fetchAll';
import { deliverPriceAlerts, deliverLowMarginAlerts } from './notifications/priceAlerts';

async function recomputeCosts(supabase, restaurantId, ingredientIds, { effectiveDate, reason = 'invoice_update' } = {}) {
  const ids = [...new Set((ingredientIds || []).filter(Boolean))];
  if (!ids.length) return { updated: 0, blocked: [] };

  const affected = new Set();

  for (let offset = 0; offset < ids.length; offset += 300) {
    const batch = ids.slice(offset, offset + 300);

    const [components, flat] = await Promise.all([
      fetchAll(() => supabase
        .from('component_ingredients')
        .select('id,menu_item_components(menu_item_id)')
        .in('ingredient_id', batch)
        .order('id')
      ),
      fetchAll(() => supabase
        .from('menu_item_ingredients')
        .select('id,menu_item_id')
        .in('ingredient_id', batch)
        .order('id')
      ),
    ]);

    for (const row of components) {
      if (row.menu_item_components?.menu_item_id) {
        affected.add(row.menu_item_components.menu_item_id);
      }
    }

    for (const row of flat) {
      affected.add(row.menu_item_id);
    }
  }

  const dishIds = [...affected].sort();
  const changes = [];
  const blocked = [];

  for (let offset = 0; offset < dishIds.length; offset += 300) {
    const dishes = await fetchAll(() => supabase
      .from('menu_items')
      .select('id,name,cost')
      .eq('restaurant_id', restaurantId)
      .in('id', dishIds.slice(offset, offset + 300))
      .order('id')
    );

    for (const d of dishes) {
      const { data, error } = await supabase.rpc(
        'recalculate_dish_cost',
        { p_dish_id: d.id }
      );

      if (error) throw new Error(error.message);

      if (!data?.ready) {
        blocked.push({
          dishId: d.id,
          dish: d.name,
          issues: data?.issues || [],
        });
        continue;
      }

      changes.push({
        d,
        rounded: Number(data.cost),
        old: Number(data.previous_cost ?? d.cost ?? 0),
        revision: data.revision,
        changed: data.changed,
      });
    }
  }

  if (!changes.length) return { updated: 0, blocked };

  // Latest recorded cost per dish: a row that would repeat it is skipped
  // (two invoices saved close together used to write near-duplicates).
  const history = [];

  for (let offset = 0; offset < changes.length; offset += 300) {
    history.push(...await fetchAll(() => supabase
      .from('menu_item_cost_history')
      .select('id,menu_item_id,new_cost,created_at')
      .in(
        'menu_item_id',
        changes.slice(offset, offset + 300).map((c) => c.d.id)
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    ));
  }
  const latest = {};
  for (const h of history || []) {
    if (!(h.menu_item_id in latest)) latest[h.menu_item_id] = Number(h.new_cost);
  }

  // Noon UTC keeps the invoice's calendar date in US time zones.
  const t = effectiveDate ? new Date(`${String(effectiveDate).slice(0, 10)}T12:00:00Z`) : null;
  const createdAt = t && !isNaN(t) ? t.toISOString() : new Date().toISOString();

  await Promise.all(changes.map(async ({ d, rounded, old, revision }) => {
    if (
      latest[d.id] !== undefined &&
      Math.abs(latest[d.id] - rounded) <= 0.001
    ) {
      return;
    }

    const { error } = await supabase
      .from('menu_item_cost_history')
      .upsert({
        menu_item_id: d.id,
        cost_revision: revision,
        menu_item_name: d.name,
        old_cost: old,
        new_cost: rounded,
        change_reason: reason,
        restaurant_id: restaurantId,
        created_at: createdAt,
      }, {
        onConflict: 'menu_item_id,cost_revision',
        ignoreDuplicates: true,
      });

    if (error) throw new Error(error.message);
  }));

  return {
    updated: changes.filter((change) => change.changed).length,
    blocked,
  };
}

export async function recomputeMenuCosts(...args) {
  const result = await recomputeCosts(...args);
  const notificationErrors = [];

  for (const deliver of [deliverPriceAlerts, deliverLowMarginAlerts]) {
    try {
      const alerts = await deliver(args[0], args[1]);
      notificationErrors.push(...alerts.failures);
    } catch (error) {
      console.error('[owner-alerts]', args[1], error.message);
      notificationErrors.push(error.message);
    }
  }

  return { ...result, notificationErrors };
}