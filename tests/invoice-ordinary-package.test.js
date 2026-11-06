import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOrdinaryInvoicePackage,
  resolveOrdinaryInvoicePackage,
} from '../lib/invoiceOrdinaryPackage.js';

import {
  calculateVerifiedInvoiceCost,
} from '../lib/verifiedInvoiceCosting.js';

function invoiceItem(overrides = {}) {
  return {
    item_name: 'Butter',
    pack_size_raw: '6/5 LB',
    pack: 6,
    size: 5,
    size_unit: 'lb',
    quantity_shipped: 1,
    line_total: 90,
    invoice_price: 90,
    catch_weight: false,
    ...overrides,
  };
}

test('parses documented six-by-five-pound cases', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('6/5 LB'),
    {
      pack: 6,
      size: 5,
      size_unit: 'lb',
    }
  );
});

test('parses documented gallon packages', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('4/1 GAL'),
    {
      pack: 4,
      size: 1,
      size_unit: 'gal',
    }
  );
});

test('parses documented ounce packages', () => {
  assert.deepEqual(
    parseOrdinaryInvoicePackage('12/12 OZ'),
    {
      pack: 12,
      size: 12,
      size_unit: 'oz',
    }
  );
});

test('accepts matching invoice package descriptions', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem()
  );

  assert.equal(result.quantity, 30);
  assert.equal(result.unit, 'lb');
  assert.equal(result.unit_cost, 3);
  assert.equal(
    result.pricingStatus,
    'invoice_document_consistent'
  );
});

test('rejects incorrect extracted package sizes', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      size: 50,
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'package_discrepancy'
  );
});

test('rejects incorrect extracted package counts', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack: 60,
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'package_discrepancy'
  );
});

test('rejects incorrect extracted physical units', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      size_unit: 'oz',
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'package_discrepancy'
  );
});

test('missing original package text requires verification', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack_size_raw: null,
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('unsupported package descriptions require verification', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack_size_raw: 'MIXED CASE',
    })
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('invoice totals remain available after a discrepancy', () => {
  const item = invoiceItem({
    pack: 60,
  });

  const packageResult = resolveOrdinaryInvoicePackage(item);
  const cost = calculateVerifiedInvoiceCost(item);

  assert.equal(packageResult.status, 'package_discrepancy');
  assert.equal(cost.unit_cost, null);
  assert.equal(item.line_total, 90);
});

test('verified numbered-can behavior remains unchanged', () => {
  const result = calculateVerifiedInvoiceCost({
    pack_size_raw: '3/#10 CAN',
    quantity_shipped: 1,
    line_total: 50.78,
    invoice_price: 50.78,
    catch_weight: false,
  });

  assert.equal(result.quantity, 3);
  assert.equal(result.unit, 'can');
  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('unsupported package text cannot create a unit cost', () => {
  const result = calculateVerifiedInvoiceCost(
    invoiceItem({
      pack_size_raw: '6/5 LB + BONUS PACK',
    })
  );

  assert.equal(result.unit_cost, null);
});

test('ordinary package parser does not reinterpret numbered cans', () => {
  assert.equal(
    parseOrdinaryInvoicePackage('3/#10 CAN'),
    null
  );
});