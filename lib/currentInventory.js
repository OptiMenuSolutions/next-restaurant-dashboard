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
import { applyInventoryCounts } from './applyInventoryCounts';
import { inventoryCountHistory } from './inventoryCountHistory';
import { inventoryBuild } from './inventoryBuild';

const EXPIRY_GRACE_DAYS = 3; // same grace as computeWasteRisk
const TIME_ZONE = 'America/New_York';

const todayLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`)) / 86400000);
}

const MIN_ANSWERS = 3;

export async function readAllInventoryRows(makeQuery, label) {
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

/** Rebuilds and submissions are committed atomically by the database. */
export async function rebuildCurrentInventory(
  supabase,
  restaurantId,
  submission = null
) {
  return inventoryBuild(
    supabase,
    restaurantId,
    calculateInventory,
    submission
  );
}

export async function calculateInventory(
  supabase,
  restaurantId,
  throughDate,
  submission = null
) {
  if (!restaurantId) {
    throw new Error('Restaurant ID is required.');
  }

  const startedAt = new Date();

  const counts = await inventoryCountHistory(
    supabase,
    restaurantId,
    throughDate,
    submission
  );

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
        .select('id, name, menu_item_components(component_ingredients(quantity, unit, ingredients(id, name, unit)))')
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

  const base = computeWasteRisk(
    invoiceItems,
    invoices,
    posSales,
    menuItems,
    new Date(`${throughDate}T12:00:00`),
    freezeSettings,
    keptItemIds,
    learnedShelfLives
  );

  const risks = applyInventoryCounts(
    base,
    {
      invoiceItems,
      invoices,
      posSales,
      menuItems,
      freezeSettings,
      keptItemIds,
      learnedShelfLives,
    },
    counts,
    throughDate
  );

  const now = startedAt.toISOString();

  for (const row of risks) {
    const counted = row.stockSource === 'count';

    if (
      !Number.isFinite(row.remainingQty) ||
      row.remainingQty < 0 ||
      (
        !counted &&
        (
          !row.invoiceItemId ||
          !Number.isFinite(row.invoicedQty) ||
          !Number.isFinite(row.unitCost) ||
          !Number.isInteger(row.shelfLife) ||
          row.invoicedQty < 0 ||
          row.remainingQty > row.invoicedQty ||
          row.unitCost < 0 ||
          row.shelfLife < 0
        )
      )
    ) {
      throw new Error(
        `Invalid inventory calculation for ${row.name || 'an ingredient'}.`
      );
    }
  }

  const rows = risks
    .filter((row) => row.remainingQty > 0)
    .map((row) => ({
      restaurant_id: restaurantId,
      stock_source: row.stockSource || 'invoice',
      count_line_id: row.stockSource === 'count'
        ? row.countLineId
        : null,
      invoice_item_id: row.invoiceItemId || null,
      invoice_id: row.invoiceId || null,
      ingredient_id: row.ingredientId || null,
      ingredient_name: row.name,
      delivery_date: row.deliveryDate == null
        ? null
        : String(row.deliveryDate).slice(0, 10),
      shelf_life: row.shelfLife,
      unit: row.unit || null,
      invoiced_qty: row.invoicedQty,
      remaining_qty: row.remainingQty,
      unit_cost: row.unitCost,
      is_protein: !!row.protein,
      computed_at: now,
    }));

  return { rows, risks, counts };
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
      .order('id', { ascending: true })
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

  const rows = data.map((r) => {
    const ageKnown =
      typeof r.delivery_date === 'string' &&
      r.shelf_life != null &&
      Number.isFinite(Number(r.shelf_life));

    const daysSinceDelivery = ageKnown
      ? daysBetween(r.delivery_date, today)
      : null;
    const daysLeft = ageKnown
      ? Number(r.shelf_life) - daysSinceDelivery
      : null;
    const remainingQty = Number(r.remaining_qty);
    const unitCost = r.unit_cost == null ? null : Number(r.unit_cost);

    if (
      !Number.isFinite(remainingQty) ||
      remainingQty < 0 ||
      (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) ||
      (ageKnown && !Number.isFinite(daysSinceDelivery))
    ) {
      throw new Error('Current inventory contains invalid quantities or dates.');
    }

    return {
      name: r.ingredient_name,
      ingredientId: r.ingredient_id,
      stockSource: r.stock_source || 'invoice',
      countLineId: r.count_line_id || null,
      ageKnown,
      daysLeft,
      shelfLife: ageKnown ? Number(r.shelf_life) : null,
      daysSinceDelivery,
      deliveryDate: r.delivery_date,
      invoiceId: r.invoice_id,
      invoiceItemId: r.invoice_item_id,
      unit: r.unit,
      invoicedQty: r.invoiced_qty == null ? null : Number(r.invoiced_qty),
      remainingQty,
      unitCost,
      totalValue: unitCost == null ? null : remainingQty * unitCost,
      protein: !!r.is_protein,
      kept: ageKnown && daysLeft < -EXPIRY_GRACE_DAYS,
    };
  });

  // Unknown age stays unknown and sorts after dated stock.
  const urgency = (row) => row.daysLeft ?? Infinity;
  const byUrgency = (a, b) =>
    urgency(a) < urgency(b) ? -1 : urgency(a) > urgency(b) ? 1 : 0;

  const proteins = rows.filter((r) => r.protein).sort(byUrgency);
  const others = rows.filter((r) => !r.protein).sort(byUrgency);

  return [...proteins, ...others];
}