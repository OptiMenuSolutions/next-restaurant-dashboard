import { safeInvoiceStandardPrice } from './safeInvoicePricing.js';

export function selectInvoiceRepricingSource(lines = []) {
  const candidates = lines
    .map(line => ({
      ...line,
      verifiedPrice: safeInvoiceStandardPrice(
        line.unit_cost,
        line.unit
      ),
    }))
    .filter(line => line.verifiedPrice)
    .sort((a, b) =>
      String(b.invoices?.date || '').localeCompare(
        String(a.invoices?.date || '')
      ) ||
      String(b.invoices?.created_at || '').localeCompare(
        String(a.invoices?.created_at || '')
      )
    );

  if (candidates.length) {
    const latest = candidates[0];

    return {
      status: 'priced',
      updates: {
        last_price: latest.verifiedPrice.price,
        unit: latest.verifiedPrice.unit,
        standard_unit: latest.verifiedPrice.unit,
        last_ordered_at: latest.invoices.date,
        is_estimated: false,
        price_status: 'invoice',
      },
    };
  }

  return {
    status: lines.length
      ? 'unverified'
      : 'no_linked_invoices',
    updates: null,
  };
}