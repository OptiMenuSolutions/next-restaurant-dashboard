import test from 'node:test';
import assert from 'node:assert/strict';

import {
  safeInvoiceStandardPrice,
} from '../lib/safeInvoicePricing.js';

test('converts verified pounds to ounces', () => {
  const result = safeInvoiceStandardPrice(4, 'lb');

  assert.equal(result.unit, 'oz');
  assert.equal(result.price, 0.25);
});

test('converts fluid gallons to fluid ounces', () => {
  const result = safeInvoiceStandardPrice(128, 'gal');

  assert.equal(result.unit, 'fl oz');
  assert.equal(result.price, 1);
});

test('preserves prices already expressed per ounce', () => {
  const result = safeInvoiceStandardPrice(0.35, 'oz');

  assert.equal(result.unit, 'oz');
  assert.equal(result.price, 0.35);
});

test('rejects unsupported case conversions', () => {
  assert.equal(
    safeInvoiceStandardPrice(25, 'case'),
    null
  );

  assert.equal(
    safeInvoiceStandardPrice(25, 'cs'),
    null
  );
});

test('rejects unverified numbered cans', () => {
  assert.equal(
    safeInvoiceStandardPrice(16.93, 'can'),
    null
  );

  assert.equal(
    safeInvoiceStandardPrice(16.93, '#10 can'),
    null
  );
});

test('rejects missing and unknown units', () => {
  assert.equal(
    safeInvoiceStandardPrice(10, null),
    null
  );

  assert.equal(
    safeInvoiceStandardPrice(10, 'mystery'),
    null
  );
});

test('rejects invalid financial values', () => {
  assert.equal(
    safeInvoiceStandardPrice(NaN, 'lb'),
    null
  );

  assert.equal(
    safeInvoiceStandardPrice(-5, 'lb'),
    null
  );

  assert.equal(
    safeInvoiceStandardPrice(0, 'lb'),
    null
  );
});

test('preserves count-based pricing', () => {
  const result = safeInvoiceStandardPrice(2.5, 'each');

  assert.equal(result.unit, 'each');
  assert.equal(result.price, 2.5);
});

test('rejects unverified package descriptions', () => {
  assert.equal(
    safeInvoiceStandardPrice(50, '6/5 LB'),
    null
  );
});