import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInvoicePurchasePricing,
} from '../lib/invoicePurchasePricing.js';

test('preserves documented case purchase pricing', () => {
  const result = buildInvoicePurchasePricing(
    {
      quantity_shipped: 1,
      quantity_unit: 'CS',
      invoice_price: 100,
      line_total: 100,
      pack_size_raw: '300 CT',
      catch_weight: false,
    },
    {
      quantity: 300,
      unit: 'each',
      unit_cost: 100 / 300,
      pricingStatus: 'invoice_document_consistent',
    }
  );

  assert.equal(result.purchase_quantity, 1);
  assert.equal(result.purchase_unit, 'case');
  assert.equal(result.purchase_unit_price, 100);
  assert.equal(result.package_quantity, 300);
  assert.equal(result.package_unit, 'each');
  assert.equal(result.package_description, '300 CT');
});

test('preserves weight-based case packaging', () => {
  const result = buildInvoicePurchasePricing(
    {
      quantity_shipped: 2,
      quantity_unit: 'CASE',
      invoice_price: 40,
      line_total: 80,
      pack_size_raw: '2/5 LB',
      catch_weight: false,
    },
    {
      quantity: 20,
      unit: 'lb',
      unit_cost: 4,
      pricingStatus: 'invoice_document_consistent',
    }
  );

  assert.equal(result.purchase_quantity, 2);
  assert.equal(result.purchase_unit, 'case');
  assert.equal(result.purchase_unit_price, 40);
  assert.equal(result.package_quantity, 10);
  assert.equal(result.package_unit, 'lb');
});

test('does not invent unsupported package quantities', () => {
  const result = buildInvoicePurchasePricing(
    {
      quantity_shipped: 1,
      quantity_unit: 'CS',
      invoice_price: 100,
      line_total: 100,
      pack_size_raw: 'MIXED CASE',
      catch_weight: false,
    },
    {
      unit_cost: null,
      pricingStatus: 'needs_package_verification',
    }
  );

  assert.equal(result.purchase_quantity, 1);
  assert.equal(result.purchase_unit_price, 100);
  assert.equal(result.package_quantity, null);
  assert.equal(result.package_unit, null);
});

test('does not mislabel catch-weight prices as case prices', () => {
  const result = buildInvoicePurchasePricing(
    {
      quantity_shipped: 2,
      quantity_unit: 'CS',
      invoice_price: 4,
      line_total: 80,
      actual_weight: 20,
      catch_weight: true,
    },
    {
      quantity: 20,
      unit: 'lb',
      unit_cost: 4,
      pricingStatus: 'calculated',
    }
  );

  assert.equal(result.purchase_quantity, 2);
  assert.equal(result.purchase_unit, 'case');
  assert.equal(result.purchase_unit_price, null);
  assert.equal(result.package_quantity, null);
});

test('rejects inconsistent purchase arithmetic', () => {
  const result = buildInvoicePurchasePricing(
    {
      quantity_shipped: 2,
      quantity_unit: 'CASE',
      invoice_price: 40,
      line_total: 120,
      pack_size_raw: '12 CT',
    },
    {
      pricingStatus: 'invoice_document_consistent',
    }
  );

  assert.equal(result.purchase_unit_price, null);
});

test('does not infer numbered-can physical quantities', () => {
  const result = buildInvoicePurchasePricing(
    {
      quantity_shipped: 1,
      quantity_unit: 'CS',
      invoice_price: 50,
      line_total: 50,
      pack_size_raw: '3/#10 CAN',
    },
    {
      unit_cost: null,
      pricingStatus: 'needs_package_verification',
    }
  );

  assert.equal(result.purchase_quantity, 1);
  assert.equal(result.purchase_unit_price, 50);
  assert.equal(result.package_quantity, null);
  assert.equal(result.package_unit, null);
});