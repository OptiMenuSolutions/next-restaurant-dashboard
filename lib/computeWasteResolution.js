/**
 * Computes the waste-risk resolution metric.
 *
 * Recommendation attribution is currently estimated from daily
 * inventory snapshot changes. Deliveries with modeled confirmation
 * adjustments are excluded to avoid crediting disposal as sales.
 *
 * Only independently measured discarded quantities contribute
 * to the measured-waste total.
 *
 * Unconfirmed expiration and modeled disposal are not treated
 * as measured waste.
 *
 * Returns a null resolution rate when measured waste evidence
 * is insufficient.
 */

import { buildDishIngredientMap } from './computeWasteRisk';
import { readAllInventoryRows } from './currentInventory';

function normalizeName(s) {
  return (s || '').toLowerCase().trim();
}

export async function computeWasteResolution(supabase, restaurantId, windowDays = 30) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - windowDays);
  const windowStartStr = windowStart.toISOString().split('T')[0];
  const todayStr = today.toISOString().split('T')[0];

  const [snapshots, confirmations, recs, menuItems] =
    await Promise.all([
      readAllInventoryRows(
        () => supabase
          .from('waste_risk_snapshots')
          .select('invoice_item_id,ingredient_name,remaining_qty,unit_cost,snapshot_date,inventory_count_line_id')
          .eq('restaurant_id', restaurantId)
          .gte('snapshot_date', windowStartStr)
          .lte('snapshot_date', todayStr)
          .order('id', { ascending: true }),
        'waste snapshots'
      ),
      readAllInventoryRows(
        () => supabase
          .from('waste_confirmations')
          .select('invoice_item_id,status,presumed_qty,presumed_value,confirmed_waste_qty,adjustment_qty,last_seen_date')
          .eq('restaurant_id', restaurantId)
          .gte('last_seen_date', windowStartStr)
          .lte('last_seen_date', todayStr)
          .order('id', { ascending: true }),
        'waste confirmations'
      ),
      readAllInventoryRows(
        () => supabase
          .from('ai_recommendations')
          .select('generated_date,recommendations')
          .eq('restaurant_id', restaurantId)
          .gte('generated_date', windowStartStr)
          .lte('generated_date', todayStr)
          .order('generated_date', { ascending: true }),
        'recommendations'
      ),
      readAllInventoryRows(
        () => supabase
          .from('menu_items')
          .select('id,name,menu_item_components(id,name,component_ingredients(quantity,unit,ingredients(id,name)))')
          .eq('restaurant_id', restaurantId)
          .order('id', { ascending: true }),
        'menu recipes'
      ),
    ]);

  const dishIngredientMap = buildDishIngredientMap(menuItems || []);

  // An estimated inventory correction is not evidence that an
  // OptiMenu recommendation caused additional sales.
  //
  // Conservatively exclude adjusted deliveries from recommendation
  // attribution until the score can use POS-specific consumption.
  const adjustedDeliveryIds = new Set(
    confirmations
      .filter((row) => row.adjustment_qty != null)
      .map((row) => row.invoice_item_id)
      .filter(Boolean)
  );

  // Per-day set of ingredient names actually recommended that day.
  const recommendedIngredientsByDate = new Map(); // 'YYYY-MM-DD' -> Set(ingredientNameLower)
  for (const r of (recs || [])) {
    const set = new Set();
    for (const rec of (r.recommendations || [])) {
      const dishKey = normalizeName(rec.title || rec.dish || '');
      const ings = dishIngredientMap.get(dishKey);
      if (!ings) continue;
      for (const ing of ings) set.add(ing.nameLower);
    }
    recommendedIngredientsByDate.set(r.generated_date, set);
  }

  // ── Resolved-via-recommendation: walk consecutive snapshot days per delivery ──
  const snapshotsByDelivery = new Map(); // invoice_item_id -> rows, sorted by date below
  for (const s of (snapshots || [])) {
    const list = snapshotsByDelivery.get(s.invoice_item_id) || [];
    list.push(s);
    snapshotsByDelivery.set(s.invoice_item_id, list);
  }

  let resolvedViaRecommendation = 0;

  for (const [invoiceItemId, days] of snapshotsByDelivery) {
    if (adjustedDeliveryIds.has(invoiceItemId)) {
      continue;
    }

    days.sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));
    for (let i = 1; i < days.length; i++) {
      const prev = days[i - 1];
      const cur = days[i];

      // A physical count is a correction, not recommendation-driven sales.
      if (
        (prev.inventory_count_line_id || null) !==
        (cur.inventory_count_line_id || null)
      ) {
        continue;
      }

      const drop = Number(prev.remaining_qty) - Number(cur.remaining_qty);
      if (drop <= 0) continue; // no decrease (or a data anomaly) — ignore

      // Attribute the drop to the day it happened: cur.snapshot_date.
      // Note: if the cron missed a night, `days` skips straight from one
      // available snapshot to the next, and a multi-day drop gets attributed
      // entirely to the later day — same known limitation as the
      // aged-out-detection in the cron job, not a new one.
      const recommendedSet = recommendedIngredientsByDate.get(cur.snapshot_date);
      if (!recommendedSet) continue;
      if (!recommendedSet.has(normalizeName(cur.ingredient_name))) continue;

      resolvedViaRecommendation += drop * Number(prev.unit_cost);
    }
  }

  // Count only independently measured discarded quantities.
  // A Yes response confirms disposal occurred, but does not
  // establish that the entire presumed remainder was discarded.
  let wasted = 0;

  for (const c of confirmations) {
    if (
      c.status !== 'confirmed_wasted' ||
      c.confirmed_waste_qty == null
    ) {
      continue;
    }

    const measuredQty = Number(c.confirmed_waste_qty);
    const presumedQty = Number(c.presumed_qty);
    const presumedValue = Number(c.presumed_value);

    if (
      !Number.isFinite(measuredQty) ||
      !Number.isFinite(presumedQty) ||
      !Number.isFinite(presumedValue) ||
      measuredQty < 0 ||
      presumedQty <= 0 ||
      presumedValue < 0
    ) {
      continue;
    }

    const estimatedUnitCost = presumedValue / presumedQty;
    wasted += measuredQty * estimatedUnitCost;
  }

  // No measured waste means insufficient evidence for a
  // meaningful waste-resolution percentage.
  const denominator = resolvedViaRecommendation + wasted;

  const resolutionRate =
    wasted > 0 && denominator > 0
      ? resolvedViaRecommendation / denominator
      : null;

  return { resolvedViaRecommendation, wasted, resolutionRate };
}
