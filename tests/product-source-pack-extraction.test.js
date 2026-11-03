
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractSourcePackSpecification,
  validateSourcePackMeasurement,
} from '../lib/productSourceVerification.js';

test('extracts Knouse package from separate lines', () => {
  const result = extractSourcePackSpecification(`
# Strawberry Glaze - 120 oz.
Product Code:
FFPFR6030LKL01
Pack Size:

6/ 120 oz.
`);

  assert.equal(result.status, 'extracted');

  assert.deepEqual(result.specification.parsed, {
    packageCount: 6,
    netQuantity: 120,
    netUnit: 'oz',
    measurementScope: 'per_container',
  });
});

test('extracts inline package specification', () => {
  const result = extractSourcePackSpecification(
    'Pack Size: 3/96 fl oz'
  );

  assert.equal(result.status, 'extracted');
  assert.equal(result.specification.parsed.packageCount, 3);
  assert.equal(result.specification.parsed.netUnit, 'fl oz');
});

test('rejects missing package specification', () => {
  const result = extractSourcePackSpecification(
    'Product Code: ABC123'
  );

  assert.equal(result.status, 'needs_review');
});

test('rejects conflicting package specifications', () => {
  const result = extractSourcePackSpecification(`
Pack Size: 6/120 oz
Case Pack: 3/96 oz
`);

  assert.equal(result.status, 'needs_review');
  assert.match(result.reason, /conflicting/i);
});

test('rejects ambiguous numbered can designation', () => {
  const result = extractSourcePackSpecification(
    'Pack Size: 3/#10 CAN'
  );

  assert.equal(result.status, 'needs_review');
});

test('rejects malformed labeled specifications', () => {
  const result = extractSourcePackSpecification(`
Pack Size: unknown
Case Pack: 6/120 oz
`);

  assert.equal(result.status, 'needs_review');
});

test('rejects a measurement without a package label', () => {
  const result = extractSourcePackSpecification(
    'Net Weight: 120 oz'
  );

  assert.equal(result.status, 'needs_review');
});

test('extracted source rejects Claude unit mismatch', () => {
  const extracted = extractSourcePackSpecification(
    'Pack Size: 6/120 oz'
  );

  const result = validateSourcePackMeasurement(
    {
      quantity: 120,
      unit: 'fl oz',
      scope: 'per_container',
    },
    6,
    extracted.specification.raw
  );

  assert.equal(result.matches, false);
});

test('extracted source rejects Keystone package count', () => {
  const extracted = extractSourcePackSpecification(
    'Pack Size: 6/120 oz'
  );

  const result = validateSourcePackMeasurement(
    {
      quantity: 120,
      unit: 'oz',
      scope: 'per_container',
    },
    3,
    extracted.specification.raw
  );

  assert.equal(result.matches, false);
});
