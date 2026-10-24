// lib/currentInventory.js
// Estimated on-hand inventory: every delivery still in stock, per restaurant.
// Built by rebuildCurrentInventory (overnight, and after any invoice save or
// line link) and read by the dashboard Waste Risk panel and Tonight's Dish, so
// both read the same stored estimates without recalculating history on each visit.
//
// Estimated, not counted: deliveries minus what recipes say POS sales used.
// Days left is not stored; it is worked out at read time from the delivery
// date and shelf life, so rows never go stale just because the date changed.

import { computeWasteRisk } from './computeWasteRisk';

const EXPIRY_GRACE_DAYS = 3; // same grace as computeWasteRisk
const TIME_ZONE = 'America/New_York';

const todayLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`)) / 86400000);
}

const MIN_ANSWERS = 3;

async function readAllInventoryRows(makeQuery, label) {
  const rows = [];
  const PAGE = 500;

  for (let from = 0; ; ) {
    let page;

    try {
      const { data, error } = await makeQuery()
        .range(from, from + PAGE - 1);

      if (error) throw error;

      if (!Array.isArray(data)) {
        throw new Error('Expected a list of records.');
      }

      page = data;
    } catch (error) {
      throw new Error(
        `Inventory rebuild stopped: could not load ${label}. ${
          error?.message || 'Request failed.'
        }`
      );
    }

    if (page.length === 0) return rows;

    rows.push(...page);
    from += page.length;
  }
}

/**
 * Shelf lives this restaurant's own kitchen has shown us, from waste prompt
 * answers. { ingredientNameLower: days }. An ingredient needs at least
 * MIN_ANSWERS "thrown away" answers; its shelf life is their median, never
 * shorter than the longest "all used up" answer (it was still good then).
 */
export async function loadLearnedShelfLives(supabase, restaurantId) {
  const data = await readAllInventoryRows(
    () => supabase
      .from('waste_confirmations')
      .select('id, ingredient_name, status, days_lasted')
      .eq('restaurant_id', restaurantId)
      .in('status', ['confirmed_wasted', 'confirmed_used'])
      .not('days_lasted', 'is', null)
      .order('id', { ascending: true }),
    'shelf-life history'
  );

  const byName = {};
  for (const row of data) {
    const key = String(row.ingredient_name || '').toLowerCase().trim();
    if (!key || !(row.days_lasted >= 0)) continue;
    byName[key] = byName[key] || { wasted: [], used: [] };
    (row.status === 'confirmed_wasted' ? byName[key].wasted : byName[key].used).push(row.days_lasted);
  }

  const learned = {};
  for (const [key, { wasted, used }] of Object.entries(byName)) {
    if (wasted.length < MIN_ANSWERS) continue;
    const sorted = [...wasted].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    learned[key] = Math.max(median, used.length ? Math.max(...used) : 0, 1);
  }
  return learned;
}

/** Recompute and replace a restaurant's current_inventory rows. Server only (service client). */
export async function rebuildCurrentInventory(supabase, restaurantId) {
  if (!restaurantId) {
    throw new Error('Cannot rebuild inventory without a restaurant ID.');
  }

  const startedAt = new Date();
  const throughDate = startedAt.toLocaleDateString('en-CA', {
    timeZone: TIME_ZONE,
  });

  const { data: rest, error: restaurantError } = await supabase
    .from('restaurants')
    .select('freezes_beef, freezes_poultry, freezes_pork, freezes_seafood, freezes_bakery')
    .eq('id', restaurantId)
    .single();

  if (restaurantError || !rest) {
    throw new Error(
      `Inventory rebuild stopped: could not load restaurant settings. ${
        restaurantError?.message || 'Restaurant not found.'
      }`
    );
  }

  const [
    invoices,
    invoiceItems,
    posSales,
    menuItems,
    kept,
    learnedShelfLives,
  ] = await Promise.all([
    readAllInventoryRows(
      () => supabase
        .from('invoices')
        .select('id, date')
        .eq('restaurant_id', restaurantId)
        .lte('date', throughDate)
        .order('id', { ascending: true }),
      'invoices'
    ),
    readAllInventoryRows(
      () => supabase
        .from('invoice_items')
        .select('*, invoices!inner(id, date, restaurant_id), ingredients(id, name, unit)')
        .eq('invoices.restaurant_id', restaurantId)
        .lte('invoices.date', throughDate)
        .order('id', { ascending: true }),
      'invoice lines'
    ),
    readAllInventoryRows(
      () => supabase
        .from('pos_sales')
        .select('id, item_name, quantity_sold, refunds, sale_date')
        .eq('restaurant_id', restaurantId)
        .lte('sale_date', throughDate)
        .order('id', { ascending: true }),
      'POS sales'
    ),
    // Archived dishes remain included because their sales consumed stock.
    readAllInventoryRows(
      () => supabase
        .from('menu_items')
        .select('id, name, menu_item_components(component_ingredients(quantity, unit, ingredients(name, unit)))')
        .eq('restaurant_id', restaurantId)
        .order('id', { ascending: true }),
      'menu recipes'
    ),
    readAllInventoryRows(
      () => supabase
        .from('waste_confirmations')
        .select('id, invoice_item_id')
        .eq('restaurant_id', restaurantId)
        .or('status.eq.kept,and(status.eq.pending,kept_days.gt.0)')
        .order('id', { ascending: true }),
      'kept-stock confirmations'
    ),
    loadLearnedShelfLives(supabase, restaurantId),
  ]);

  const freezeSettings = {
    beef: !!rest.freezes_beef,
    poultry: !!rest.freezes_poultry,
    pork: !!rest.freezes_pork,
    seafood: !!rest.freezes_seafood,
    bakery: !!rest.freezes_bakery,
  };

  const keptItemIds = new Set(
    kept.map((row) => row.invoice_item_id).filter(Boolean)
  );

  const risks = computeWasteRisk(
    invoiceItems,
    invoices,
    posSales,
    menuItems,
    new Date(`${throughDate}T12:00:00`),
    freezeSettings,
    keptItemIds,
    learnedShelfLives
  );

  const now = startedAt.toISOString();

  // Reject invalid calculated quantities before they can silently
  // disappear from the replacement inventory.
  for (const row of risks) {
    if (
      !row.invoiceItemId ||
      !Number.isFinite(row.invoicedQty) ||
      !Number.isFinite(row.remainingQty) ||
      !Number.isFinite(row.unitCost) ||
      !Number.isInteger(row.shelfLife) ||
      row.invoicedQty < 0 ||
      row.remainingQty < 0 ||
      row.remainingQty > row.invoicedQty ||
      row.unitCost < 0 ||
      row.shelfLife < 0
    ) {
      throw new Error(
        `Inventory rebuild stopped: invalid calculated values for ${
          row.name || 'an invoice item'
        }.`
      );
    }
  }

  const rows = risks
    .filter((r) => r.remainingQty > 0)
    .map((r) => ({
      restaurant_id: restaurantId,
      invoice_item_id: r.invoiceItemId,
      invoice_id: r.invoiceId || null,
      ingredient_id: r.ingredientId || null,
      ingredient_name: r.name,
      delivery_date: String(r.deliveryDate).slice(0, 10),
      shelf_life: r.shelfLife,
      unit: r.unit || null,
      invoiced_qty: r.invoicedQty,
      remaining_qty: r.remainingQty,
      unit_cost: r.unitCost,
      is_protein: !!r.protein,
      computed_at: now,
    }));

  const { data: savedCount, error: saveError } = await supabase.rpc(
    'replace_current_inventory',
    {
      p_restaurant_id: restaurantId,
      p_rows: rows,
    }
  );

  if (saveError) {
    throw new Error(
      `Inventory replacement failed: ${saveError.message}`
    );
  }

  return savedCount;
}

/**
 * Read a restaurant's inventory in the same shape computeWasteRisk returns,
 * with days left worked out for today. Works with the service client or the
 * signed-in user's client.
 */
export async function loadCurrentInventory(supabase, restaurantId) {
  const data = [];
  const PAGE = 500;

  for (let from = 0; ; ) {
    const { data: page, error } = await supabase
      .from('current_inventory')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('invoice_item_id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw error;
    if (!Array.isArray(page)) {
      throw new Error('Could not load current inventory. Please try again.');
    }
    if (page.length === 0) break;

    data.push(...page);
    from += page.length;
  }

  const today = todayLocal();

  const rows = (data || [])
    .map((r) => {
      const daysSinceDelivery = daysBetween(r.delivery_date, today);
      const remainingQty = Number(r.remaining_qty) || 0;
      const unitCost = Number(r.unit_cost) || 0;
      return {
        name: r.ingredient_name,
        ingredientId: r.ingredient_id,
        daysLeft: r.shelf_life - daysSinceDelivery,
        shelfLife: r.shelf_life,
        daysSinceDelivery,
        deliveryDate: r.delivery_date,
        invoiceId: r.invoice_id,
        invoiceItemId: r.invoice_item_id,
        unit: r.unit,
        invoicedQty: Number(r.invoiced_qty) || 0,
        remainingQty,
        unitCost,
        totalValue: remainingQty * unitCost,
        protein: !!r.is_protein,
        kept: r.shelf_life - daysSinceDelivery < -EXPIRY_GRACE_DAYS, // only still stored because the kitchen kept it
      };
    })
    .filter((r) => r.daysLeft >= -EXPIRY_GRACE_DAYS || r.kept);

  // Same order as computeWasteRisk: proteins first, most urgent first.
  const proteins = rows.filter((r) => r.protein).sort((a, b) => a.daysLeft - b.daysLeft);
  const others = rows.filter((r) => !r.protein).sort((a, b) => a.daysLeft - b.daysLeft);
  return [...proteins, ...others];
}