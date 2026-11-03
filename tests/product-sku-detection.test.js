
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectSkuCrossReference,
} from '../lib/productIdentityVerification.js';

const document = (text) => ({
  origin: 'anthropic_web_fetch',
  text,
});

const detect = (text, overrides = {}) =>
  detectSkuCrossReference({
    supplierSku: 'SUP456',
    manufacturerSku: 'MFG123',
    sourceDocument: document(text),
    ...overrides,
  });

test('detects explicitly labeled SKU relationship', () => {
  const result = detect(
    'Supplier SKU: SUP456 | Manufacturer SKU: MFG123'
  );

  assert.equal(result.status, 'candidate_relationship_found');
  assert.equal(result.relationshipDetected, true);
  assert.match(result.evidenceText, /SUP456/);
  assert.match(result.evidenceText, /MFG123/);
  assert.equal(result.conversionApproved, false);
});

test('rejects identifiers on separate lines', () => {
  const result = detect(
    'Supplier SKU: SUP456\nManufacturer SKU: MFG123'
  );

  assert.equal(result.relationshipDetected, false);
});

test('rejects unlabeled identifiers', () => {
  const result = detect('SUP456 MFG123');

  assert.equal(result.relationshipDetected, false);
});

test('rejects partial identifier matches', () => {
  const result = detect(
    'Supplier SKU: SUP4567 | Manufacturer SKU: MFG123'
  );

  assert.equal(result.relationshipDetected, false);
});

test('rejects duplicate relationship records', () => {
  const line =
    'Supplier SKU: SUP456 | Manufacturer SKU: MFG123';

  const result = detect(`${line}\n${line}`);

  assert.equal(result.relationshipDetected, false);
});

test('rejects identical supplier and manufacturer SKUs', () => {
  const result = detect(
    'Supplier SKU: SUP456 | Manufacturer SKU: SUP456',
    { manufacturerSku: 'SUP456' }
  );

  assert.equal(result.relationshipDetected, false);
});

test('rejects Claude summary as source evidence', () => {
  const result = detect(
    'Supplier SKU: SUP456 | Manufacturer SKU: MFG123',
    {
      sourceDocument: {
        origin: 'claude_summary',
        text:
          'Supplier SKU: SUP456 | Manufacturer SKU: MFG123',
      },
    }
  );

  assert.equal(result.relationshipDetected, false);
});

test('never approves conversion from detected relationship', () => {
  const result = detect(
    'Supplier SKU: SUP456 | Manufacturer SKU: MFG123'
  );

  assert.equal(result.relationshipDetected, true);
  assert.equal(result.conversionApproved, false);
  assert.notEqual(result.relationshipSupported, true);
});


test('rejects reversed supplier and manufacturer SKU assignments', () => {
  const result = detect(
    'Supplier SKU: MFG123 | Manufacturer SKU: SUP456'
  );

  assert.equal(result.relationshipDetected, false);
  assert.equal(result.conversionApproved, false);
});


test('detects manufacturer SKU listed before supplier SKU', () => {
  const result = detect(
    'Manufacturer SKU: MFG123 | Supplier SKU: SUP456'
  );

  assert.equal(result.status, 'candidate_relationship_found');
  assert.equal(result.relationshipDetected, true);
  assert.equal(result.conversionApproved, false);
});
