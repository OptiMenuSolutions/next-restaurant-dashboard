import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasVerifiedInvoicePrice,
} from '../lib/invoicePriceProvenance.js';

import {
  selectInvoiceRepricingSource,
} from '../lib/invoiceRepricing.js';

function invoiceLine({
  status = 'unknown',
  unit = 'lb',
  unitCost = 4,
  date = '2026-11-05',
} = {}) {
  return {
    unit,
    unit_cost: unitCost,

    price_verification_status: status,

    price_verification_source:
      status === 'verified'
        ? 'authenticated_supplier_record'
        : null,

    price_verified_at:
      status === 'verified'
        ? '2026-11-05T12:00:00Z'
        : null,

    price_verification_evidence:
      status === 'verified'
        ? {
            source: 'supplier_invoice',
            reference: 'test-document',
          }
        : null,

    invoices: {
      date,
      created_at: `${date}T12:00:00Z`,
    },
  };
}

test('unknown historical pricing is not verified', () => {
  assert.equal(
    hasVerifiedInvoicePrice(
      invoiceLine({ status: 'unknown' })
    ),
    false
  );
});

test('explicitly unverified pricing is rejected', () => {
  assert.equal(
    hasVerifiedInvoicePrice(
      invoiceLine({ status: 'unverified' })
    ),
    false
  );
});

test('verified status requires supporting evidence', () => {
  const line = invoiceLine({
    status: 'verified',
  });

  line.price_verification_evidence = null;

  assert.equal(
    hasVerifiedInvoicePrice(line),
    false
  );
});

test('complete verification metadata is recognized', () => {
  assert.equal(
    hasVerifiedInvoicePrice(
      invoiceLine({ status: 'verified' })
    ),
    true
  );
});

test('strict repricing excludes unknown history', () => {
  const result = selectInvoiceRepricingSource(
    [
      invoiceLine({
        status: 'unknown',
        unitCost: 4,
      }),
    ],
    { requireVerified: true }
  );

  assert.equal(result.status, 'unverified');
  assert.equal(result.updates, null);
});

test('strict repricing accepts eligible verified lines', () => {
  const result = selectInvoiceRepricingSource(
    [
      invoiceLine({
        status: 'verified',
        unitCost: 4,
      }),
    ],
    { requireVerified: true }
  );

  assert.equal(result.status, 'priced');
  assert.equal(result.updates.last_price, 0.25);
  assert.equal(result.updates.unit, 'oz');
});

test('newer unknown prices cannot displace verified history', () => {
  const result = selectInvoiceRepricingSource(
    [
      invoiceLine({
        status: 'verified',
        unitCost: 4,
        date: '2026-11-01',
      }),

      invoiceLine({
        status: 'unknown',
        unitCost: 8,
        date: '2026-11-05',
      }),
    ],
    { requireVerified: true }
  );

  assert.equal(result.status, 'priced');
  assert.equal(result.updates.last_price, 0.25);
  assert.equal(
    result.updates.last_ordered_at,
    '2026-11-01'
  );
});

test('strict repricing still rejects unsupported units', () => {
  const result = selectInvoiceRepricingSource(
    [
      invoiceLine({
        status: 'verified',
        unit: 'can',
        unitCost: 20,
      }),
    ],
    { requireVerified: true }
  );

  assert.equal(result.status, 'unverified');
  assert.equal(result.updates, null);
});

test('legacy compatibility remains unchanged until activation', () => {
  const result = selectInvoiceRepricingSource([
    invoiceLine({
      status: 'unknown',
      unitCost: 4,
    }),
  ]);

  assert.equal(result.status, 'priced');
  assert.equal(result.updates.last_price, 0.25);
});