import { getInvoiceEffectiveDate } from './invoiceRepricing.js';
import { evaluateInvoicePricingEligibility } from './invoiceSupportedPricing.js';
import { safeInvoiceStandardPrice } from './safeInvoicePricing.js';

const DAY_MS = 86400000;

export function ingredientPurchaseRows(items, restaurantId, today) {
  if (typeof today !== 'string' || getInvoiceEffectiveDate({ date: today }) !== today) {
    throw new TypeError('A valid restaurant-local date is required.');
  }
  return items
    .filter((r) =>
      r.invoices?.restaurant_id === restaurantId &&
      getInvoiceEffectiveDate(r.invoices) != null &&
      getInvoiceEffectiveDate(r.invoices) <= today
    )
    .map((r) => ({
      ...r,
      invoices: {
        ...r.invoices,
        effective_date: getInvoiceEffectiveDate(r.invoices),
      },
    }))
    .sort((a, b) =>
      b.invoices.effective_date.localeCompare(a.invoices.effective_date) ||
      String(b.invoices.created_at || '').localeCompare(String(a.invoices.created_at || '')) ||
      String(b.id || '').localeCompare(String(a.id || ''))
    );
}

export function purchaseAge(today, date) {
  if (
    typeof today !== 'string' || typeof date !== 'string' ||
    getInvoiceEffectiveDate({ date: today }) !== today ||
    getInvoiceEffectiveDate({ date }) !== date
  ) return null;
  return (Date.parse(today + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / DAY_MS;
}

export function purchaseAmount(row) {
  if (row.amount != null && row.amount !== '') {
    const amount = Number(row.amount);
    return Number.isFinite(amount) ? amount : 0;
  }
  const amount = Number(row.quantity) * Number(row.unit_cost);
  return Number.isFinite(amount) ? amount : 0;
}

export function ingredientDisplayPrice(ingredient) {
  if (
    ingredient.price_status === 'needs_review' ||
    !(ingredient.is_estimated === false || ingredient.price_approved_at) ||
    ingredient.last_price == null ||
    ingredient.last_price === ''
  ) return null;
  const price = Number(ingredient.last_price);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

// The evidence argument must be loaded on the server, never supplied by a client.
export function ingredientPurchaseUnitCost(line, ingredient, evidence = null) {
  const decision = evaluateInvoicePricingEligibility({ line, ingredient, evidence });
  if (!decision.eligible) return null;
  const target = safeInvoiceStandardPrice(1, ingredient.unit);
  const source = decision.standardizedPrice;
  if (!target || target.unit !== source.unit || !(target.price > 0)) return null;
  const price = source.price / target.price;
  return Number.isFinite(price) && price >= 0 ? price : null;
}
