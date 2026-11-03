
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractProductEvidence,
} from '../lib/productEvidenceExtraction.js';

const invoice = {
  name: 'Strawberry Glaze',
  brand: 'Lucky Leaf',
  sku: 'FFPFR6030LKL01',
  packageCount: 6,
  containerUnit: 'can',
};

const source = {
  url: 'https://www.knousefoodservice.com/products/strawberry-glaze-120-oz/',
  title: 'Strawberry Glaze - 120 oz.',
  originalContentAvailable: false,
};

const findings = {
  product_name: 'Strawberry Glaze',
  brand: 'Lucky Leaf',
  manufacturer_sku: 'FFPFR6030LKL01',
  supplier_sku: null,
  package_count: 6,
  net_quantity: 120,
  net_unit: 'oz',
  measurement_scope: 'per_container',
};

test('matching reported details remain unverified', () => {
  const result = extractProductEvidence(invoice, {
    findings,
    source,
  });

  assert.equal(result.package.matches, true);
  assert.equal(result.identityMatches, true);
  assert.deepEqual(result.measurement, {
    quantity: 120,
    unit: 'oz',
    scope: 'per_container',
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.verificationStatus, 'unverified');
  assert.equal(result.conversionApproved, false);
});

test('different package configuration requires review', () => {
  const result = extractProductEvidence(
    {
      name: 'Glaze Strawberry',
      brand: null,
      sku: '74135',
      packageCount: 3,
      containerUnit: 'can',
    },
    {
      findings,
      source,
    }
  );

  assert.equal(result.package.expectedCount, 3);
  assert.equal(result.package.reportedCount, 6);
  assert.equal(result.package.matches, false);
  assert.equal(result.conversionApproved, false);
});

test('missing per-container measurement requires review', () => {
  const result = extractProductEvidence(invoice, {
    findings: {
      ...findings,
      net_quantity: null,
      net_unit: null,
    },
    source,
  });

  assert.equal(result.measurement, null);
  assert.equal(result.status, 'needs_review');
});

test('case-level measurement cannot become per-container measurement', () => {
  const result = extractProductEvidence(invoice, {
    findings: {
      ...findings,
      measurement_scope: 'per_case',
    },
    source,
  });

  assert.equal(result.measurement, null);
  assert.equal(result.conversionApproved, false);
});

test('missing research remains in review', () => {
  const result = extractProductEvidence(invoice, {
    findings: null,
    source,
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.measurement, null);
  assert.equal(result.conversionApproved, false);
});


test('SKU cross-reference is not assumed from research', () => {
  const evidence = extractProductEvidence(
    {
      sku: 'SUP456',
      packageCount: 6,
    },
    {
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
    }
  );

  assert.equal(
    evidence.identityVerification.crossReferenceStatus,
    'not_evaluated'
  );

  assert.equal(evidence.verificationStatus, 'unverified');
  assert.equal(evidence.conversionApproved, false);
});


test('detected SKU relationship remains unverified', () => {
  const evidence = extractProductEvidence(
    {
      sku: 'SUP456',
      brand: 'Example Brand',
      packageCount: 6,
    },
    {
      findings: {
        product_name: 'Example Product',
        brand: 'Example Brand',
        manufacturer_sku: 'MFG123',
        supplier_sku: 'SUP456',
        package_count: 6,
        net_quantity: 120,
        net_unit: 'oz',
        measurement_scope: 'per_container',
      },
    },
    {
      origin: 'anthropic_web_fetch',
      text: 'Supplier SKU: SUP456 | Manufacturer SKU: MFG123',
    }
  );

  assert.equal(
    evidence.identityDetection.status,
    'candidate_relationship_found'
  );

  assert.equal(
    evidence.identityDetection.relationshipDetected,
    true
  );

  assert.match(
    evidence.identityDetection.evidenceText,
    /SUP456/
  );

  assert.equal(
    evidence.identityVerification.crossReferenceStatus,
    'needs_review'
  );

  assert.equal(evidence.verificationStatus, 'unverified');
  assert.equal(evidence.conversionApproved, false);
});


test('retrieved package evidence reaches the extraction pipeline', () => {
  const evidence = extractProductEvidence(
    {
      sku: 'SUP456',
      brand: 'Example Brand',
      packageCount: 6,
    },
    {
      findings: {
        product_name: 'Example Product',
        brand: 'Example Brand',
        manufacturer_sku: 'MFG123',
        supplier_sku: 'SUP456',
        package_count: 6,
        net_quantity: 120,
        net_unit: 'oz',
        measurement_scope: 'per_container',
      },
      source: {
        url: 'https://example.com/product',
      },
    },
    {
      origin: 'anthropic_web_fetch',
      url: 'https://example.com/product',
      text: [
        '# Example Product',
        'Manufacturer SKU: MFG123',
        'Supplier SKU: SUP456',
        'Pack Size: 6/120 oz.',
      ].join('\n'),
    }
  );

  assert.equal(
    evidence.packageEvidence.status,
    'package_evidence_found'
  );

  assert.equal(
    evidence.packageEvidence.packageEvidenceMatches,
    true
  );

  assert.equal(
    evidence.packageEvidence.sourceSpecification,
    '6/120 oz.'
  );

  assert.equal(evidence.verificationStatus, 'unverified');
  assert.equal(evidence.conversionApproved, false);
});
