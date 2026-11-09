import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

import {
  validateInvoiceEvidenceClaims,
} from './invoiceEvidenceClaims.js';

const PROOF_VERSION = 1;
const PROOF_LIFETIME_MS = 2 * 60 * 60 * 1000;

const REQUIRED_SOURCE_STATUS = 'source_table_consistent';

function validDocumentFingerprint(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{64}$/.test(value)
  );
}

const PRICING_FIELDS = [
  'item_name_raw',
  'quantity_shipped',
  'pack_size_raw',
  'pack',
  'size',
  'size_unit',
  'invoice_price',
  'line_total',
  'catch_weight',
];

function proofSecret(secret) {
  const value = secret ?? process.env.INVOICE_SOURCE_PROOF_SECRET;

  if (typeof value !== 'string' || value.length < 32) {
    throw new Error(
      'INVOICE_SOURCE_PROOF_SECRET must contain at least 32 characters.'
    );
  }

  return value;
}

function requireIdentity(value, name) {
  if (
    typeof value !== 'string' ||
    !value.trim()
  ) {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
}

function pricingSnapshot(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('A valid invoice item is required.');
  }

  const snapshot = {};

  for (const field of PRICING_FIELDS) {
    snapshot[field] = item[field] ?? null;
  }

  return snapshot;
}

function encode(value) {
  return Buffer.from(
    JSON.stringify(value),
    'utf8'
  ).toString('base64url');
}

function signPayload(encodedPayload, secret) {
  return createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

/**
 * Creates a signed proof for one source-validated invoice item.
 *
 * IMPORTANT:
 * Only call this after server-side OCR source validation.
 *
 * Never sign browser-submitted source_validation_status
 * without independently validating the original source.
 */
export function createInvoiceSourceProof({
  restaurantId,
  invoiceNumber,
  documentFingerprint,
  item,
  itemKey,
  issuedAt = Date.now(),
  secret,
} = {}) {
  const key = proofSecret(secret);

  if (!validDocumentFingerprint(documentFingerprint)) {
    throw new Error('Valid document fingerprint is required.');
  }

  const restaurant = requireIdentity(
    restaurantId,
    'restaurantId'
  );

  const number = requireIdentity(
    invoiceNumber,
    'invoiceNumber'
  );

  const identifier = requireIdentity(
    itemKey,
    'itemKey'
  );

  if (
    item?.source_validation_status !== REQUIRED_SOURCE_STATUS
  ) {
    throw new Error(
      'Only source-validated invoice items can receive proofs.'
    );
  }

  // Version 1 does not sign actual weight or
  // weight-based pricing information.
  // Catch-weight products require a newer proof format.
  if (item.catch_weight !== false) {
    throw new Error(
      'Version 1 source proofs do not support catch-weight pricing.'
    );
  }

  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < 0
  ) {
    throw new Error('Invalid proof issuance time.');
  }

  const payload = {
    version: PROOF_VERSION,
    restaurant_id: restaurant,
    invoice_number: number,
    document_fingerprint: documentFingerprint,
    item_key: identifier,
    issued_at: issuedAt,
    source_type: 'structured_ocr_table',
    validation_status: REQUIRED_SOURCE_STATUS,
    pricing: pricingSnapshot(item),
  };

  const encodedPayload = encode(payload);
  const signature = signPayload(encodedPayload, key);

  return `${encodedPayload}.${signature}`;
}


/**
 * Version 2 source proof issuer.
 *
 * This initial version supports authenticated
 * catch-weight charges only. Ordinary invoice
 * proofs continue using the existing V1 pathway.
 *
 * The caller must supply the original OCR from
 * the server's document-processing pipeline.
 *
 * This function never accepts a client-submitted
 * chargeVerified flag as proof of source validity.
 */
export function createInvoiceEvidenceProofV2({
  restaurantId,
  invoiceNumber,
  documentFingerprint,
  item,
  itemKey,
  ocrText,
  issuedAt = Date.now(),
  secret,
} = {}) {
  const key = proofSecret(secret);

  if (!validDocumentFingerprint(documentFingerprint)) {
    throw new Error('Valid document fingerprint is required.');
  }

  const restaurant = requireIdentity(
    restaurantId,
    'restaurantId'
  );

  const number = requireIdentity(
    invoiceNumber,
    'invoiceNumber'
  );

  const identifier = requireIdentity(
    itemKey,
    'itemKey'
  );

  // Version 2 must bind the authenticated
  // source item to the signed invoice line.
  if (
    typeof item?._id !== 'string' ||
    item._id !== identifier
  ) {
    throw new Error(
      'Invoice item identity mismatch.'
    );
  }

  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < 0
  ) {
    throw new Error('Invalid proof issuance time.');
  }

  if (
    !item ||
    item.catch_weight !== true
  ) {
    throw new Error(
      'Version 2 currently supports catch-weight evidence only.'
    );
  }

  if (
    typeof ocrText !== 'string' ||
    !ocrText.trim()
  ) {
    throw new Error('Original OCR text is required.');
  }

  // Independently authenticate against the OCR.
  // Do not trust flags or validation statuses
  // supplied on the invoice item.
  const [claim] = validateInvoiceEvidenceClaims(
    [item],
    ocrText
  );

  if (
    !claim?.chargeVerified ||
    !claim.verifiedValues ||
    claim.verifiedValues.weight_unit !== 'lb'
  ) {
    throw new Error(
      'Catch-weight source evidence could not be authenticated.'
    );
  }

  const verified = claim.verifiedValues;

  const actualWeight = Number(verified.actual_weight);
  const unitPrice = Number(verified.invoice_price);
  const lineTotal = Number(verified.line_total);

  if (
    !Number.isFinite(actualWeight) ||
    actualWeight <= 0 ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0 ||
    !Number.isFinite(lineTotal) ||
    lineTotal <= 0 ||
    Math.abs(actualWeight * unitPrice - lineTotal) > 0.01
  ) {
    throw new Error(
      'Authenticated catch-weight arithmetic is invalid.'
    );
  }

  const pricing = {
    ...pricingSnapshot(item),
    actual_weight: actualWeight,
    weight_unit: 'lb',
    price_basis: 'per_lb',
  };

  const payload = {
    version: 2,
    restaurant_id: restaurant,
    invoice_number: number,
    document_fingerprint: documentFingerprint,
    item_key: identifier,
    issued_at: issuedAt,
    source_type: 'independent_ocr_evidence',
    validation_status: 'source_charge_verified',
    source_row_sha256: createHash('sha256')
      .update(claim.sourceRow, 'utf8')
      .digest('hex'),
    pricing,
  };

  const encodedPayload = encode(payload);
  const signature = signPayload(encodedPayload, key);

  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies a proof against the values currently submitted
 * for invoice confirmation.
 *
 * Returns a structured result without modifying anything.
 */
