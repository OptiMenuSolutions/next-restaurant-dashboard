
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractProductEvidence,
} from '../lib/productEvidenceExtraction.js';

const invoiceProduct = {
  name: 'Generic Foodservice Product',
  sku: 'SUP456',
  packageCount: 6,
};

const research = {
  findings: {
    product_name: 'Generic Foodservice Product',
    brand: 'Example Brand',
    manufacturer_sku: 'MFG123',
    supplier_sku: 'SUP456',
    package_count: 6,
    net_quantity: 120,
    net_unit: 'oz',
    measurement_scope: 'per_container',
  },
};


test('retrieved distributor relationship is recorded but unverified', () => {
  const evidence = extractProductEvidence(
    invoiceProduct,
    research,
    {
      origin: 'anthropic_web_fetch',
      sourceType: 'distributor',
      text: 'Supplier SKU: SUP456 | Manufacturer SKU: MFG123',
      attribution: {
        publisher: 'Example Distributor',
        publisherType: 'distributor',
        verificationStatus: 'verified',
      },
    }
  );

  assert.equal(
    evidence.identityVerification.crossReferenceStatus,
    'needs_review'
  );

  assert.equal(
    evidence.identityVerification.crossReferenceEvidence,
    null
  );

  assert.equal(
    evidence.identityDetection.relationshipDetected,
    true
  );

  assert.match(
    evidence.identityDetection.evidenceText,
    /SUP456/
  );

  assert.equal(evidence.identityMatches, false);
  assert.equal(evidence.verificationStatus, 'unverified');
  assert.equal(evidence.conversionApproved, false);
});

test('unrelated SKU evidence does not establish relationship', () => {
  const evidence = extractProductEvidence(
    invoiceProduct,
    research,
    {
      origin: 'anthropic_web_fetch',
      sourceType: 'distributor',
      text: 'Supplier SKU: OTHER999 | Manufacturer SKU: MFG123',
      attribution: {
        publisher: 'Example Distributor',
        publisherType: 'distributor',
        verificationStatus: 'verified',
      },
    }
  );

  assert.equal(
    evidence.identityVerification.crossReferenceStatus,
    'needs_review'
  );

  assert.equal(
    evidence.identityVerification.crossReferenceEvidence,
    null
  );

  assert.equal(evidence.conversionApproved, false);
});


test('missing source preserves previous behavior', () => {
  const evidence = extractProductEvidence(
    invoiceProduct,
    research
  );

  assert.equal(
    evidence.identityVerification.crossReferenceStatus,
    'not_evaluated'
  );

  assert.equal(evidence.conversionApproved, false);
});

test('Claude summary cannot establish SKU relationship', () => {
  const evidence = extractProductEvidence(
    invoiceProduct,
    research,
    {
      origin: 'claude_summary',
      sourceType: 'distributor',
      text: 'Supplier SKU: SUP456 | Manufacturer SKU: MFG123',
    }
  );

  assert.equal(
    evidence.identityVerification.crossReferenceStatus,
    'needs_review'
  );

  assert.equal(evidence.conversionApproved, false);
});


test('unverified publisher cannot establish SKU relationship', () => {
  const evidence = extractProductEvidence(
    invoiceProduct,
    research,
    {
      origin: 'anthropic_web_fetch',
      sourceType: 'distributor',
      text: 'Supplier SKU: SUP456 | Manufacturer SKU: MFG123',
      attribution: {
        publisher: 'Example Distributor',
        publisherType: 'distributor',
        verificationStatus: 'unverified',
      },
    }
  );

  assert.equal(
    evidence.identityVerification.crossReferenceStatus,
    'needs_review'
  );

  assert.equal(
    evidence.identityVerification.crossReferenceEvidence,
    null
  );

  assert.equal(evidence.identityMatches, false);
  assert.equal(evidence.conversionApproved, false);
});
