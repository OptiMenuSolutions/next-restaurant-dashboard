// lib/currentInventory.js
// Estimated on-hand inventory: every delivery still in stock, per restaurant.
// Built by rebuildCurrentInventory (overnight, and after any invoice save or
// line link) and read by the dashboard Waste Risk panel and Tonight's Dish, so
// both always show the same thing without recomputing 90 days of data.
//
// Estimated, not counted: deliveries minus what recipes say POS sales used.
// Days left is not stored; it is worked out at read time from the delivery
// date and shelf life, so rows never go stale just because the date changed.

import { computeWasteRisk } from './computeWasteRisk';

const LOOKBACK_DAYS = 90;
const EXPIRY_GRACE_DAYS = 3; // same grace as computeWasteRisk
const TIME_ZONE = 'America/New_York';

const todayLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`)) / 86400000);
}

/** Recompute and replace a restaurant's current_inventory rows. Server only (service client). */
export async function rebuildCurrentInventory(supabase, restaurantId) {
  const from = new Date();
  from.setDate(from.getDate() - LOOKBACK_DAYS);
  const fromDate = from.toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

  const [
    { data: rest },
    { data: invoices },
    { data: invoiceItems, error: itemsErr },
    { data: posSales },
    { data: menuItems },
  ] = await Promise.all([
    supabase.from('restaurants')
      .select('freezes_beef, freezes_poultry, freezes_pork, freezes_seafood, freezes_bakery')
      .eq('id', restaurantId).single(),
    supabase.from('invoices').select('id, date').eq('restaurant_id', restaurantId),
    supabase.from('invoice_items')
      .select('*, invoices!inner(id, date, restaurant_id), ingredients(id, name, unit)')
      .eq('invoices.restaurant_id', restaurantId)
      .gte('invoices.date', fromDate),
    supabase.from('pos_sales')
      .select('item_name, quantity_sold, sale_date')
      .eq('restaurant_id', restaurantId)
      .gte('sale_date', fromDate),
    // Archived dishes are included on purpose: their past sales still used stock.
    supabase.from('menu_items')
      .select('name, menu_item_components(component_ingredients(quantity, unit, ingredients(name, unit)))')
      .eq('restaurant_id', restaurantId)
      .limit(500),
  ]);
  if (itemsErr) throw itemsErr;

  const freezeSettings = {
    beef: !!rest?.freezes_beef,
    poultry: !!rest?.freezes_poultry,
    pork: !!rest?.freezes_pork,
    seafood: !!rest?.freezes_seafood,
    bakery: !!rest?.freezes_bakery,
  };

  // Batches the kitchen said it is still using stay on hand past our estimate.
  const { data: kept } = await supabase
    .from('waste_confirmations')
    .select('invoice_item_id')
    .eq('restaurant_id', restaurantId)
    .or('status.eq.kept,and(status.eq.pending,kept_days.gt.0)');
  const keptItemIds = new Set((kept || []).map((k) => k.invoice_item_id));

  const risks = computeWasteRisk(invoiceItems || [], invoices || [], posSales || [], menuItems || [], new Date(), freezeSettings, keptItemIds);
  const now = new Date().toISOString();

  const rows = risks
    .filter((r) => r.invoiceItemId && r.remainingQty > 0)
    .map((r) => ({
      restaurant_id:   restaurantId,
      invoice_item_id: r.invoiceItemId,
      invoice_id:      r.invoiceId || null,
      ingredient_id:   r.ingredientId || null,
      ingredient_name: r.name,
      delivery_date:   String(r.deliveryDate).slice(0, 10),
      shelf_life:      r.shelfLife,
      unit:            r.unit || null,
      invoiced_qty:    r.invoicedQty,
      remaining_qty:   r.remainingQty,
      unit_cost:       r.unitCost,
      is_protein:      !!r.protein,
      computed_at:     now,
    }));

  const { error: delErr } = await supabase.from('current_inventory').delete().eq('restaurant_id', restaurantId);
  if (delErr) throw delErr;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('current_inventory').insert(rows.slice(i, i + 500));
    if (error) throw error;
  }
  return rows.length;
}

/**
 * Read a restaurant's inventory in the same shape computeWasteRisk returns,
 * with days left worked out for today. Works with the service client or the
 * signed-in user's client.
 */
export async function loadCurrentInventory(supabase, restaurantId) {
  const { data, error } = await supabase.from('current_inventory').select('*').eq('restaurant_id', restaurantId);
  if (error) throw error;
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