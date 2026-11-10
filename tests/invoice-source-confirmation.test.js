import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInvoiceSourceProof,
  createInvoiceEvidenceProofV2,
} from '../lib/invoiceSourceProof.js';

import {
  validateConfirmedInvoiceSource,
} from '../lib/invoiceSourceConfirmation.js';

import {
  calculateVerifiedInvoiceCost,
} from '../lib/verifiedInvoiceCosting.js';

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


test('confirmation accepts authenticated V2 catch-weight pricing when calculated cost agrees', () => {
  const header =
    '<tr><td>Item Number</td>' +
    '<td>Ordered</td><td>Shipped</td>' +
    '<td>Pack</td><td>Size</td>' +
    '<td>Unit</td><td>Description</td>' +
    '<td>Price</td><td>Extension</td></tr>';

  const row =
    '<tr><td>1030906</td><td>1</td>' +
    '<td>1</td><td>22</td>' +
    '<td>7 OZ</td><td>LB</td>' +
    '<td>BEEF SKIRT STEAK 9.96</td>' +
    '<td>14.5000</td><td>144.42</td></tr>';

  const item = {
    _id: 'item_0',
    item_name_raw: 'BEEF SKIRT STEAK 9.96',
    quantity_shipped: 1,
    quantity_unit: 'LB',
    pack_size_raw: '22 7 OZ',
    pack: 22,
    size: 7,
    size_unit: 'oz',
    invoice_price: 14.5,
    line_total: 144.42,
    catch_weight: true,
    actual_weight: 9.96,
    source_evidence: {
      row_text: row,
      description_text: 'BEEF SKIRT STEAK 9.96',
      quantity_text: '1',
      purchase_unit_text: 'LB',
      package_text: '22 7 OZ',
      weight_text: '9.96',
      weight_unit_text: 'LB',
      unit_price_text: '14.5000',
      extension_text: '144.42',
    },
  };

  const proof = createInvoiceEvidenceProofV2({
    restaurantId: 'restaurant-1',
    invoiceNumber: 'CTB-2111',
    documentFingerprint: DOCUMENT_FINGERPRINT,
    itemKey: 'item_0',
    item,
    invoiceItems: [item],
    ocrText: `<table>${header}${row}</table>`,
    issuedAt: NOW,
    secret: SECRET,
  });

  const signedItem = {
    ...item,
    invoice_source_proof: proof,
  };

  const resolvedCost =
    calculateVerifiedInvoiceCost(signedItem);

  // The actual calculated quantity must come
  // from the authenticated weight, not the
  // printed 22 x 7 OZ package description.
  assert.equal(resolvedCost.quantity, 9.96);
  assert.equal(resolvedCost.unit, 'lb');
  assert.equal(resolvedCost.unit_cost, 14.5);

  const result = validateConfirmedInvoiceSource({
    item: signedItem,
    resolvedCost,
    restaurantId: 'restaurant-1',
    invoiceNumber: 'CTB-2111',
    documentFingerprint: DOCUMENT_FINGERPRINT,
    secret: SECRET,
    now: NOW,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.evidence.proof_version, 2);
  assert.equal(result.evidence.quantity, 9.96);
  assert.equal(result.evidence.unit, 'lb');

  assert.equal(result.evidence.unit_cost, 14.5);
  assert.equal(result.evidence.amount, 144.42);

  // Verify that tampering with authenticated data
  // cannot authorize invoice-supported pricing.
  const rejectionCases = [
    {
      name: 'modified actual weight',
      item: {
        ...signedItem,
        actual_weight: 10.96,
      },
      cost: resolvedCost,
      reason: 'pricing_modified',
    },
    {
      name: 'modified invoice price',
      item: {
        ...signedItem,
        invoice_price: 15.5,
      },
      cost: resolvedCost,
      reason: 'pricing_modified',
    },
    {
      name: 'modified line total',
      item: {
        ...signedItem,
        line_total: 154.42,
      },
      cost: resolvedCost,
      reason: 'pricing_modified',
    },
    {
      name: 'modified purchasing unit',
      item: {
        ...signedItem,
        quantity_unit: 'CS',
      },
      cost: resolvedCost,
      reason: 'pricing_modified',
    },
    {
      name: 'incorrect calculated unit',
      item: signedItem,
      cost: {
        ...resolvedCost,
        unit: 'oz',
      },
      reason: 'confirmed_cost_mismatch',
    },
    {
      name: 'incorrect calculated unit cost',
      item: signedItem,
      cost: {
        ...resolvedCost,
        unit_cost: 1.45,
      },
      reason: 'confirmed_cost_mismatch',
    },
  ];

  for (const scenario of rejectionCases) {
    const rejected = validateConfirmedInvoiceSource({
      item: scenario.item,
      resolvedCost: scenario.cost,
      restaurantId: 'restaurant-1',
      invoiceNumber: 'CTB-2111',
      documentFingerprint: DOCUMENT_FINGERPRINT,
      secret: SECRET,
      now: NOW,
    });

    assert.equal(
      rejected.accepted,
      false,
      scenario.name
    );

    assert.equal(
      rejected.reason,
      scenario.reason,
      scenario.name
    );

    assert.equal(
      rejected.evidence,
      null,
      scenario.name
    );
  }
});
