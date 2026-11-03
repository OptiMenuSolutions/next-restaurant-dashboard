
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveInvoiceResearchCost,
} from '../lib/invoiceResearchCosting.js';

const item = {
  item_name: 'Strawberry Glaze',
  supplier_sku: 'SUP456',
  brand: 'Example Foods',
  pack_size_raw: '3/#10 CAN',
  quantity_shipped: 1,
  line_total: 50.78,
  invoice_price: 50.78,
};

const verifiedResearch = {
  status: 'verified',
  verificationStatus: 'verified',
  conversionApproved: true,
  sourceConsensus: {
    conversionApproved: true,
  },
  conversion: {
    fromUnit: 'can',
    toUnit: 'oz',
    factor: 104,
    scope: 'per_container',
    basis: 'authenticated_supplier_record',
  },
};

const supplier = 'Example Distributor';

test('disabled research never invokes provider', async () => {
  let calls = 0;

  const result = await resolveInvoiceResearchCost(
    item,
    supplier,
    {
      enabled: false,
      researchProduct: async () => {
        calls++;
        return verifiedResearch;
      },
    }
  );

  assert.equal(calls, 0);
  assert.equal(result.unit_cost, null);
});

test('server-approved research produces correct cost', async () => {
  let received;

  const result = await resolveInvoiceResearchCost(
    item,
    supplier,
    {
      enabled: true,
      researchProduct: async product => {
        received = product;
        return verifiedResearch;
      },
    }
  );

  assert.equal(received.sku, 'SUP456');
  assert.equal(received.packageCount, 3);
  assert.equal(received.containerUnit, 'can');
  assert.equal(result.quantity, 312);
  assert.equal(result.unit, 'oz');
  assert.ok(
    Math.abs(result.unit_cost - 50.78 / 312) < 1e-10
  );
});

test('client-submitted approval cannot authorize cost', async () => {
  const malicious = {
    ...item,
    conversionApproved: true,
    verificationStatus: 'verified',
    conversion: verifiedResearch.conversion,
  };

  const result = await resolveInvoiceResearchCost(
    malicious,
    supplier,
    {
      enabled: true,
      researchProduct: async () => ({
        status: 'needs_review',
        conversionApproved: false,
      }),
    }
  );

  assert.equal(result.unit_cost, null);
});

test('unverified source consensus blocks conversion', async () => {
  const result = await resolveInvoiceResearchCost(
    item,
    supplier,
    {
      enabled: true,
      researchProduct: async () => ({
        ...verifiedResearch,
        sourceConsensus: {
          conversionApproved: false,
        },
      }),
    }
  );

  assert.equal(result.unit_cost, null);
});

test('research failure preserves unresolved state', async () => {
  const result = await resolveInvoiceResearchCost(
    item,
    supplier,
    {
      enabled: true,
      researchProduct: async () => {
        throw new Error('Retrieval unavailable');
      },
    }
  );

  assert.equal(result.unit_cost, null);
  assert.equal(
    result.pricingStatus,
    'needs_package_verification'
  );
});

test('missing supplier SKU prevents research', async () => {
  let calls = 0;

  const result = await resolveInvoiceResearchCost(
    { ...item, supplier_sku: null },
    supplier,
    {
      enabled: true,
      researchProduct: async () => {
        calls++;
        return verifiedResearch;
      },
    }
  );

  assert.equal(calls, 0);
  assert.equal(result.unit_cost, null);
});

test('ordinary invoice products retain calculation', async () => {
  const result = await resolveInvoiceResearchCost(
    {
      pack: 2,
      size: 5,
      size_unit: 'lb',
      quantity_shipped: 1,
      line_total: 40,
      invoice_price: 40,
    },
    supplier,
    { enabled: false }
  );

  assert.equal(result.quantity, 10);
  assert.equal(result.unit, 'lb');
  assert.equal(result.unit_cost, 4);
});
