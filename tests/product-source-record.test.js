
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractProductSourceRecord,
} from '../lib/productSourceVerification.js';

const knouseDocument = `
# Strawberry Glaze - 120 oz.

UPC:
2850030063

Product Code:
FFPFR6030LKL01

GTIN Case:
10028500300632

Pack Size:
6/ 120 oz.

## Nutrition
Serving information
`;

test('finds Knouse product identifier and package', () => {
  const result = extractProductSourceRecord(
    knouseDocument,
    'FFPFR6030LKL01'
  );

  assert.equal(result.status, 'record_found');
  assert.equal(
    result.record.packageSpecification.parsed.packageCount,
    6
  );
  assert.equal(
    result.record.packageSpecification.parsed.netQuantity,
    120
  );
  assert.equal(
    result.record.packageSpecification.parsed.netUnit,
    'oz'
  );
});

test('rejects unknown product identifier', () => {
  const result = extractProductSourceRecord(
    knouseDocument,
    'UNKNOWN123'
  );

  assert.equal(result.status, 'needs_review');
});

test('rejects identifier and package from different sections', () => {
  const result = extractProductSourceRecord(`
# Product A
Product Code:
ABC123

# Product B
Pack Size:
6/120 oz
`, 'ABC123');

  assert.equal(result.status, 'needs_review');
});

test('finds correct product in multiproduct document', () => {
  const result = extractProductSourceRecord(`
# Product A
Product Code:
ABC123
Pack Size:
6/120 oz

# Product B
Product Code:
XYZ999
Pack Size:
3/96 oz
`, 'XYZ999');

  assert.equal(result.status, 'record_found');
  assert.equal(
    result.record.packageSpecification.parsed.packageCount,
    3
  );
  assert.equal(
    result.record.packageSpecification.parsed.netQuantity,
    96
  );
});

test('rejects duplicate matching product sections', () => {
  const result = extractProductSourceRecord(`
# Product A
Product Code:
ABC123
Pack Size:
6/120 oz

# Product A Duplicate
Product Code:
ABC123
Pack Size:
3/96 oz
`, 'ABC123');

  assert.equal(result.status, 'needs_review');
});

test('rejects document without product headings', () => {
  const result = extractProductSourceRecord(
    'Product Code ABC123\nPack Size: 6/120 oz',
    'ABC123'
  );

  assert.equal(result.status, 'needs_review');
});

test('rejects ambiguous package within matching section', () => {
  const result = extractProductSourceRecord(`
# Product A
Product Code:
ABC123
Pack Size: 6/120 oz
Case Pack: 3/96 oz
`, 'ABC123');

  assert.equal(result.status, 'needs_review');
});
