
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  verifyDirectSupplierProduct,
} from '../lib/productDirectSupplierVerification.js';

const URL = 'https://catalog.example.com/product/123';

const invoiceProduct = {
  name: 'Example Strawberry Glaze',
  supplier: 'Example Distributor',
  brand: 'Example Foods',
  sku: 'SUP456',
  packageCount: 3,
  packageSize: '3/#10 CAN',
  containerUnit: 'can',
};

const evidence = {
  source: { url: URL },
  identity: {
    supplierSku: 'SUP456',
    manufacturerSku: null,
  },
  package: {
    expectedCount: 3,
    reportedCount: 3,
    matches: true,
  },
  measurement: {
    quantity: 104,
    unit: 'oz',
    scope: 'per_container',
  },
};

const sourceDocument = {
  origin: 'anthropic_web_fetch',
  url: URL,
  text: [
    '# Example Strawberry Glaze',
    'Supplier SKU: SUP456',
    'Brand: Example Foods',
    'Pack Size: 3/104 oz.',
  ].join('\n'),
};

const trustedSuppliers = [{
  supplier: 'Example Distributor',
  hostname: 'catalog.example.com',
}];

const verify = (overrides = {}) =>
  verifyDirectSupplierProduct({
    invoiceProduct,
    evidence,
    sourceDocument,
    trustedSuppliers,
    ...overrides,
  });

test('approves matching authenticated supplier record', () => {
  const result = verify();

  assert.equal(result.status, 'verified');
  assert.equal(result.conversionApproved, true);
  assert.equal(result.conversion.factor, 104);
  assert.equal(result.conversion.toUnit, 'oz');
});

test('rejects unregistered supplier domain', () => {
  const result = verify({ trustedSuppliers: [] });

  assert.equal(result.conversionApproved, false);
});

test('rejects different supplier SKU', () => {
  const result = verify({
    sourceDocument: {
      ...sourceDocument,
      text: sourceDocument.text.replace(
        'SUP456', 'DIFFERENT'
      ),
    },
  });

  assert.equal(result.conversionApproved, false);
});

test('rejects mismatched source measurement', () => {
  const result = verify({
    sourceDocument: {
      ...sourceDocument,
      text: sourceDocument.text.replace(
        '3/104 oz.', '3/96 oz.'
      ),
    },
  });

  assert.equal(result.conversionApproved, false);
});

test('rejects mismatched brand', () => {
  const result = verify({
    sourceDocument: {
      ...sourceDocument,
      text: sourceDocument.text.replace(
        'Brand: Example Foods',
        'Brand: Different Foods'
      ),
    },
  });

  assert.equal(result.conversionApproved, false);
});

test('rejects unsupported case designation as measurement', () => {
  const result = verify({
    sourceDocument: {
      ...sourceDocument,
      text: sourceDocument.text.replace(
        '3/104 oz.', '3/#10 CAN'
      ),
    },
  });

  assert.equal(result.conversionApproved, false);
});
