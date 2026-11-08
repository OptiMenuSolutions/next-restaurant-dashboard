import {
  safeInvoiceStandardPrice,
} from './safeInvoicePricing.js';

import {
  hasVerifiedInvoicePrice,
} from './invoicePriceProvenance.js';

import {
  evaluateInvoicePricingEligibility,
} from './invoiceSupportedPricing.js';

/**
 * Select the newest eligible invoice pricing source.
 *
 * Default behavior remains unchanged.
 *
 * Invoice-supported pricing requires an explicit opt-in,
 * an owned ingredient, and trusted database evidence.
 */
export function selectInvoiceRepricingSource(
  lines = [],
  {
    requireVerified = false,
    allowInvoiceSupported = false,
    ingredient = null,
    evidenceByLineId = null,
  } = {}
) {
  const candidates = lines
    .map((line) => {
      let standardizedPrice = null;

      if (
        allowInvoiceSupported &&
        requireVerified &&
        ingredient
      ) {
        const evidence =
          evidenceByLineId?.get(line.id) || null;

        const eligibility =
          evaluateInvoicePricingEligibility({
            line,
            ingredient,
            evidence,
          });

        if (!eligibility.eligible) {
          return null;
        }

        standardizedPrice =
          eligibility.standardizedPrice;
      } else {
        if (
          requireVerified &&
          !hasVerifiedInvoicePrice(line)
        ) {
          return null;
        }

        standardizedPrice =
          safeInvoiceStandardPrice(
            line.unit_cost,
            line.unit
          );
      }

      if (!standardizedPrice) {
        return null;
      }

      return {
        ...line,
        verifiedPrice: standardizedPrice,
      };
    })
    .filter(Boolean)
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