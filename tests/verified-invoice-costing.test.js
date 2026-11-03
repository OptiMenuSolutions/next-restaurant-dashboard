
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
