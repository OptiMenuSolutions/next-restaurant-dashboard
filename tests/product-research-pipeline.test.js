
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  researchInvoiceProduct,
} from '../lib/productResearchPipeline.js';

const URL = 'https://example.com/product';

const invoiceProduct = {
  name: 'Example Product',
  brand: 'Example Brand',
  sku: 'SUP456',
  packageSize: '6/120 oz',
  packageCount: 6,
};

const research = {
  status: 'verified_candidate',
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
  sources: [{ url: URL, title: 'Product Page' }],
};

const retrieval = {
  status: 'retrieved',
  sourceDocument: {
    origin: 'anthropic_web_fetch',
    url: URL,
    text: [
      '# Example Product',
      'Manufacturer SKU: MFG123',
      'Supplier SKU: SUP456',
      'Pack Size: 6/120 oz.',
    ].join('\n'),
  },
};

test('connects research, retrieval and evidence extraction', async () => {
  const result = await researchInvoiceProduct(
    invoiceProduct,
    {
      researchProductOnline: async () => research,
      retrieveProductSource: async () => retrieval,
    }
  );

  assert.equal(
    result.evidence.identityDetection.relationshipDetected,
    false
  );

  assert.equal(
    result.evidence.packageEvidence.status,
    'package_evidence_found'
  );

  assert.equal(
    result.evidence.packageEvidence.packageEvidenceMatches,
    true
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(result.verificationStatus, 'unverified');
  assert.equal(result.conversionApproved, false);
});

test('rejects retrieved source with mismatched URL', async () => {
  const result = await researchInvoiceProduct(
    invoiceProduct,
    {
      researchProductOnline: async () => research,
      retrieveProductSource: async () => ({
        ...retrieval,
        sourceDocument: {
          ...retrieval.sourceDocument,
          url: 'https://example.com/other',
        },
      }),
    }
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(result.evidence, null);
  assert.equal(result.conversionApproved, false);
});

test('rejects research without a cited source', async () => {
  const result = await researchInvoiceProduct(
    invoiceProduct,
    {
      researchProductOnline: async () => ({
        ...research,
        sources: [],
      }),
      retrieveProductSource: async () => {
        throw new Error('Retrieval should not run');
      },
    }
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(result.evidence, null);
  assert.equal(result.conversionApproved, false);
});

test('rejects incompatible invoice package count', async () => {
  const result = await researchInvoiceProduct(
    {
      ...invoiceProduct,
      packageSize: '3/#10 CAN',
      packageCount: 3,
    },
    {
      researchProductOnline: async () => research,
      retrieveProductSource: async () => retrieval,
    }
  );

  assert.equal(
    result.evidence.packageEvidence.packageEvidenceMatches,
    false
  );

  assert.equal(result.conversionApproved, false);
});


test('rejects a different manufacturer case configuration', async () => {
  const result = await researchInvoiceProduct(
    {
      name: 'Strawberry Glaze',
      brand: 'Lucky Leaf',
      sku: '74135',
      packageSize: '3/#10 CAN',
      packageCount: 3,
    },
    {
      researchProductOnline: async () => ({
        status: 'verified_candidate',
        findings: {
          product_name: 'Strawberry Glaze',
          brand: 'Lucky Leaf',
          manufacturer_sku: 'FFPFR6030LKL01',
          supplier_sku: '74135',
          package_count: 6,
          net_quantity: 120,
          net_unit: 'oz',
          measurement_scope: 'per_container',
        },
        sources: [{
          url: 'https://example.com/strawberry-glaze',
        }],
      }),
      retrieveProductSource: async () => ({
        status: 'retrieved',
        sourceDocument: {
          origin: 'anthropic_web_fetch',
          url: 'https://example.com/strawberry-glaze',
          text: [
            '# Strawberry Glaze',
            'Product Code:',
            'FFPFR6030LKL01',
            'Pack Size:',
            '6/120 oz.',
          ].join('\n'),
        },
      }),
    }
  );

  assert.equal(result.evidence.package.matches, false);
  assert.equal(
    result.evidence.packageEvidence.packageEvidenceMatches,
    false
  );
  assert.equal(result.conversionApproved, false);
});

test('rejects a source with a conflicting net measurement', async () => {
  const result = await researchInvoiceProduct(
    invoiceProduct,
    {
      researchProductOnline: async () => research,
      retrieveProductSource: async () => ({
        status: 'retrieved',
        sourceDocument: {
          origin: 'anthropic_web_fetch',
          url: URL,
          text: [
            '# Example Product',
            'Manufacturer SKU: MFG123',
            'Pack Size: 6/96 oz.',
          ].join('\n'),
        },
      }),
    }
  );

  assert.equal(
    result.evidence.packageEvidence.packageEvidenceMatches,
    false
  );
  assert.equal(result.verificationStatus, 'unverified');
  assert.equal(result.conversionApproved, false);
});


test('pipeline preserves preliminary research screening', async () => {
  const result = await researchInvoiceProduct(
    invoiceProduct,
    {
      researchProductOnline: async () => research,
      retrieveProductSource: async () => retrieval,
    }
  );

  assert.ok(result.researchScreening);
  assert.equal(result.researchScreening.conversion, null);
  assert.equal(result.conversionApproved, false);
});

test('preliminary SKU mismatch does not block source retrieval', async () => {
  let retrievalCalled = false;

  const result = await researchInvoiceProduct(
    invoiceProduct,
    {
      researchProductOnline: async () => ({
        ...research,
        findings: {
          ...research.findings,
          supplier_sku: 'DIFFERENT-SKU',
        },
      }),
      retrieveProductSource: async () => {
        retrievalCalled = true;
        return retrieval;
      },
    }
  );

  assert.equal(retrievalCalled, true);
  assert.equal(
    result.researchScreening.status,
    'needs_review'
  );
  assert.ok(result.evidence);
  assert.equal(result.conversionApproved, false);
});


test('pipeline produces a unified verification decision', async () => {
  const result = await researchInvoiceProduct(
    invoiceProduct,
    {
      researchProductOnline: async () => research,
      retrieveProductSource: async () => retrieval,
    }
  );

  assert.ok(result.verificationDecision);

  assert.equal(
    result.verificationDecision.checks.invoicePackageMatches,
    true
  );

  assert.equal(
    result.verificationDecision.checks.sourcePackageMatches,
    true
  );

  assert.equal(
    result.verificationDecision.checks.sourceAuthorityVerified,
    false
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(result.verificationDecision.conversion, null);
  assert.equal(result.conversionApproved, false);
});
