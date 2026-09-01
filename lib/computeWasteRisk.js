/**
 * lib/computeWasteRisk.js
 *
 * Computes per-delivery waste risk rows for the dashboard, as of a given date.
 *
 * Key design decisions:
 *   - Each delivery of an ingredient produces its own row (FIFO — oldest first)
 *   - POS sales are credited via recipe lookup (dish name → ingredients) rather
 *     than direct ingredient name match against POS item names
 *   - Expired items are included up to 3 days post-expiry, then dropped
 *   - Proteins and non-proteins are treated identically for expiry cutoff
 *
 * Contract: this function does NOT filter invoiceItems/posSales by asOfDate
 * itself — it trusts the caller to have already passed data through the
 * relevant cutoff. When calling this with a past asOfDate (e.g. from the
 * daily snapshot job), filter posSales to sale_date <= asOfDate and
 * invoiceItems to invoices.date <= asOfDate before passing them in, or the
 * "as of" snapshot will be credited with sales/deliveries that hadn't
 * happened yet as of that date.
 *
 * @param {object[]} invoiceItems  - invoice_items rows with nested invoices.date
 * @param {object[]} invoices      - invoices rows ({ id, date })
 * @param {object[]} posSales      - pos_sales rows ({ item_name, quantity_sold, sale_date })
 * @param {object[]} menuItems     - menu_items rows with nested menu_item_components
 *                                   → component_ingredients → ingredients.name
 * @param {Date}     [asOfDate]    - The date to compute risk "as of". Defaults to now,
 *                                   so existing callers are unaffected. Pass a past date
 *                                   to reconstruct what the risk list looked like then.
 */

import { getShelfLife, isProtein } from './shelfLife';

// Items expired more than this many days ago are dropped from the risk list.
const EXPIRY_GRACE_DAYS = 3;

/**
 * Builds a map of { dishNameLower → [{ ingredientName, quantity }] }
 * from the full menu items array. Used to credit POS sales against
 * the correct ingredients rather than matching dish names directly.
 *
 * @param {object[]} menuItems
 * @returns {Map<string, { name: string, quantity: number }[]>}
 */
export function buildDishIngredientMap(menuItems) {
  const map = new Map();
  for (const item of (menuItems || [])) {
    const dishKey = (item.name || '').toLowerCase().trim();
    if (!dishKey) continue;
    const ingredients = [];
    for (const comp of (item.menu_item_components || [])) {
      for (const ci of (comp.component_ingredients || [])) {
        const ingName = (ci.ingredients?.name || '').trim();
        if (!ingName) continue;
        ingredients.push({
          name:     ingName,
          nameLower: ingName.toLowerCase(),
          quantity: parseFloat(ci.quantity || 0),
        });
      }
    }
    if (ingredients.length > 0) map.set(dishKey, ingredients);
  }
  return map;
}

/**
 * Converts POS sales into per-ingredient quantity-sold totals,
 * using recipe lookup to map dish names to ingredients.
 *
 * Returns: { [ingredientNameLower]: { [saleDate]: quantitySold } }
 *
 * @param {object[]} posSales
 * @param {Map}      dishIngredientMap
 * @returns {object}
 */
function buildIngredientSalesMap(posSales, dishIngredientMap) {
  const map = {};

  for (const sale of (posSales || [])) {
    const dishKey  = (sale.item_name || '').toLowerCase().trim();
    const qtySold  = parseFloat(sale.quantity_sold || 0);
    const saleDate = sale.sale_date;
    if (!dishKey || !qtySold || !saleDate) continue;

    const ingredients = dishIngredientMap.get(dishKey);
    if (!ingredients) continue;

    // Credit each ingredient in the recipe proportionally by its recipe quantity.
    // We use recipe quantity as a direct deduction (1 portion sold = recipe qty consumed).
    for (const ing of ingredients) {
      const key = ing.nameLower;
      if (!map[key]) map[key] = {};
      map[key][saleDate] = (map[key][saleDate] || 0) + (qtySold * ing.quantity);
    }
  }

  return map;
}

