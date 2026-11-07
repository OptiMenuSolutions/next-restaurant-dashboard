import {
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

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

  if (
    !payload ||
    payload.version !== PROOF_VERSION ||
    payload.source_type !== 'structured_ocr_table' ||
    payload.validation_status !== REQUIRED_SOURCE_STATUS
  ) {
    return reject('unsupported_proof');
  }

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