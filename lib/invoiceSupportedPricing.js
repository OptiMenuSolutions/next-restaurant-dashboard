import { safeInvoiceStandardPrice } from './safeInvoicePricing.js';
import { getUnitCategory } from './standardizedUnits.js';
import { hasVerifiedInvoicePrice } from './invoicePriceProvenance.js';

const VALID_CATEGORIES = new Set([
  'weight',
  'volume',
  'count',
]);

const SOURCE_VALIDATION_TYPE = 'structured_ocr_table';

function positiveNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? number
    : null;
}

function validInvoiceArithmetic(line) {
  const quantity = positiveNumber(line.quantity);
  const unitCost = positiveNumber(line.unit_cost);
  const amount = positiveNumber(line.amount);

  if (!quantity || !unitCost || !amount) {
    return false;
  }

  const calculatedAmount = quantity * unitCost;

  return (
    Math.abs(calculatedAmount - amount) <=
    Math.max(0.01, amount * 0.000001)
  );
}

function hasTrustedDocumentEvidence(line, evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return false;
  }

  // Only active, authenticated database evidence
  // can establish invoice-supported pricing.
  //
  // Invalidated evidence retains its original
  // validation_status for audit history, so
  // validation_status alone is not sufficient.

  if (
    evidence.source_type !== SOURCE_VALIDATION_TYPE ||
    evidence.validation_status !== 'source_table_consistent' ||
    evidence.invalidated_at != null ||
    evidence.invalidation_reason != null
  ) {
    return false;
  }

  if (
    !line.id ||
    !line.invoice_id ||
    !evidence.invoice_item_id ||
    !evidence.invoice_id
  ) {
    return false;
  }

  return (
    evidence.invoice_item_id === line.id &&
    evidence.invoice_id === line.invoice_id
  );
}

/**
 * Evaluates whether a saved invoice line can support
 * ingredient pricing.
 *
 * IMPORTANT:
 * The evidence argument must come from a trusted,
 * server-controlled validation record.
 *
 * Never pass client-submitted validation claims
 * directly to this function.
 *
 * This function only evaluates eligibility.
 * It does not modify ingredient records.
 */
export function evaluateInvoicePricingEligibility({
  line,
  ingredient,
  evidence = null,
} = {}) {
  const reject = (reason) => ({
    eligible: false,
    classification: 'unresolved',
    reason,
    standardizedPrice: null,
  });

  if (!line || !ingredient) {
    return reject('missing_record');
  }

  if (
    !line.id ||
    !line.invoice_id ||
    !ingredient.id ||
    !ingredient.restaurant_id
  ) {
    return reject('missing_identity');
  }

  if (
    line.restaurant_id !== ingredient.restaurant_id
  ) {
    return reject('restaurant_mismatch');
  }

  if (
    line.ingredient_id !== ingredient.id
  ) {
    return reject('ingredient_mismatch');
  }

  if (!validInvoiceArithmetic(line)) {
    return reject('invalid_invoice_arithmetic');
  }

  const standardizedPrice = safeInvoiceStandardPrice(
    line.unit_cost,
    line.unit
  );

  if (!standardizedPrice) {
    return reject('unsupported_invoice_unit');
  }

  const invoiceCategory = getUnitCategory(
    standardizedPrice.unit
  );

  const ingredientCategory = getUnitCategory(
    ingredient.unit
  );

  if (
    !VALID_CATEGORIES.has(invoiceCategory) ||
    !VALID_CATEGORIES.has(ingredientCategory)
  ) {
    return reject('unsupported_unit_category');
  }

  if (invoiceCategory !== ingredientCategory) {
    return reject('incompatible_units');
  }

  if (hasVerifiedInvoicePrice(line)) {
    return {
      eligible: true,
      classification: 'supplier_verified',
      reason: null,
      standardizedPrice,
    };
  }

  if (hasTrustedDocumentEvidence(line, evidence)) {
    return {
      eligible: true,
      classification: 'invoice_supported',
      reason: null,
      standardizedPrice,
    };
  }

  return reject('insufficient_source_evidence');
}