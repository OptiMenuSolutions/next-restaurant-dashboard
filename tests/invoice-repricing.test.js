import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectInvoiceRepricingSource,
} from '../lib/invoiceRepricing.js';

function line(unit, cost, date) {
  return {
    unit,
    unit_cost: cost,
    invoices: {
      date,
      created_at: `${date}T12:00:00Z`,
    },
  };
}

test('newest valid invoice determines ingredient price', () => {
  const result = selectInvoiceRepricingSource([
    line('lb', 4, '2026-11-01'),
    line('lb', 6, '2026-11-05'),
  ]);

  assert.equal(result.status, 'priced');
  assert.equal(result.updates.last_price, 0.375);
  assert.equal(result.updates.unit, 'oz');
  assert.equal(result.updates.last_ordered_at, '2026-11-05');
});

test('newer unsupported case does not overwrite valid price', () => {
  const result = selectInvoiceRepricingSource([
    line('lb', 4, '2026-11-01'),
    line('case', 80, '2026-11-05'),
  ]);

  assert.equal(result.status, 'priced');
  assert.equal(result.updates.last_price, 0.25);
  assert.equal(result.updates.last_ordered_at, '2026-11-01');
});

test('numbered cans cannot become an ingredient price', () => {
  const result = selectInvoiceRepricingSource([
    line('can', 16.93, '2026-11-05'),
  ]);

  assert.equal(result.status, 'unverified');
  assert.equal(result.updates, null);
});

test('missing units cannot create standardized prices', () => {
  const result = selectInvoiceRepricingSource([
    line(null, 40, '2026-11-05'),
  ]);

  assert.equal(result.status, 'unverified');
});

test('no linked invoices is distinguished from unverified invoices', () => {
  const result = selectInvoiceRepricingSource([]);

  assert.equal(result.status, 'no_linked_invoices');
  assert.equal(result.updates, null);
});

test('repricing preserves physical unit categories', () => {
  const result = selectInvoiceRepricingSource([
    line('gal', 128, '2026-11-05'),
  ]);

  assert.equal(result.status, 'priced');
  assert.equal(result.updates.last_price, 1);
  assert.equal(result.updates.standard_unit, 'fl oz');
});

test('invalid prices are excluded from repricing', () => {
  const result = selectInvoiceRepricingSource([
    line('lb', -5, '2026-11-05'),
    line('lb', 4, '2026-11-01'),
  ]);

  assert.equal(result.status, 'priced');
  assert.equal(result.updates.last_price, 0.25);
});

const RESTAURANT_ID = 'restaurant-a';

function supportedIngredient() {
  return {
    id: 'ingredient-1',
    restaurant_id: RESTAURANT_ID,
    unit: 'fl oz',
  };
}

function supportedLine(overrides = {}) {
  return {
    id: 'line-1',
    invoice_id: 'invoice-1',
    ingredient_id: 'ingredient-1',
    restaurant_id: RESTAURANT_ID,
    quantity: 4,
    unit: 'qt',
    unit_cost: 7.5,
    amount: 30,
    price_verification_status: 'unknown',
    invoices: {
      restaurant_id: RESTAURANT_ID,
      date: '2026-11-07',
      created_at: '2026-11-07T12:00:00Z',
    },
    ...overrides,
  };
}

function supportedEvidence(overrides = {}) {
  return new Map([
    [
      'line-1',
      {
        invoice_item_id: 'line-1',
        invoice_id: 'invoice-1',
        source_type: 'structured_ocr_table',
        validation_status: 'source_table_consistent',
        invalidated_at: null,
        invalidation_reason: null,
        ...overrides,
      },
    ],
  ]);
}

test('invoice-supported repricing remains disabled by default', () => {
  const result = selectInvoiceRepricingSource(
    [supportedLine()],
    { requireVerified: true }
  );

  assert.equal(result.status, 'unverified');
  assert.equal(result.updates, null);
});

test('active invoice evidence can authorize ingredient repricing', () => {
  const result = selectInvoiceRepricingSource(
    [supportedLine()],
    {
      requireVerified: true,
      allowInvoiceSupported: true,
      ingredient: supportedIngredient(),
      evidenceByLineId: supportedEvidence(),
    }
  );

  assert.equal(result.status, 'priced');
  assert.equal(result.updates.unit, 'fl oz');
  assert.equal(result.updates.last_price, 0.234375);
});

test('invalidated evidence cannot authorize ingredient repricing', () => {
  const result = selectInvoiceRepricingSource(
    [supportedLine()],
    {
      requireVerified: true,
      allowInvoiceSupported: true,
      ingredient: supportedIngredient(),
      evidenceByLineId: supportedEvidence({
        invalidated_at: '2026-11-08T12:00:00Z',
      }),
    }
  );

  assert.equal(result.status, 'unverified');
  assert.equal(result.updates, null);
});

test('invoice evidence cannot authorize incompatible unit conversions', () => {
  const result = selectInvoiceRepricingSource(
    [supportedLine()],
    {
      requireVerified: true,
      allowInvoiceSupported: true,
      ingredient: {
        ...supportedIngredient(),
        unit: 'oz',
      },
      evidenceByLineId: supportedEvidence(),
    }
  );

  assert.equal(result.status, 'unverified');
  assert.equal(result.updates, null);
});

test('invoice evidence cannot authorize another ingredient price', () => {
  const result = selectInvoiceRepricingSource(
    [supportedLine()],
    {
      requireVerified: true,
      allowInvoiceSupported: true,
      ingredient: {
        ...supportedIngredient(),
        id: 'different-ingredient',
      },
      evidenceByLineId: supportedEvidence(),
    }
  );

  assert.equal(result.status, 'unverified');
  assert.equal(result.updates, null);
});