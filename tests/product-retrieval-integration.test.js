
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseResearchJSON } from '../lib/productWebResearch.js';
import {
  extractProductEvidence,
} from '../lib/productEvidenceExtraction.js';

const invoice = {
  name: 'Glaze Strawberry',
  brand: null,
  sku: '74135',
  packageCount: 3,
  containerUnit: 'can',
};

const source = {
  url: 'https://www.knousefoodservice.com/products/strawberry-glaze-120-oz/',
  title: 'Strawberry Glaze - 120 oz.',
  originalContentAvailable: false,
};

test('structured retrieved findings reject mismatched packaging', () => {
  const responseText = JSON.stringify({
    product_name: 'Strawberry Glaze',
    brand: 'Lucky Leaf',
    manufacturer_sku: 'FFPFR6030LKL01',
    supplier_sku: null,
    package_count: 6,
    net_quantity: 120,
    net_unit: 'oz',
    measurement_scope: 'per_container',
  });

  const findings = parseResearchJSON(responseText);

  const result = extractProductEvidence(invoice, {
    findings,
    source,
  });

  assert.equal(result.package.expectedCount, 3);
  assert.equal(result.package.reportedCount, 6);
  assert.equal(result.package.matches, false);
  assert.equal(result.identityMatches, false);
  assert.equal(result.conversionApproved, false);
  assert.equal(result.verificationStatus, 'unverified');
});

test('invalid retrieved JSON cannot approve conversion', () => {
  const findings = parseResearchJSON(
    'The product might contain 120 ounces.'
  );

  const result = extractProductEvidence(invoice, {
    findings,
    source,
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.measurement, null);
  assert.equal(result.conversionApproved, false);
});

test('matching reported information still cannot approve conversion', () => {
  const findings = parseResearchJSON(JSON.stringify({
    product_name: 'Strawberry Glaze',
    brand: 'Lucky Leaf',
    manufacturer_sku: 'FFPFR6030LKL01',
    supplier_sku: null,
    package_count: 6,
    net_quantity: 120,
    net_unit: 'oz',
    measurement_scope: 'per_container',
  }));

  const result = extractProductEvidence(
    {
      name: 'Strawberry Glaze',
      brand: 'Lucky Leaf',
      sku: 'FFPFR6030LKL01',
      packageCount: 6,
      containerUnit: 'can',
    },
    { findings, source }
  );

  assert.equal(result.package.matches, true);
  assert.equal(result.identityMatches, true);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.conversionApproved, false);
});
