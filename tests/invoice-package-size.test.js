
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseNumberedCanPack,
} from '../lib/invoicePackageSize.js';

import {
  calculateInvoiceLineValues,
} from '../lib/invoiceLineCalculations.js';

import {
  convertToStandardUnit,
} from '../lib/standardizedUnits.js';

test('3/#10 CAN means three cans, not thirty', () => {
  const result = parseNumberedCanPack('3/#10 CAN');

  assert.deepEqual(result, {
    pack: 3,
    size: 1,
    size_unit: 'can',
    can_designation: 10,
  });

  const shippedCases = 1;
  const invoiceTotal = 50.78;

  assert.equal(
    shippedCases * result.pack * result.size,
    3
  );

  assert.ok(
    Math.abs(invoiceTotal / 3 - 16.9266666667) < 0.000001
  );
});

test('handles other numbered-can configurations', () => {
  assert.equal(parseNumberedCanPack('6 #10').pack, 6);
  assert.equal(parseNumberedCanPack('3 / # 10 CANS').pack, 3);
  assert.equal(parseNumberedCanPack('6/#2 CAN').pack, 6);
});

test('does not reinterpret ordinary package sizes', () => {
  assert.equal(parseNumberedCanPack('6/5 LB'), null);
  assert.equal(parseNumberedCanPack('4/1 GAL'), null);
  assert.equal(parseNumberedCanPack('12/12 OZ'), null);
  assert.equal(parseNumberedCanPack(''), null);
});


test('invoice saving calculates numbered cans correctly', () => {
  const result = calculateInvoiceLineValues({
    item_name: 'Glaze Strawberry',
    pack_size_raw: '3/#10 CAN',
    quantity_shipped: 1,
    pack: 3,
    size: 10, // Simulate incorrect AI extraction.
    size_unit: 'can',
    invoice_price: 50.78,
    line_total: 50.78,
    catch_weight: false,
  });

  assert.equal(result.quantity, 3);
  assert.equal(result.unit, 'can');
  assert.ok(
    Math.abs(result.unit_cost - 50.78 / 3) < 0.000001
  );
});

test('ordinary case-packed weight remains unchanged', () => {
  const result = calculateInvoiceLineValues({
    item_name: 'Butter',
    pack_size_raw: '6/5 LB',
    quantity_shipped: 1,
    pack: 6,
    size: 5,
    size_unit: 'lb',
    invoice_price: 94.68,
    line_total: 94.68,
    catch_weight: false,
  });

  assert.equal(result.quantity, 30);
  assert.equal(result.unit, 'lb');
  assert.ok(
    Math.abs(result.unit_cost - 3.156) < 0.000001
  );
});

test('can capacity is not assumed without product evidence', () => {
  const result = convertToStandardUnit(
    1,
    'can',
    'Strawberry Topping'
  );

  assert.equal(result.success, false);
});