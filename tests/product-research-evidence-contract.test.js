
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseResearchJSON,
  classifyProductResearch,
} from '../lib/productWebResearch.js';

import {
  extractProductEvidence,
} from '../lib/productEvidenceExtraction.js';

test('research findings flow into evidence extraction', () => {
  const invoiceProduct = {
    name: 'Generic Foodservice Product',
    brand: 'Example Brand',
    sku: 'SUP456',
    packageCount: 6,
  };

  const findings = parseResearchJSON(JSON.stringify({
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
  }));

  const sources = [{
    url: 'https://example.com/product',
    title: 'Product specification',
  }];

  const classified = classifyProductResearch(
    findings,
    sources
  );

  const evidence = extractProductEvidence(
    invoiceProduct,
    {
      ...classified,
      findings,
      source: {
        url: sources[0].url,
        type: 'manufacturer',
      },
    }
  );

  assert.equal(evidence.identity.supplierSku, 'SUP456');
  assert.equal(evidence.identity.manufacturerSku, 'MFG123');
  assert.equal(evidence.package.matches, true);
  assert.equal(evidence.measurement.quantity, 120);
  assert.equal(evidence.measurement.unit, 'oz');
  assert.equal(evidence.identityVerification.reportedIdentifierMatches, true);

  // Research alone must never approve a conversion.
  assert.equal(evidence.verificationStatus, 'unverified');
  assert.equal(evidence.conversionApproved, false);
});

test('missing invoice brand does not become verified identity', () => {
  const evidence = extractProductEvidence(
    {
      sku: 'SUP456',
      packageCount: 6,
    },
    {
      findings: {
        brand: 'Example Brand',
        supplier_sku: 'SUP456',
        package_count: 6,
        net_quantity: 120,
        net_unit: 'oz',
        measurement_scope: 'per_container',
      },
    }
  );

  assert.equal(
    evidence.identityVerification.reportedIdentifierMatches,
    true
  );
  assert.equal(
    evidence.identityVerification.invoiceBrandPresent,
    false
  );
  assert.equal(evidence.identityMatches, false);
  assert.equal(evidence.conversionApproved, false);
});
