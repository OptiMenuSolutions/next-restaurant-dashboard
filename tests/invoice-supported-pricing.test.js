import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateInvoicePricingEligibility,
} from '../lib/invoiceSupportedPricing.js';

const RESTAURANT_ID = 'restaurant-a';

function ingredient(overrides = {}) {
  return {
    id: 'ingredient-1',
    restaurant_id: RESTAURANT_ID,
    unit: 'fl oz',
    ...overrides,
  };
}

function invoiceLine(overrides = {}) {
  return {
    id: 'line-1',
    invoice_id: 'invoice-1',
    restaurant_id: RESTAURANT_ID,
    ingredient_id: 'ingredient-1',
    quantity: 4,
    unit: 'qt',
    unit_cost: 7.5,
    amount: 30,
    price_verification_status: 'unknown',
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    invoice_id: 'invoice-1',
    invoice_item_id: 'line-1',
    source_type: 'structured_ocr_table',
    validation_status: 'source_table_consistent',
    ...overrides,
  };
}

test('Dijon mustard qualifies with trusted invoice evidence', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine(),
    ingredient: ingredient(),
    evidence: evidence(),
  });

  assert.equal(result.eligible, true);
  assert.equal(result.classification, 'invoice_supported');
  assert.equal(result.standardizedPrice.unit, 'fl oz');

  assert.ok(
    Math.abs(
      result.standardizedPrice.price - 0.234375
    ) < 0.000001
  );
});

test('unknown history without trusted evidence remains unresolved', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine(),
    ingredient: ingredient(),
  });

  assert.equal(result.eligible, false);
  assert.equal(
    result.reason,
    'insufficient_source_evidence'
  );
});

test('evidence from another invoice cannot authorize pricing', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine(),
    ingredient: ingredient(),
    evidence: evidence({
      invoice_id: 'different-invoice',
    }),
  });

  assert.equal(result.eligible, false);
});

test('evidence from another invoice item cannot authorize pricing', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine(),
    ingredient: ingredient(),
    evidence: evidence({
      invoice_item_id: 'different-line',
    }),
  });

  assert.equal(result.eligible, false);
});

test('cross-restaurant pricing is rejected', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      restaurant_id: 'restaurant-b',
    }),
    ingredient: ingredient(),
    evidence: evidence(),
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'restaurant_mismatch');
});

test('incorrect ingredient linkage is rejected', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      ingredient_id: 'different-ingredient',
    }),
    ingredient: ingredient(),
    evidence: evidence(),
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'ingredient_mismatch');
});

test('count-to-weight conversions remain blocked', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      quantity: 6,
      unit: 'each',
      unit_cost: 2,
      amount: 12,
    }),
    ingredient: ingredient({
      unit: 'oz',
    }),
    evidence: evidence(),
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'incompatible_units');
});

test('weight-to-volume conversions remain blocked', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      quantity: 168,
      unit: 'oz',
      unit_cost: 0.5,
      amount: 84,
    }),
    ingredient: ingredient({
      unit: 'fl oz',
    }),
    evidence: evidence(),
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'incompatible_units');
});

test('unsupported package units cannot establish prices', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      quantity: 3,
      unit: 'can',
      unit_cost: 10,
      amount: 30,
    }),
    ingredient: ingredient(),
    evidence: evidence(),
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'unsupported_invoice_unit');
});

test('incorrect invoice arithmetic blocks pricing', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      amount: 45,
    }),
    ingredient: ingredient(),
    evidence: evidence(),
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'invalid_invoice_arithmetic');
});

test('compatible weight pricing is eligible', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      quantity: 20,
      unit: 'lb',
      unit_cost: 4,
      amount: 80,
    }),
    ingredient: ingredient({
      unit: 'oz',
    }),
    evidence: evidence(),
  });

  assert.equal(result.eligible, true);
  assert.equal(result.classification, 'invoice_supported');
  assert.equal(result.standardizedPrice.unit, 'oz');
  assert.equal(result.standardizedPrice.price, 0.25);
});