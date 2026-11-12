import { safeInvoiceStandardPrice } from './safeInvoicePricing.js';
import { hasVerifiedInvoicePrice } from './invoicePriceProvenance.js';
import { evaluateInvoicePricingEligibility } from './invoiceSupportedPricing.js';

function validCalendarDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  if (Number(value.slice(0, 4)) < 1) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function getInvoiceEffectiveDate(invoice) {
  const value = invoice?.delivery_date ?? invoice?.date ?? null;
  return validCalendarDate(value) ? value : null;
}

export function isDeliveredInvoice(
  invoice,
  asOfDate = new Date().toISOString().slice(0, 10)
) {
  if (!validCalendarDate(asOfDate)) {
    throw new TypeError('A valid pricing as-of date is required.');
  }

  const date = getInvoiceEffectiveDate(invoice);
  return date !== null && date <= asOfDate;
}

export function isManuallyApprovedPrice(ingredient) {
  return (
    ingredient?.price_status !== 'invoice' &&
    ingredient?.price_approved_at != null
  );
}

/**
 * Select the newest eligible delivered purchase.
 * Preserve existing source-evidence and unit checks.
 */
export function selectInvoiceRepricingSource(
  lines = [],
  {
    requireVerified = false,
    allowInvoiceSupported = false,
    ingredient = null,
    evidenceByLineId = null,
    asOfDate = new Date().toISOString().slice(0, 10),
  } = {}
) {
  if (!validCalendarDate(asOfDate)) {
    throw new TypeError('A valid pricing as-of date is required.');
  }

  if (isManuallyApprovedPrice(ingredient)) {
    return {
      status: 'manual_approved',
      updates: null,
    };
  }

  const deliveredLines = lines.filter(line =>
    isDeliveredInvoice(line.invoices, asOfDate)
  );

  const candidates = deliveredLines
    .map((line) => {
      let standardizedPrice = null;

      if (
        allowInvoiceSupported &&
        requireVerified &&
        ingredient
      ) {
        const eligibility = evaluateInvoicePricingEligibility({
          line,
          ingredient,
          evidence: evidenceByLineId?.get(line.id) || null,
        });

        if (!eligibility.eligible) return null;

        standardizedPrice = eligibility.standardizedPrice;
      } else {
        if (
          requireVerified &&
          !hasVerifiedInvoicePrice(line)
        ) {
          return null;
        }

        standardizedPrice = safeInvoiceStandardPrice(
          line.unit_cost,
          line.unit
        );
      }

      if (!standardizedPrice) return null;

      return {
        ...line,
        effectiveDate: getInvoiceEffectiveDate(line.invoices),
        verifiedPrice: standardizedPrice,
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      b.effectiveDate.localeCompare(a.effectiveDate) ||
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
        last_ordered_at: latest.effectiveDate,
        is_estimated: false,
        price_status: 'invoice',
      },
    };
  }

  return {
    status: !lines.length
      ? 'no_linked_invoices'
      : !deliveredLines.length
        ? 'not_delivered'
        : 'unverified',
    updates: null,
  };
}