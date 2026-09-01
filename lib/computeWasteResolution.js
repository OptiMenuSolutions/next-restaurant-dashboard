/**
 * lib/computeWasteResolution.js
 *
 * Computes the "waste-risk resolution rate" for a restaurant over a trailing
 * window: of the dollars that were genuinely at risk, what fraction did
 * OptiMenu's own recommendations actually resolve (Framing B — see chat:
 * incidental sell-through on a dish that wasn't recommended doesn't count,
 * since crediting it would overstate OptiMenu's own effect).
 *
 * Two components, both in dollars:
 *   - resolvedViaRecommendation: at-risk deliveries whose remaining quantity
 *     dropped on a day their dish was actually sitting in ai_recommendations
 *   - wasted: confirmed_wasted (full weight) + expired_unconfirmed (50% weight
 *     — see the confirmation-loop design in chat). `dismissed` is no longer
 *     reachable from the confirmation modal's UI (only two buttons exist now:
 *     thrown away / still on hand) — still handled below defensively in case
 *     older rows exist from before that change, but new confirmations will
 *     never produce it.
 *
 * confirmed_used deliveries, and still-pending confirmations, are excluded
 * entirely from both sides — the presumption was simply wrong (confirmed_used)
 * or the outcome isn't known yet (pending), so neither should move the score.
 * A quantity drop on a day the dish wasn't recommended is also excluded from
 * both — it's neither resolved-by-OptiMenu nor wasted, it's just untracked.
 *
 * @param {object} supabase       - an already-configured Supabase client.
 *                                  Works with either a service-role client
 *                                  (cron/server context) or a normal
 *                                  authenticated client scoped to one
 *                                  restaurant (RLS will naturally limit rows
 *                                  either way) — this function doesn't care
 *                                  which, it just reads what it's given.
 * @param {string} restaurantId
 * @param {number} [windowDays]   - trailing window size, default 30 (matches
 *                                  the window OptiScore's bucket 3 will use)
 * @returns {Promise<{
 *   resolvedViaRecommendation: number,
 *   wasted: number,
 *   resolutionRate: number|null,  // 0-1, or null when there's nothing to measure yet
 * }>}
 */

import { buildDishIngredientMap } from './computeWasteRisk';

// expired_unconfirmed / dismissed weight — see chat: full weight punishes a
// restaurant for an unverified system guess; zero weight makes ignoring the
// prompt strictly safer than answering honestly. Half weight splits it.
const UNCONFIRMED_WEIGHT = 0.5;

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

  const [{ data: snapshots }, { data: confirmations }, { data: recs }, { data: menuItems }] =
    await Promise.all([
      supabase
        .from('waste_risk_snapshots')
        .select('invoice_item_id,ingredient_name,remaining_qty,unit_cost,snapshot_date')
        .eq('restaurant_id', restaurantId)
        .gte('snapshot_date', windowStartStr)
        .lte('snapshot_date', todayStr)
        .order('snapshot_date', { ascending: true }),
      supabase
        .from('waste_confirmations')
        .select('invoice_item_id,status,presumed_value,last_seen_date')
        .eq('restaurant_id', restaurantId)
        .gte('last_seen_date', windowStartStr)
        .lte('last_seen_date', todayStr),
      supabase
        .from('ai_recommendations')
        .select('generated_date,recommendations')
        .eq('restaurant_id', restaurantId)
        .gte('generated_date', windowStartStr)
        .lte('generated_date', todayStr),
      supabase
        .from('menu_items')
        .select('id,name,menu_item_components(id,name,component_ingredients(quantity,unit,ingredients(id,name)))')
        .eq('restaurant_id', restaurantId)
        .limit(500),
    ]);

  const dishIngredientMap = buildDishIngredientMap(menuItems || []);

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

  for (const [, days] of snapshotsByDelivery) {
    days.sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));
    for (let i = 1; i < days.length; i++) {
      const prev = days[i - 1];
      const cur = days[i];
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

  // ── Wasted: from waste_confirmations, weighted by status ──────────────────
  let wasted = 0;
  for (const c of (confirmations || [])) {
    const value = Number(c.presumed_value) || 0;
    if (c.status === 'confirmed_wasted') {
      wasted += value;
    } else if (c.status === 'expired_unconfirmed' || c.status === 'dismissed') {
      wasted += value * UNCONFIRMED_WEIGHT;
    }
    // 'confirmed_used' and 'pending' are excluded entirely — see doc comment.
  }

  const denominator = resolvedViaRecommendation + wasted;
  const resolutionRate = denominator > 0 ? resolvedViaRecommendation / denominator : null;

  return { resolvedViaRecommendation, wasted, resolutionRate };
}
