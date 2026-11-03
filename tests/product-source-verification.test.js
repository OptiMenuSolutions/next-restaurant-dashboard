
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  verifyProductSourceEvidence,
} from '../lib/productSourceVerification.js';

const url = 'https://example.com/product';

const evidence = {
  source: { url },
  identity: {
    manufacturerSku: 'ABC123',
    supplierSku: null,
  },
  package: {
    expectedCount: 6,
    reportedCount: 6,
    matches: true,
  },
  identityMatches: true,
  measurement: {
    quantity: 120,
    unit: 'oz',
    scope: 'per_container',
  },
};

const recordText = [
  'Product Code ABC123',
  'Pack Size 6/120 oz',
  'Net Weight 120 oz per container',
].join('\n');

const document = {
  origin: 'original_document',
  url,
  text: recordText,
  productRecord: {
    text: recordText,
    identifier: 'ABC123',
    packageCount: 6,
    netQuantity: 120,
    netUnit: 'oz',
    measurementScope: 'per_container',
  },
  claims: {
    productIdentifier: 'Product Code ABC123',
    packageCount: 'Pack Size 6/120 oz',
    netMeasurement: 'Net Weight 120 oz per container',
  },
};

test('source excerpts present still cannot approve', () => {
  const result = verifyProductSourceEvidence(
    evidence,
    document
  );

  assert.equal(result.status, 'source_evidence_present');
  assert.equal(
    result.verificationStatus,
    'pending_independent_validation'
  );
  assert.equal(result.conversionApproved, false);
});

test('Claude summary is not original source evidence', () => {
  const result = verifyProductSourceEvidence(
    evidence,
    {
      ...document,
      origin: 'claude_summary',
    }
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(result.conversionApproved, false);
});

test('missing original document requires review', () => {
  const result = verifyProductSourceEvidence(
    evidence,
    null
  );

  assert.equal(result.status, 'needs_review');
});

test('source URL mismatch requires review', () => {
  const result = verifyProductSourceEvidence(
    evidence,
    {
      ...document,
      url: 'https://example.com/other',
    }
  );

  assert.equal(result.status, 'needs_review');
});

test('package mismatch requires review', () => {
  const result = verifyProductSourceEvidence(
    {
      ...evidence,
      package: {
        expectedCount: 3,
        reportedCount: 6,
        matches: false,
      },
    },
    document
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(result.conversionApproved, false);
});

test('missing measurement excerpt requires review', () => {
  const result = verifyProductSourceEvidence(
    evidence,
    {
      ...document,
      claims: {
        ...document.claims,
        netMeasurement: 'Net Weight 999 oz',
      },
    }
  );

  assert.equal(result.status, 'needs_review');
});

test('missing product identifier excerpt requires review', () => {
  const result = verifyProductSourceEvidence(
    evidence,
    {
      ...document,
      claims: {
        ...document.claims,
        productIdentifier: null,
      },
    }
  );

  assert.equal(result.status, 'needs_review');
});


test('different product identifier requires review', () => {
  const result = verifyProductSourceEvidence(
    evidence,
    {
      ...document,
      productRecord: {
        ...document.productRecord,
        identifier: 'XYZ999',
      },
    }
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(result.conversionApproved, false);
});

test('different package count requires review', () => {
  const result = verifyProductSourceEvidence(
    evidence,
    {
      ...document,
      productRecord: {
        ...document.productRecord,
        packageCount: 3,
      },
    }
  );

  assert.equal(result.status, 'needs_review');
});

test('different net measurement requires review', () => {
  const result = verifyProductSourceEvidence(
    evidence,
    {
      ...document,
      productRecord: {
        ...document.productRecord,
        netQuantity: 96,
      },
    }
  );

  assert.equal(result.status, 'needs_review');
});

test('excerpts from different product records are rejected', () => {
  const result = verifyProductSourceEvidence(
    evidence,
    {
      ...document,
      text: [
        'Product Code ABC123',
        'Pack Size 6/120 oz',
        'Product Code XYZ999',
        'Net Weight 120 oz per container',
      ].join('\n'),
      productRecord: {
        ...document.productRecord,
        text: [
          'Product Code ABC123',
          'Pack Size 6/120 oz',
        ].join('\n'),
      },
    }
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(result.conversionApproved, false);
});