export function verifyInvoiceSourceProof({
  proof,
  restaurantId,
  invoiceNumber,
  documentFingerprint,
  item,
  itemKey,
  now = Date.now(),
  secret,
} = {}) {
  const reject = (reason) => ({
    valid: false,
    reason,
    payload: null,
  });

  let key;

  try {
    key = proofSecret(secret);
  } catch {
    return reject('proof_configuration_error');
  }

  if (
    typeof proof !== 'string' ||
    proof.length > 8192
  ) {
    return reject('invalid_proof');
  }

  const parts = proof.split('.');

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return reject('invalid_proof');
  }

  const [encodedPayload, suppliedSignature] = parts;

  const expectedSignature = signPayload(
    encodedPayload,
    key
  );

  const supplied = Buffer.from(
    suppliedSignature,
    'utf8'
  );

  const expected = Buffer.from(
    expectedSignature,
    'utf8'
  );

  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return reject('invalid_signature');
  }

  let payload;

  try {
    payload = JSON.parse(
      Buffer.from(
        encodedPayload,
        'base64url'
      ).toString('utf8')
    );
  } catch {
    return reject('invalid_payload');
  }

  const isV1 =
    payload?.version === PROOF_VERSION &&
    payload.source_type === 'structured_ocr_table' &&
    payload.validation_status === REQUIRED_SOURCE_STATUS;

  const isV2 =
    payload?.version === 2 &&
    payload.source_type === 'independent_ocr_evidence' &&
    payload.validation_status === 'source_charge_verified' &&
    typeof payload.source_row_sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(payload.source_row_sha256);

  if (!isV1 && !isV2) {
    return reject('unsupported_proof');
  }

  if (isV1 && payload.pricing?.catch_weight !== false) {
    return reject('unsupported_catch_weight');
  }

  if (isV2) {
    const pricing = payload.pricing;

    if (
      !pricing ||
      pricing.catch_weight !== true ||
      pricing.weight_unit !== 'lb' ||
      pricing.price_basis !== 'per_lb' ||
      !Number.isFinite(pricing.actual_weight) ||
      pricing.actual_weight <= 0 ||
      !Number.isFinite(pricing.invoice_price) ||
      pricing.invoice_price <= 0 ||
      !Number.isFinite(pricing.line_total) ||
      pricing.line_total <= 0 ||
      Math.abs(
        pricing.actual_weight * pricing.invoice_price -
        pricing.line_total
      ) > 0.01
    ) {
      return reject('unsupported_proof');
    }
  }

  // Reject previously issued version 1 proofs
  // containing unsupported catch-weight pricing.
  // A valid HMAC alone does not make an unsupported
  // pricing representation financially authoritative.

  if (
    payload.restaurant_id !== restaurantId ||
    payload.invoice_number !== invoiceNumber ||
    !validDocumentFingerprint(documentFingerprint) ||
    payload.document_fingerprint !== documentFingerprint ||
    payload.item_key !== itemKey
  ) {
    return reject('identity_mismatch');
  }

  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(payload.issued_at) ||
    payload.issued_at > now ||
    now - payload.issued_at > PROOF_LIFETIME_MS
  ) {
    return reject('expired_proof');
  }

  let submittedPricing;

  try {
    submittedPricing = pricingSnapshot(item);

    if (isV2) {
      submittedPricing = {
        ...submittedPricing,
        actual_weight: item.actual_weight ?? null,
        weight_unit: 'lb',
        price_basis: 'per_lb',
      };
    }
  } catch {
    return reject('invalid_item');
  }

  if (
    JSON.stringify(payload.pricing) !==
    JSON.stringify(submittedPricing)
  ) {
    return reject('pricing_modified');
  }

  return {
    valid: true,
    reason: null,
    payload,
  };
}