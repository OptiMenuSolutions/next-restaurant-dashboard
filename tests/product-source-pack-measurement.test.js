
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSourcePackSpecification,
  validateSourcePackMeasurement,
} from '../lib/productSourceVerification.js';

test('parses actual Knouse pack specification', () => {
  assert.deepEqual(
    parseSourcePackSpecification('6/ 120 oz.'),
    {
      packageCount: 6,
      netQuantity: 120,
      netUnit: 'oz',
      measurementScope: 'per_container',
    }
  );
});

test('rejects Claude fluid-ounce interpretation', () => {
  const result = validateSourcePackMeasurement(
    {
      quantity: 120,
      unit: 'fl oz',
      scope: 'per_container',
    },
    6,
    '6/ 120 oz.'
  );

  assert.equal(result.matches, false);
  assert.match(result.reason, /measurement differs/i);
});

test('accepts exact reported weight measurement', () => {
  const result = validateSourcePackMeasurement(
    {
      quantity: 120,
      unit: 'oz',
      scope: 'per_container',
    },
    6,
    '6/ 120 oz.'
  );

  assert.equal(result.matches, true);
});

test('rejects Keystone invoice package count', () => {
  const result = validateSourcePackMeasurement(
    {
      quantity: 120,
      unit: 'oz',
      scope: 'per_container',
    },
    3,
    '6/ 120 oz.'
  );

  assert.equal(result.matches, false);
  assert.match(result.reason, /package count/i);
});

test('does not infer contents from #10 can designation', () => {
  assert.equal(
    parseSourcePackSpecification('3/#10 CAN'),
    null
  );
});

test('preserves explicit fluid-ounce measurements', () => {
  assert.deepEqual(
    parseSourcePackSpecification('3/96 fl oz'),
    {
      packageCount: 3,
      netQuantity: 96,
      netUnit: 'fl oz',
      measurementScope: 'per_container',
    }
  );
});

test('rejects case-total-only specifications', () => {
  assert.equal(
    parseSourcePackSpecification('Case total: 720 oz'),
    null
  );
});

test('rejects ambiguous package specifications', () => {
  assert.equal(
    parseSourcePackSpecification('6/#10 cans'),
    null
  );

  assert.equal(
    parseSourcePackSpecification('120 oz'),
    null
  );
});
