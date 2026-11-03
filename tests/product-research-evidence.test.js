
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateProductResearch,
} from '../lib/productResearchEvidence.js';

const product = {
  brand: 'Example Foods',
  sku: 'ABC-123',
  packageCount: 3,
  containerUnit: 'can',
};

const finding = {
  brand: 'Example Foods',
  sku: 'ABC-123',
  packageCount: 3,
  netQuantity: 104,
  netUnit: 'oz',
  sourceType: 'manufacturer',
  sourceUrl: 'https://example.com/product/abc123',
  evidenceText: 'Net weight 6 lb 8 oz per can',
};

test('matching product evidence is eligible for verification', () => {
  const result = evaluateProductResearch(product, finding);

  assert.equal(result.status, 'eligible_for_verification');
  assert.equal(result.conversion.fromUnit, 'can');
  assert.equal(result.conversion.toUnit, 'oz');
  assert.equal(result.conversion.factor, 104);
});

test('different product SKU requires review', () => {
  const result = evaluateProductResearch(product, {
    ...finding,
    sku: 'DIFFERENT-456',
  });

  assert.equal(result.status, 'needs_review');
});

test('different package count requires review', () => {
  const result = evaluateProductResearch(product, {
    ...finding,
    packageCount: 6,
  });

  assert.equal(result.status, 'needs_review');
});

test('missing net measurement requires review', () => {
  const result = evaluateProductResearch(product, {
    ...finding,
    netQuantity: null,
  });

  assert.equal(result.status, 'needs_review');
});

test('unattributed research requires review', () => {
  const result = evaluateProductResearch(product, {
    ...finding,
    sourceUrl: null,
  });

  assert.equal(result.status, 'needs_review');
});

test('missing product identity requires review', () => {
  const result = evaluateProductResearch({
    ...product,
    sku: null,
  }, finding);

  assert.equal(result.status, 'needs_review');
});


test('claimed SKU cross-reference requires verification', () => {
  const product = {
    brand: 'Example Foods',
    sku: 'DIST74135',
    packageCount: 3,
    containerUnit: 'can',
  };

  const finding = {
    brand: 'Example Foods',
    sku: 'MFG123',
    packageCount: 3,
    netQuantity: 104,
    netUnit: 'oz',
    sourceType: 'manufacturer',
    sourceUrl: 'https://example.com/spec',
    evidenceText: '104 oz per can',
    skuCrossReference: {
      supplierSku: 'DIST74135',
      manufacturerSku: 'MFG123',
    },
  };

  const result = evaluateProductResearch(product, finding);

  assert.equal(result.status, 'needs_review');
  assert.equal(result.conversion, null);
  assert.equal(
    result.reason,
    'SKU cross-reference requires source verification'
  );
});

test('incorrect SKU cross-reference is rejected', () => {
  const product = {
    brand: 'Example Foods',
    sku: 'DIST74135',
    packageCount: 3,
    containerUnit: 'can',
  };

  const finding = {
    brand: 'Example Foods',
    sku: 'MFG123',
    packageCount: 3,
    netQuantity: 104,
    netUnit: 'oz',
    sourceType: 'manufacturer',
    sourceUrl: 'https://example.com/spec',
    evidenceText: '104 oz per can',
    skuCrossReference: {
      supplierSku: 'DIFFERENT',
      manufacturerSku: 'MFG123',
    },
  };

  const result = evaluateProductResearch(product, finding);

  assert.equal(result.status, 'needs_review');
  assert.equal(result.conversion, null);
  assert.equal(result.reason, 'Product SKU does not match');
});
