import test from 'node:test';
import assert from 'node:assert/strict';

import {
  prepareInvoiceSourceEvidence,
  saveInvoiceSourceEvidence,
} from '../lib/invoiceSourceEvidenceStorage.js';

function savedLine(overrides = {}) {
  return {
    id: 'saved-line-1',
    invoice_id: 'invoice-1',
    restaurant_id: 'restaurant-1',
    ingredient_id: 'ingredient-1',
    item_name: 'Mustard Dijon Smooth',
    quantity: 4,
    unit: 'qt',
    unit_cost: 7.5,
    amount: 30,
    ...overrides,
  };
}

function confirmation(overrides = {}) {
  return {
    accepted: true,
    evidence: {
      source_type: 'structured_ocr_table',
      validation_status: 'source_table_consistent',
      proof_version: 1,
      invoice_number: 'CTB-2111',
      item_key: 'item_0',
      issued_at: 1794052800000,
      quantity: 4,
      unit: 'qt',
      unit_cost: 7.5,
      amount: 30,
    },
    ...overrides,
  };
}

function prepare(overrides = {}) {
  return prepareInvoiceSourceEvidence({
    savedLine: savedLine(),
    invoiceId: 'invoice-1',
    restaurantId: 'restaurant-1',
    confirmation: confirmation(),
    proof: 'authenticated.payload',
    ...overrides,
  });
}

test('valid saved invoice evidence is prepared', () => {
  const result = prepare();

  assert.equal(result.accepted, true);
  assert.equal(
    result.record.invoice_item_id,
    'saved-line-1'
  );
  assert.equal(result.record.invoice_id, 'invoice-1');
  assert.equal(
    result.record.restaurant_id,
    'restaurant-1'
  );
});

test('saved pricing is preserved in evidence', () => {
  const result = prepare();

  assert.equal(result.record.evidence.pricing.quantity, 4);
  assert.equal(result.record.evidence.pricing.unit, 'qt');
  assert.equal(
    result.record.evidence.pricing.unit_cost,
    7.5
  );
  assert.equal(result.record.evidence.pricing.amount, 30);
});

test('source fingerprint is generated', () => {
  const result = prepare();

  assert.match(
    result.record.source_fingerprint,
    /^[0-9a-f]{64}$/
  );
});

test('pricing fingerprint is generated', () => {
  const result = prepare();

  assert.match(
    result.record.pricing_fingerprint,
    /^[0-9a-f]{64}$/
  );
});

test('missing saved item identity is rejected', () => {
  const result = prepare({
    savedLine: savedLine({ id: null }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'missing_saved_identity');
});

test('cross-invoice evidence is rejected', () => {
  const result = prepare({
    savedLine: savedLine({
      invoice_id: 'different-invoice',
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'ownership_mismatch');
});

test('cross-restaurant evidence is rejected', () => {
  const result = prepare({
    savedLine: savedLine({
      restaurant_id: 'different-restaurant',
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'ownership_mismatch');
});

test('unauthenticated evidence is rejected', () => {
  const result = prepare({
    confirmation: confirmation({
      accepted: false,
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'unauthenticated_evidence');
});

test('missing source proof is rejected', () => {
  const result = prepare({
    proof: null,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'missing_source_proof');
});

test('modified saved quantity is rejected', () => {
  const result = prepare({
    savedLine: savedLine({
      quantity: 8,
      amount: 60,
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'saved_pricing_mismatch');
});

test('modified saved unit cost is rejected', () => {
  const result = prepare({
    savedLine: savedLine({
      unit_cost: 15,
      amount: 60,
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'saved_pricing_mismatch');
});

test('modified saved unit is rejected', () => {
  const result = prepare({
    savedLine: savedLine({
      unit: 'lb',
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'saved_pricing_mismatch');
});

test('invalid saved arithmetic is rejected', () => {
  const result = prepare({
    savedLine: savedLine({
      amount: 45,
    }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'invalid_saved_arithmetic');
});

test('valid evidence can be inserted', async () => {
  let inserted = null;

  const db = {
    from(table) {
      assert.equal(
        table,
        'invoice_supported_price_evidence'
      );

      return {
        async insert(record) {
          inserted = record;
          return { error: null };
        },
      };
    },
  };

  const result = await saveInvoiceSourceEvidence(
    db,
    prepare()
  );

  assert.equal(result.saved, true);
  assert.equal(
    inserted.invoice_item_id,
    'saved-line-1'
  );
});

test('database insertion errors are propagated', async () => {
  const db = {
    from() {
      return {
        async insert() {
          return {
            error: {
              message: 'Simulated database failure',
            },
          };
        },
      };
    },
  };

  await assert.rejects(
    saveInvoiceSourceEvidence(db, prepare()),
    /Simulated database failure/
  );
});

test('rejected evidence cannot be inserted', async () => {
  let called = false;

  const db = {
    from() {
      called = true;
      throw new Error('Database should not be called');
    },
  };

  const result = await saveInvoiceSourceEvidence(
    db,
    prepare({
      confirmation: confirmation({
        accepted: false,
      }),
    })
  );

  assert.equal(result.saved, false);
  assert.equal(called, false);
});