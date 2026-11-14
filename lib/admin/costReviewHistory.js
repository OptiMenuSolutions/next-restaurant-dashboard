import { requireRestaurantTimezone, restaurantLocalDate } from '../restaurantTime.js';
import { getInvoiceEffectiveDate, isManuallyApprovedPrice } from '../invoiceRepricing.js';
import { ingredientDisplayPrice, ingredientPurchaseUnitCost, purchaseAge } from '../ingredientPurchasing.js';
import { readAllInvoiceRows } from '../invoiceReporting.js';
import { isInvoiceSupportedRepricingEnabled } from '../invoiceSupportedRepricingFlag.js';

function restaurantToday(restaurant, now) {
  if (!restaurant?.id) throw new Error('Could not load the purchase restaurant.');
  return restaurantLocalDate(requireRestaurantTimezone(restaurant.operational_timezone), now);
}

export function isCostReviewReference(ingredient, restaurant, now = new Date()) {
  if (ingredient.restaurant_id !== restaurant?.id) return false;
  if (isManuallyApprovedPrice(ingredient)) return false;
  if (ingredient.is_estimated !== false || !(ingredientDisplayPrice(ingredient) > 0)) return false;
  const today = restaurantToday(restaurant, now);
  const date = getInvoiceEffectiveDate({ date: ingredient.last_ordered_at });
  return date != null && date <= today;
}

// Approval clicks are admin activity, grouped on the existing Eastern calendar.
// Invoice eligibility below belongs to each restaurant's own calendar.
export function isCostApprovalToday(value, now = new Date()) {
  const today = restaurantLocalDate('America/New_York', now);
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp <= now &&
    restaurantLocalDate('America/New_York', timestamp) === today;
}

export async function loadCostReviewHistory(
  db, ingredients, restaurants,
  { now = new Date(), allowSupported = isInvoiceSupportedRepricingEnabled } = {}
) {
  const byRestaurant = new Map(restaurants.map(restaurant => [restaurant.id, restaurant]));
  const byIngredient = new Map(ingredients.map(ingredient => [ingredient.id, ingredient]));
  const todayByRestaurant = new Map();
  for (const ingredient of ingredients) {
    if (!todayByRestaurant.has(ingredient.restaurant_id)) {
      todayByRestaurant.set(ingredient.restaurant_id,
        restaurantToday(byRestaurant.get(ingredient.restaurant_id), now));
    }
  }

  // Only server-loaded, active evidence may support invoice prices.
  const evidenceByLine = new Map();
  const allowedIds = [...todayByRestaurant.keys()].filter(allowSupported);
  for (let i = 0; i < allowedIds.length; i += 300) {
    const ids = allowedIds.slice(i, i + 300);
    const { data } = await readAllInvoiceRows(() => db.from('invoice_supported_price_evidence')
      .select('id, invoice_item_id, invoice_id, restaurant_id, source_type, validation_status, evidence_version, invalidated_at, invalidation_reason, evidence')
      .in('restaurant_id', ids).is('invalidated_at', null).order('id'));
    for (const evidence of data) {
      if (ids.includes(evidence.restaurant_id)) evidenceByLine.set(evidence.invoice_item_id, evidence);
    }
  }

  const history = new Map();
  const ingredientIds = [...byIngredient.keys()];
  for (let i = 0; i < ingredientIds.length; i += 300) {
    const ids = ingredientIds.slice(i, i + 300);
    // Do not prefilter on invoice date: an old invoice can have a recent delivery.
    const { data } = await readAllInvoiceRows(() => db.from('invoice_items')
      .select('id, invoice_id, ingredient_id, item_name, quantity, amount, unit, unit_cost, price_verification_status, price_verification_source, price_verified_at, price_verification_evidence, invoices!invoice_items_invoice_id_fkey!inner(id, restaurant_id, date, delivery_date)')
      .in('ingredient_id', ids).order('id'));
    for (const line of data) {
      const ingredient = byIngredient.get(line.ingredient_id);
      if (!ingredient || !ids.includes(line.ingredient_id) ||
          line.invoices?.restaurant_id !== ingredient.restaurant_id ||
          line.invoice_id !== line.invoices?.id) continue;
      const date = getInvoiceEffectiveDate(line.invoices);
      const age = purchaseAge(todayByRestaurant.get(ingredient.restaurant_id), date);
      if (age == null || age < 0 || age > 180) continue;
      const price = ingredientPurchaseUnitCost(
        { ...line, restaurant_id: ingredient.restaurant_id },
        ingredient,
        evidenceByLine.get(line.id) || null
      );
      if (!(price > 0)) continue;
      const key = `${ingredient.id}|${ingredient.unit || ''}`;
      if (!history.has(key)) history.set(key, []);
      history.get(key).push(price);
    }
  }
  return history;
}