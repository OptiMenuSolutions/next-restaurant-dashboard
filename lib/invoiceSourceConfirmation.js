import {
  verifyInvoiceSourceProof,
} from './invoiceSourceProof.js';

import {
  calculateVerifiedInvoiceCost,
} from './verifiedInvoiceCosting.js';

function positiveNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? number
    : null;
}

function amountsAgree(a, b) {
  const first = positiveNumber(a);
  const second = positiveNumber(b);

  if (first === null || second === null) {
    return false;
  }

  return (
    Math.abs(first - second) <=
    Math.max(0.000001, Math.abs(first) * 0.000001)
  );
}

/**
 * Authenticate an invoice source proof and verify that
 * the calculated invoice cost agrees with its signed data.
 *
 * No database writes occur here.
 *
 * A failed or missing proof never authorizes
 * invoice-supported ingredient pricing.
 */
export function validateConfirmedInvoiceSource({
  item,
  resolvedCost,
  restaurantId,
  invoiceNumber,
  documentFingerprint,
  secret,
  now,
} = {}) {
  const reject = (reason) => ({
    accepted: false,
    reason,
    evidence: null,
  });

  if (!item?.invoice_source_proof) {
    return reject('missing_proof');
  }

  if (!item._id) {
    return reject('missing_item_identity');
  }

  const verification = verifyInvoiceSourceProof({
    proof: item.invoice_source_proof,
    restaurantId,
    invoiceNumber,
    documentFingerprint,
    itemKey: item._id,
    item,
    secret,
    ...(now === undefined ? {} : { now }),
  });

  if (!verification.valid) {
    return reject(verification.reason);
  }

  const signed = verification.payload;

  if (!signed?.pricing) {
    return reject('missing_signed_pricing');
  }

  // The structured-source proof currently supports
  // ordinary distributor packages, not catch weight.
  if (signed.pricing.catch_weight !== false) {
    return reject('unsupported_catch_weight');
  }

  // Recalculate from authenticated values, never from
  // client-submitted pricing fields.
  const expected = calculateVerifiedInvoiceCost(
    signed.pricing
  );

  if (
    expected.pricingStatus !==
      'invoice_document_consistent' ||
    !positiveNumber(expected.quantity) ||
    !positiveNumber(expected.unit_cost) ||
    !expected.unit
  ) {
    return reject('unsupported_signed_package');
  }

  if (
    !resolvedCost ||
    !amountsAgree(
      resolvedCost.quantity,
      expected.quantity
    ) ||
    resolvedCost.unit !== expected.unit ||
    !amountsAgree(
      resolvedCost.unit_cost,
      expected.unit_cost
    )
  ) {
    return reject('confirmed_cost_mismatch');
  }

  const sourceAmount =
    positiveNumber(signed.pricing.line_total);

  if (
    !sourceAmount ||
    !amountsAgree(
      expected.quantity * expected.unit_cost,
      sourceAmount
    )
  ) {
    return reject('signed_arithmetic_mismatch');
  }

  return {
    accepted: true,
    reason: null,
    evidence: {
      source_type: 'structured_ocr_table',
      validation_status: 'source_table_consistent',
      proof_version: signed.version,
      restaurant_id: restaurantId,
      invoice_number: invoiceNumber,
      document_fingerprint: signed.document_fingerprint,
      item_key: signed.item_key,
      issued_at: signed.issued_at,
      quantity: expected.quantity,
      unit: expected.unit,
      unit_cost: expected.unit_cost,
      amount: sourceAmount,
    },
  };
}