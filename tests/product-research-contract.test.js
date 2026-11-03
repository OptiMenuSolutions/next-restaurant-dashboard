
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseResearchJSON,
  classifyProductResearch,
} from '../lib/productWebResearch.js';

test('parsed research can be classified without losing identifiers', () => {
  const responseText = JSON.stringify({
    match_status: 'exact_match',
    identity_evidence: 'exact_identifier',
    product_name: 'Generic Foodservice Product',
    brand: 'Example Brand',
    manufacturer_sku: 'MFG123',
    supplier_sku: 'SUP456',
    package_count: 6,
    net_quantity: 120,
    net_unit: 'oz',
    measurement_scope: 'per_container',
    reason: '',
  });

  const findings = parseResearchJSON(responseText);

  assert.equal(typeof findings, 'object');
  assert.equal(findings.manufacturer_sku, 'MFG123');
  assert.equal(findings.supplier_sku, 'SUP456');

  const classified = classifyProductResearch(
    findings,
    [{
      url: 'https://example.com/product',
      title: 'Product specification',
    }]
  );

  assert.equal(classified.status, 'verified_candidate');
  assert.equal(classified.product.manufacturerSku, 'MFG123');
  assert.equal(classified.product.supplierSku, 'SUP456');
  assert.equal(classified.measurement.unit, 'oz');
});

test('malformed research remains unverified', () => {
  const findings = parseResearchJSON('not valid JSON');

  assert.equal(findings, null);

  const classified = classifyProductResearch(findings, []);

  assert.equal(classified.status, 'needs_review');
  assert.equal(classified.measurement, null);
});
