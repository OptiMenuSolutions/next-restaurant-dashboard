
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInvoiceEvidenceSigningCollection,
} from '../lib/invoiceEvidenceSigningCollection.js';

test('preserves original invoice positions after non-food filtering', () => {
  const bleach = {
    item_name_raw: 'BLEACH',
    is_food: false,
    line_total: 21,
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
  };

  const returnedSteak = {
    ...steak,
    _id: 'item_0',
    match_status: 'auto',
  };

  const collection =
    buildInvoiceEvidenceSigningCollection({
      allRaw: [bleach, steak],
      foodItems: [steak],
      lineItemsWithMatches: [returnedSteak],
    });

  assert.equal(collection.length, 2);

  assert.equal(collection[0]._id, 'source_0');

  // The steak remains at its original source
  // position despite becoming item_0 in the UI.
  assert.strictEqual(
    collection[1],
    returnedSteak
  );

  assert.equal(collection[1]._id, 'item_0');
});

test('rejects pricing modifications during matching', () => {
  const original = {
    item_name_raw: 'BEEF SKIRT STEAK',
    invoice_price: 14.5,
    line_total: 144.42,
  };

  assert.throws(
    () => buildInvoiceEvidenceSigningCollection({
      allRaw: [original],
      foodItems: [original],
      lineItemsWithMatches: [{
        ...original,
        _id: 'item_0',
        invoice_price: 15.5,
      }],
    }),
    /pricing changed/
  );
});