/**
 * Computes waste risk rows for all active ingredient deliveries, as of a
 * given date.
 *
 * @param {object[]} invoiceItems
 * @param {object[]} invoices
 * @param {object[]} posSales
 * @param {object[]} menuItems
 * @param {Date}     [asOfDate]
 * @returns {object[]} Sorted waste risk rows
 */
export function computeWasteRisk(invoiceItems, invoices, posSales, menuItems, asOfDate = new Date()) {
  // ── 1. Build invoice date lookup ──────────────────────────────────────────
  const invoiceDateMap = {};
  for (const inv of (invoices || [])) {
    if (inv.id && inv.date) invoiceDateMap[inv.id] = inv.date;
  }

  // ── 2. Build dish → ingredients map from recipes ──────────────────────────
  const dishIngredientMap  = buildDishIngredientMap(menuItems);
  const ingredientSalesMap = buildIngredientSalesMap(posSales, dishIngredientMap);

  // ── 3. Collect all deliveries per ingredient ──────────────────────────────
  // deliveriesByIngredient: { [normalizedName]: delivery[] }
  const deliveriesByIngredient = {};

  for (const item of (invoiceItems || [])) {
    const name = (item.ingredient_name_normalized || item.item_name || '').trim();
    if (!name) continue;

    const dateStr = item.invoices?.date || invoiceDateMap[item.invoice_id];
    if (!dateStr) continue;

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) continue;

    const delivery = {
      date,
      dateStr,
      unit:          item.unit,
      quantity:      parseFloat(item.quantity   || 0),
      unitCost:      parseFloat(item.unit_cost  || 0),
      invoiceId:     item.invoice_id || item.invoices?.id,
      invoiceItemId: item.id || null,
    };

    if (!deliveriesByIngredient[name]) deliveriesByIngredient[name] = [];
    deliveriesByIngredient[name].push(delivery);
  }

  // ── 4. FIFO: sort deliveries oldest-first, credit POS sales ──────────────
  const today = new Date(asOfDate);
  today.setHours(0, 0, 0, 0);

  const risks = [];

  for (const [name, deliveries] of Object.entries(deliveriesByIngredient)) {
    // Oldest delivery first — consumed before newer stock
    deliveries.sort((a, b) => a.date - b.date);

    const nameLower   = name.toLowerCase().trim();
    const salesByDate = ingredientSalesMap[nameLower] || {};

    // Running total of POS-credited quantity, drained FIFO across deliveries
    let totalSoldRemaining = Object.values(salesByDate).reduce((s, q) => s + q, 0);

    for (const delivery of deliveries) {
      const shelfLife = getShelfLife(name);

      const deliveryDate = new Date(delivery.date);
      deliveryDate.setHours(0, 0, 0, 0);

      const daysSinceDelivery = Math.floor((today - deliveryDate) / (1000 * 60 * 60 * 24));
      const daysLeft          = shelfLife - daysSinceDelivery;

      // Drop items expired more than EXPIRY_GRACE_DAYS ago
      if (daysLeft < -EXPIRY_GRACE_DAYS) continue;

      // FIFO: drain sold quantity against this delivery first
      const soldFromThisBatch = Math.min(totalSoldRemaining, delivery.quantity);
      totalSoldRemaining      = Math.max(0, totalSoldRemaining - soldFromThisBatch);

      const remainingQty = Math.max(0, delivery.quantity - soldFromThisBatch);
      const totalValue   = remainingQty * delivery.unitCost;

      risks.push({
        name,
        daysLeft,
        shelfLife,
        daysSinceDelivery,
        deliveryDate:   delivery.dateStr,
        invoiceId:      delivery.invoiceId,
        invoiceItemId:  delivery.invoiceItemId,
        unit:           delivery.unit,
        invoicedQty:    delivery.quantity,
        remainingQty,
        unitCost:       delivery.unitCost,
        totalValue,
        protein:        isProtein(name),
      });
    }
  }

  // ── 5. Sort: most urgent first (fewest days left, expired included) ───────
  // Within proteins and non-proteins alike — most urgent (lowest daysLeft) first
  const proteins  = risks.filter(r =>  r.protein).sort((a, b) => a.daysLeft - b.daysLeft);
  const others    = risks.filter(r => !r.protein).sort((a, b) => a.daysLeft - b.daysLeft);

  return [...proteins, ...others];
}
