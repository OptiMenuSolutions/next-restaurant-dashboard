
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateVerifiedInvoiceCost,
} from '../lib/verifiedInvoiceCosting.js';

const item = {
  pack_size_raw: '3/#10 CAN',
  quantity_shipped: 1,
  line_total: 50.78,
  invoice_price: 50.78,
};

const verified = {
  conversionApproved: true,
  verificationStatus: 'verified',
  conversion: {
    fromUnit: 'can',
    toUnit: 'oz',
    factor: 104,
    scope: 'per_container',
    basis: 'authenticated_supplier_record',
  },
};

test('unverified numbered cans cannot set a weight price', () => {
  const result = calculateVerifiedInvoiceCost(item);

  assert.equal(result.quantity, 3);
  assert.equal(result.unit, 'can');
  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('verified conversion calculates correct case cost', () => {
  const result = calculateVerifiedInvoiceCost(item, verified);

  assert.equal(result.quantity, 312);
  assert.equal(result.unit, 'oz');
  assert.ok(
    Math.abs(result.unit_cost - 50.78 / 312) < 1e-10
  );
});

test('client-style approval without verified status fails', () => {
  const result = calculateVerifiedInvoiceCost(item, {
    ...verified,
    verificationStatus: 'unverified',
  });

  assert.equal(result.unit_cost, null);
});

test('incorrect conversion basis cannot update cost', () => {
  const result = calculateVerifiedInvoiceCost(item, {
    ...verified,
    conversion: {
      ...verified.conversion,
      basis: 'claude_research',
    },
  });

  assert.equal(result.unit_cost, null);
});

test('missing package information cannot create an ingredient unit cost', () => {
  const result = calculateVerifiedInvoiceCost({
    item_name: 'Generic Case Product',
    pack_size_raw: null,
    quantity_shipped: 1,
    invoice_price: 100,
    line_total: 100,
    catch_weight: false,
  });

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('documented count-based cases calculate ingredient costs', () => {
  const result = calculateVerifiedInvoiceCost({
    item_name: 'Generic Count Product',
    pack_size_raw: '300 CT',
    quantity_shipped: 1,
    invoice_price: 100,
    line_total: 100,
    catch_weight: false,
  });

  assert.equal(result.quantity, 300);
  assert.equal(result.unit, 'each');

  assert.ok(
    Math.abs(result.unit_cost - 100 / 300) < 1e-10
  );

  assert.equal(
    result.pricingStatus,
    'invoice_document_consistent'
  );
});

test('unsupported package information cannot create ingredient costs', () => {
  const result = calculateVerifiedInvoiceCost({
    item_name: 'Generic Case Product',
    pack_size_raw: 'MIXED CASE',
    quantity_shipped: 1,
    invoice_price: 100,
    line_total: 100,
    catch_weight: false,
  });

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('catch-weight products retain their existing calculation', () => {
  const result = calculateVerifiedInvoiceCost({
    item_name: 'Generic Catch Weight Product',
    pack_size_raw: null,
    quantity_shipped: 1,
    actual_weight: 20,
    invoice_price: 100,
    line_total: 100,
    catch_weight: true,
  });

  assert.equal(result.quantity, 20);
  assert.equal(result.unit, 'lb');
  assert.equal(result.unit_cost, 5);
});