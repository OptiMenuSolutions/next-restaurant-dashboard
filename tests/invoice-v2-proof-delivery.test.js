
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deliverInvoiceV2Proofs,
} from '../lib/invoiceV2ProofDelivery.js';

import {
  verifyInvoiceSourceProof,
} from '../lib/invoiceSourceProof.js';

const SECRET =
  'synthetic-v2-delivery-secret-2026-testing';

const FINGERPRINT = 'a'.repeat(64);

const HEADER =
  '<tr><td>Item Number</td><td>Ordered</td>' +
  '<td>Shipped</td><td>Pack</td><td>Size</td>' +
  '<td>Unit</td><td>Description</td>' +
  '<td>Price</td><td>Extension</td></tr>';

const BLEACH_ROW =
  '<tr><td>556332</td><td>1</td><td>1</td>' +
  '<td>6</td><td>1 GA</td><td></td>' +
  '<td>BLEACH GERMICIDAL</td>' +
  '<td>21.0000</td><td>21.00</td></tr>';

const STEAK_ROW =
  '<tr><td>1030906</td><td>1</td><td>1</td>' +
  '<td>22</td><td>7 OZ</td><td>LB</td>' +
  '<td>BEEF SKIRT STEAK 9.96</td>' +
  '<td>14.5000</td><td>144.42</td></tr>';

const OCR =
  `<table>${HEADER}${BLEACH_ROW}${STEAK_ROW}</table>`;

function fixture() {
  const bleach = {
    item_name_raw: 'BLEACH GERMICIDAL',
    is_food: false,
    quantity_shipped: 1,
    invoice_price: 21,
    line_total: 21,
    catch_weight: false,
  };

  const steak = {
    item_name_raw: 'BEEF SKIRT STEAK 9.96',
    is_food: true,
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
      row_text: STEAK_ROW,
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

  return {
    bleach,
    steak,
    returnedSteak: {
      ...steak,
      _id: 'item_0',
      match_status: 'auto',
    },
  };
}

test('V2 delivery preserves identity after non-food filtering', () => {
  const { bleach, steak, returnedSteak } = fixture();

  const result = deliverInvoiceV2Proofs({
    allRaw: [bleach, steak],
    foodItems: [steak],
    lineItemsWithMatches: [returnedSteak],
    ocrText: OCR,
    restaurantId: 'restaurant-1',
    invoiceNumber: 'TEST-1001',
    documentFingerprint: FINGERPRINT,
    secret: SECRET,
  });

  assert.equal(result.eligible, 1);
  assert.equal(result.signed, 1);
  assert.equal(result.rejected, 0);

  assert.equal(
    typeof returnedSteak.invoice_source_proof,
    'string'
  );

  const verification = verifyInvoiceSourceProof({
    proof: returnedSteak.invoice_source_proof,
    restaurantId: 'restaurant-1',
    invoiceNumber: 'TEST-1001',
    documentFingerprint: FINGERPRINT,
    itemKey: 'item_0',
    item: returnedSteak,
    secret: SECRET,
  });

  assert.equal(verification.valid, true);
  assert.equal(verification.payload.version, 2);
  assert.equal(verification.payload.item_key, 'item_0');
  assert.equal(
    verification.payload.pricing.actual_weight,
    9.96
  );
});

test('V2 delivery rejects inconsistent source arithmetic', () => {
  const { bleach, steak, returnedSteak } = fixture();

  steak.line_total = 150;
  returnedSteak.line_total = 150;

  const result = deliverInvoiceV2Proofs({
    allRaw: [bleach, steak],
    foodItems: [steak],
    lineItemsWithMatches: [returnedSteak],
    ocrText: OCR,
    restaurantId: 'restaurant-1',
    invoiceNumber: 'TEST-1001',
    documentFingerprint: FINGERPRINT,
    secret: SECRET,
  });

  assert.equal(result.signed, 0);
  assert.equal(returnedSteak.invoice_source_proof, undefined);
});


test('V2 delivery rejects duplicate claims against the same OCR row', () => {
  const { steak } = fixture();

  // Simulate an AI extraction that incorrectly
  // duplicates the same supplier invoice row.
  const first = {
    ...steak,
    source_evidence: {
      ...steak.source_evidence,
    },
  };

  const second = {
    ...steak,
    source_evidence: {
      ...steak.source_evidence,
    },
  };

  const returnedFirst = {
    ...first,
    _id: 'item_0',
  };

  const returnedSecond = {
    ...second,
    _id: 'item_1',
  };

  const result = deliverInvoiceV2Proofs({
    allRaw: [first, second],
    foodItems: [first, second],
    lineItemsWithMatches: [
      returnedFirst,
      returnedSecond,
    ],
    ocrText: OCR,
    restaurantId: 'restaurant-1',
    invoiceNumber: 'TEST-1001',
    documentFingerprint: FINGERPRINT,
    secret: SECRET,
  });

  assert.equal(result.eligible, 0);
  assert.equal(result.signed, 0);

  assert.equal(
    returnedFirst.invoice_source_proof,
    undefined
  );

  assert.equal(
    returnedSecond.invoice_source_proof,
    undefined
  );
});
