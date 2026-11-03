
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  verifySkuCrossReference,
} from '../lib/productIdentityVerification.js';

const sourceDocument = (text, sourceType = 'distributor') => ({
  origin: 'anthropic_web_fetch',
  sourceType,
  text,
  attribution: {
    publisher: 'Example Distributor',
    publisherType: sourceType,
    verificationStatus: 'verified',
  },
});

test('does not trust labeled SKU relationship without established authority', () => {
  const result = verifySkuCrossReference({
    supplierSku: 'SUP456',
    manufacturerSku: 'MFG123',
    sourceDocument: sourceDocument(
      'Supplier SKU: SUP456 | Manufacturer SKU: MFG123'
    ),
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.relationshipSupported, false);
  assert.equal(result.evidenceText, undefined);
  assert.equal(result.conversionApproved, false);
});

test('rejects identifiers on unrelated lines', () => {
  const result = verifySkuCrossReference({
    supplierSku: 'SUP456',
    manufacturerSku: 'MFG123',
    sourceDocument: sourceDocument(
      'Supplier SKU: SUP456\nManufacturer SKU: MFG123'
    ),
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.relationshipSupported, false);
  assert.equal(result.conversionApproved, false);
});

test('rejects unlabeled identifiers', () => {
  const result = verifySkuCrossReference({
    supplierSku: 'SUP456',
    manufacturerSku: 'MFG123',
    sourceDocument: sourceDocument(
      'SUP456 MFG123'
    ),
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.relationshipSupported, false);
  assert.equal(result.conversionApproved, false);
});

test('rejects manufacturer-only source attribution', () => {
  const result = verifySkuCrossReference({
    supplierSku: 'SUP456',
    manufacturerSku: 'MFG123',
    sourceDocument: sourceDocument(
      'Supplier SKU: SUP456 | Manufacturer SKU: MFG123',
      'manufacturer'
    ),
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.relationshipSupported, false);
  assert.equal(result.conversionApproved, false);
});

test('rejects Claude-only evidence', () => {
  const result = verifySkuCrossReference({
    supplierSku: 'SUP456',
    manufacturerSku: 'MFG123',
    sourceDocument: {
      origin: 'claude_summary',
      sourceType: 'distributor',
      text: 'Supplier SKU: SUP456 | Manufacturer SKU: MFG123',
    },
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.relationshipSupported, false);
  assert.equal(result.conversionApproved, false);
});

test('rejects duplicate relationship records', () => {
  const result = verifySkuCrossReference({
    supplierSku: 'SUP456',
    manufacturerSku: 'MFG123',
    sourceDocument: sourceDocument(
      'Supplier SKU: SUP456 | Manufacturer SKU: MFG123\n' +
      'Supplier SKU: SUP456 | Manufacturer SKU: MFG123'
    ),
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.relationshipSupported, false);
  assert.equal(result.conversionApproved, false);
});

test('rejects partial SKU matches', () => {
  const result = verifySkuCrossReference({
    supplierSku: 'SUP456',
    manufacturerSku: 'MFG123',
    sourceDocument: sourceDocument(
      'Supplier SKU: SUP4567 | Manufacturer SKU: MFG123'
    ),
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.relationshipSupported, false);
  assert.equal(result.conversionApproved, false);
});

test('rejects caller-supplied distributor type without attribution', () => {
  const result = verifySkuCrossReference({
    supplierSku: 'SUP456',
    manufacturerSku: 'MFG123',
    sourceDocument: {
      origin: 'anthropic_web_fetch',
      sourceType: 'distributor',
      text: 'Supplier SKU: SUP456 | Manufacturer SKU: MFG123',
    },
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.relationshipSupported, false);
  assert.equal(result.conversionApproved, false);
});

test('rejects unverified distributor attribution', () => {
  const result = verifySkuCrossReference({
    supplierSku: 'SUP456',
    manufacturerSku: 'MFG123',
    sourceDocument: {
      origin: 'anthropic_web_fetch',
      text: 'Supplier SKU: SUP456 | Manufacturer SKU: MFG123',
      attribution: {
        publisher: 'Example Distributor',
        publisherType: 'distributor',
        verificationStatus: 'unverified',
      },
    },
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.relationshipSupported, false);
  assert.equal(result.conversionApproved, false);
});

test('caller cannot fabricate verified distributor authority', () => {
  const result = verifySkuCrossReference({
    supplierSku: 'SUP456',
    manufacturerSku: 'MFG123',
    sourceDocument: {
      origin: 'anthropic_web_fetch',
      url: 'https://example.com/product',
      sourceType: 'distributor',
      text: 'Supplier SKU: SUP456 | Manufacturer SKU: MFG123',
      attribution: {
        publisher: 'Example Distributor',
        publisherType: 'distributor',
        verificationStatus: 'verified',
      },
    },
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.relationshipSupported, false);
  assert.equal(result.conversionApproved, false);
});
