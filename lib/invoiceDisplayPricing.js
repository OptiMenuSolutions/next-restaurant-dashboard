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