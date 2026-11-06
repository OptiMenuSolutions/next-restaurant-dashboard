import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  selectInvoiceRepricingSource,
} from '../lib/invoiceRepricing.js';

const deletionSource = readFileSync(
  new URL('../pages/api/invoices/delete-invoice.js', import.meta.url),
  'utf8'
);

test('invoice deletion uses shared repricing protection', () => {
  assert.match(
    deletionSource,
    /selectInvoiceRepricingSource\s*\(/
  );

  assert.doesNotMatch(
    deletionSource,
    /convertInvoiceCostToStandardUnit/
  );
});

test('unverified remaining invoices cannot set ingredient prices', () => {
  const result = selectInvoiceRepricingSource([
    {
      unit: 'case',
      unit_cost: 80,
      invoices: {
        date: '2026-11-05',
        created_at: '2026-11-05T12:00:00Z',
      },
    },
  ]);

  assert.equal(result.status, 'unverified');
  assert.equal(result.updates, null);
});

test('valid older invoice remains available for repricing', () => {
  const result = selectInvoiceRepricingSource([
    {
      unit: 'lb',
      unit_cost: 4,
      invoices: {
        date: '2026-11-01',
        created_at: '2026-11-01T12:00:00Z',
      },
    },
    {
      unit: 'case',
      unit_cost: 80,
      invoices: {
        date: '2026-11-05',
        created_at: '2026-11-05T12:00:00Z',
      },
    },
  ]);

  assert.equal(result.status, 'priced');
  assert.equal(result.updates.last_price, 0.25);
  assert.equal(result.updates.unit, 'oz');
});

test('no remaining invoice lines is handled separately', () => {
  const result = selectInvoiceRepricingSource([]);

  assert.equal(result.status, 'no_linked_invoices');
  assert.equal(result.updates, null);
});