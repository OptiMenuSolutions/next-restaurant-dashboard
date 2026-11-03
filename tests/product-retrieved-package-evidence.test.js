
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateRetrievedPackageEvidence,
} from '../lib/productSourceVerification.js';

const makeEvidence = (packageCount = 6) => ({
  identity: {
    manufacturerSku: 'MFG123',
  },
  package: {
    expectedCount: packageCount,
    matches: true,
  },
  measurement: {
    quantity: 120,
    unit: 'oz',
    scope: 'per_container',
  },
  source: {
    url: 'https://example.com/product',
  },
});

const sourceDocument = {
  origin: 'anthropic_web_fetch',
  url: 'https://example.com/product',
  text: [
    '# Example Product',
    'Manufacturer SKU: MFG123',
    'Pack Size: 6/120 oz.',
  ].join('\n'),
};

test('matching retrieved package remains unverified', () => {
  const result = evaluateRetrievedPackageEvidence(
    makeEvidence(),
    sourceDocument
  );

  assert.equal(result.status, 'package_evidence_found');
  assert.equal(result.packageEvidenceMatches, true);
  assert.equal(result.sourceSpecification, '6/120 oz.');
  assert.equal(result.verificationStatus, 'unverified');
  assert.equal(result.conversionApproved, false);
});

test('different invoice package count requires review', () => {
  const result = evaluateRetrievedPackageEvidence(
    makeEvidence(3),
    sourceDocument
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(result.packageEvidenceMatches, false);
  assert.equal(result.conversionApproved, false);
});

test('different source URL requires review', () => {
  const result = evaluateRetrievedPackageEvidence(
    makeEvidence(),
    {
      ...sourceDocument,
      url: 'https://example.com/another-product',
    }
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(result.packageEvidenceMatches, false);
});

test('Claude summary cannot substitute for retrieved text', () => {
  const result = evaluateRetrievedPackageEvidence(
    makeEvidence(),
    {
      ...sourceDocument,
      origin: 'claude_summary',
    }
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(result.packageEvidenceMatches, false);
});
