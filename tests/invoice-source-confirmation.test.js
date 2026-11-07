import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInvoiceSourceProof,
} from '../lib/invoiceSourceProof.js';

import {
  validateConfirmedInvoiceSource,
} from '../lib/invoiceSourceConfirmation.js';

const SECRET =
  'synthetic-source-confirmation-test-secret-2026';

const DOCUMENT_FINGERPRINT = 'a'.repeat(64);

const NOW = Date.parse('2026-11-07T12:00:00Z');

function invoiceItem(overrides = {}) {
  return {
    _id: 'item_0',
    item_name_raw: 'MUSTARD DIJON SMOOTH',
    quantity_shipped: 1,
    pack_size_raw: '4 1 QT',
    pack: 4,
    size: 1,
    size_unit: 'qt',
    invoice_price: 30,
    line_total: 30,
    catch_weight: false,
    source_validation_status:
      'source_table_consistent',
    ...overrides,
  };
}

function makeProof(item) {
  return createInvoiceSourceProof({
    restaurantId: 'restaurant-1',
    invoiceNumber: 'CTB-2111',
    itemKey: item._id,
    item,
    issuedAt: NOW,
    secret: SECRET,
    documentFingerprint: DOCUMENT_FINGERPRINT,
  });
}

function signedItem(overrides = {}) {
  const item = invoiceItem();

  return {
    ...item,
    ...overrides,
    invoice_source_proof: makeProof(item),
  };
}

function calculatedCost(overrides = {}) {
  return {
    quantity: 4,
    unit: 'qt',
    unit_cost: 7.5,
    pricingStatus: 'invoice_document_consistent',
    ...overrides,
  };
}

function validate({
  item = signedItem(),
  cost = calculatedCost(),
  restaurantId = 'restaurant-1',
  invoiceNumber = 'CTB-2111',
  now = NOW,
} = {}) {
  return validateConfirmedInvoiceSource({
    item,
    resolvedCost: cost,
    restaurantId,
    invoiceNumber,
    now,
    secret: SECRET,
    documentFingerprint: DOCUMENT_FINGERPRINT,
  });
}

test('valid Dijon evidence passes confirmation', () => {
  const result = validate();

  assert.equal(result.accepted, true);
  assert.equal(result.evidence.quantity, 4);
  assert.equal(result.evidence.unit, 'qt');
  assert.equal(result.evidence.unit_cost, 7.5);
  assert.equal(result.evidence.amount, 30);
});

test('missing proof cannot authorize pricing', () => {
  const result = validate({
    item: invoiceItem(),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'missing_proof');
});

test('modified quantity is rejected', () => {
  const result = validate({
    item: signedItem({
      quantity_shipped: 2,
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('modified package is rejected', () => {
  const result = validate({
    item: signedItem({
      pack: 8,
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('modified physical unit is rejected', () => {
  const result = validate({
    item: signedItem({
      size_unit: 'lb',
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('modified source total is rejected', () => {
  const result = validate({
    item: signedItem({
      line_total: 60,
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'pricing_modified');
});

test('different calculated quantity is rejected', () => {
  const result = validate({
    cost: calculatedCost({
      quantity: 8,
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(
    result.reason,
    'confirmed_cost_mismatch'
  );
});

test('different calculated unit is rejected', () => {
  const result = validate({
    cost: calculatedCost({
      unit: 'lb',
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(
    result.reason,
    'confirmed_cost_mismatch'
  );
});

test('different calculated unit cost is rejected', () => {
  const result = validate({
    cost: calculatedCost({
      unit_cost: 15,
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(
    result.reason,
    'confirmed_cost_mismatch'
  );
});

test('another restaurant cannot use the proof', () => {
  const result = validate({
    restaurantId: 'restaurant-2',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'identity_mismatch');
});

test('another invoice cannot use the proof', () => {
  const result = validate({
    invoiceNumber: 'CTB-9999',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'identity_mismatch');
});

test('expired proofs cannot authorize pricing', () => {
  const result = validate({
    now: NOW + 3 * 60 * 60 * 1000,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'expired_proof');
});

test('unsigned numbered-can products cannot authorize pricing', () => {
  const result = validate({
    item: invoiceItem({
      pack_size_raw: '3/#10 CAN',
      source_validation_status: undefined,
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'missing_proof');
});

test('confirmation rejects evidence from another document', () => {
  const item = signedItem();

  const result = validateConfirmedInvoiceSource({
    item,
    resolvedCost: calculatedCost(),
    restaurantId: 'restaurant-1',
    invoiceNumber: 'CTB-2111',
    documentFingerprint: 'b'.repeat(64),
    now: NOW,
    secret: SECRET,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'identity_mismatch');
});