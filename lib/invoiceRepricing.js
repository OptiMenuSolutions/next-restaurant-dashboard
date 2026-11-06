import {
  safeInvoiceStandardPrice,
} from './safeInvoicePricing.js';

import {
  hasVerifiedInvoicePrice,
} from './invoicePriceProvenance.js';

/**
 * Select the newest eligible invoice pricing source.
 *
 * requireVerified:
 *   false = existing compatibility behavior
 *   true  = strict provenance enforcement
 *
 * Strict enforcement must be activated across every
 * invoice pricing workflow before production rollout.
 */
export function selectInvoiceRepricingSource(
  lines = [],
  { requireVerified = false } = {}
) {
  const candidates = lines
    .filter(line =>
      !requireVerified ||
      hasVerifiedInvoicePrice(line)
    )
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
        last_ordered_at: latest.invoices?.date || null,
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