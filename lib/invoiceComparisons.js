import { getInvoiceEffectiveDate } from './invoiceRepricing.js';

export function clearInvoiceComparisons(rows) {
  return rows.map((row) => ({
    ...row, comparisonUnitCost: null, prevUnitCost: null, prevDate: null,
  }));
}

export function invoiceComparisons(invoice, rows, report, restaurantId) {
  const cleared = clearInvoiceComparisons(rows);
  const today = report?.today;
  if (
    report?.restaurantId !== restaurantId ||
    typeof today !== 'string' ||
    getInvoiceEffectiveDate({ date: today }) !== today ||
    !Array.isArray(report.items)
  ) throw new Error('Invalid purchase-history response.');

  const owned = report.items.filter((r) =>
    r.invoices?.restaurant_id === restaurantId &&
    r.invoice_id === r.invoices?.id
  );
  const usablePrice = (r) =>
    r.display_unit_cost != null && r.display_unit_cost !== '' &&
    Number.isFinite(Number(r.display_unit_cost)) && Number(r.display_unit_cost) > 0;

  return cleared.map((row) => {
    const current = owned.find((r) =>
      r.id === row.id && r.invoice_id === invoice.id &&
      r.ingredient_id === row.ingredientId
    );
    const date = getInvoiceEffectiveDate(current?.invoices);
    if (!current || !date || date > today || !usablePrice(current)) return row;
    const candidates = owned.filter((r) => {
      const priorDate = getInvoiceEffectiveDate(r.invoices);
      const duplicate = current.invoices.number &&
        r.invoices.number === current.invoices.number &&
        String(r.invoices.supplier || '').trim().toLowerCase() ===
          String(current.invoices.supplier || '').trim().toLowerCase();
      return r.ingredient_id === current.ingredient_id &&
        r.invoice_id !== current.invoice_id && !duplicate &&
        priorDate != null && priorDate < date && usablePrice(r);
    }).sort((a, b) =>
      getInvoiceEffectiveDate(b.invoices).localeCompare(getInvoiceEffectiveDate(a.invoices)) ||
      String(b.invoices.created_at || '').localeCompare(String(a.invoices.created_at || '')) ||
      String(b.id).localeCompare(String(a.id))
    );
    const prior = candidates[0];
    if (!prior) return row;
    // Conflicting prices on that invoice do not establish one comparison price.
    if (candidates.some((r) =>
      r.invoice_id === prior.invoice_id &&
      Number(r.display_unit_cost) !== Number(prior.display_unit_cost)
    )) return row;
    return {
      ...row,
      comparisonUnitCost: Number(current.display_unit_cost),
      prevUnitCost: Number(prior.display_unit_cost),
      prevDate: getInvoiceEffectiveDate(prior.invoices),
    };
  });
}
