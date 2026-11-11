/**
 * Pricing values used by the client invoice display.
 *
 * An unresolved unit cost must remain null.
 * Never substitute the entire invoice line amount.
 */

export function toDisplayUnitCost(unitCost) {
  if (unitCost == null || unitCost === '') {
    return null;
  }

  const value = Number(unitCost);

  return Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * Percentage change compared with the previous
 * invoice's unit cost.
 *
 * Returns null when either price is unresolved
 * or invalid.
 */
export function invoicePriceChange(line) {
  const current = toDisplayUnitCost(line.unitCost);
  const previous = toDisplayUnitCost(line.prevUnitCost);

  if (
    current == null ||
    previous == null ||
    current <= 0 ||
    previous <= 0
  ) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}


/**
 * Format the purchasing details shown on client invoices.
 *
 * Keep the supplier's purchase quantity separate from the
 * physical ingredient quantity used for costing.
 *
 * Never treat the invoice total as a missing unit price.
 */
export function invoicePurchaseSummary(line, formatMoney) {
  const purchaseQuantity = line.purchaseQuantity;
  const purchaseUnit = line.purchaseUnit;
  const purchasePrice = toDisplayUnitCost(
    line.purchaseUnitPrice
  );
  const unitCost = toDisplayUnitCost(line.unitCost);

  if (purchaseQuantity != null && purchaseUnit) {
    const purchaseLabel =
      `${purchaseQuantity} ${purchaseUnit}`;

    if (purchasePrice != null) {
      return (
        `${purchaseLabel} @ ` +
        `${formatMoney(purchasePrice)}/${purchaseUnit}`
      );
    }

    if (
      unitCost != null &&
      line.unit &&
      purchaseUnit !== line.unit
    ) {
      return (
        `${purchaseLabel} · Costed as ${line.qty} @ ` +
        `${formatMoney(unitCost)}/${line.unit}`
      );
    }

    return `${purchaseLabel} · Purchase price unresolved`;
  }

  return (
    `${line.qty} @ ` +
    (unitCost == null
      ? 'Cost unresolved'
      : formatMoney(unitCost))
  );
}
