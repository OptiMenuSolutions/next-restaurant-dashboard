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
    item_name: 'Dijon Mustard',
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
    restaurant_id: RESTAURANT_ID,
    source_type: 'structured_ocr_table',
    validation_status: 'source_table_consistent',
    invalidated_at: null,
    invalidation_reason: null,
    evidence: {
      pricing: {
        invoice_item_id: 'line-1',
        invoice_id: 'invoice-1',
        restaurant_id: RESTAURANT_ID,
        ingredient_id: null,
        item_name: 'Dijon Mustard',
        quantity: 4,
        unit: 'qt',
        unit_cost: 7.5,
        amount: 30,
      },
    },
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
    evidence: evidence({
      evidence: {
        pricing: {
          invoice_item_id: 'line-1',
          invoice_id: 'invoice-1',
          restaurant_id: RESTAURANT_ID,
          ingredient_id: null,
          item_name: 'Dijon Mustard',
          quantity: 20,
          unit: 'lb',
          unit_cost: 4,
          amount: 80,
        },
      },
    }),
  });

  assert.equal(result.eligible, true);
  assert.equal(result.classification, 'invoice_supported');
  assert.equal(result.standardizedPrice.unit, 'oz');
  assert.equal(result.standardizedPrice.price, 0.25);
});

test('invalidated invoice evidence cannot authorize pricing', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine(),
    ingredient: ingredient(),
    evidence: evidence({
      invalidated_at: '2026-11-08T12:00:00Z',
      invalidation_reason: 'invoice_line_modified',
    }),
  });

  assert.equal(result.eligible, false);
  assert.equal(result.classification, 'unresolved');
  assert.equal(
    result.reason,
    'insufficient_source_evidence'
  );
  assert.equal(result.standardizedPrice, null);
});

test('evidence with an invalidation reason cannot authorize pricing', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine(),
    ingredient: ingredient(),
    evidence: evidence({
      invalidated_at: null,
      invalidation_reason: 'invoice_line_modified',
    }),
  });

  assert.equal(result.eligible, false);
  assert.equal(
    result.reason,
    'insufficient_source_evidence'
  );
});

test('active invoice evidence remains eligible', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine(),
    ingredient: ingredient(),
    evidence: evidence({
      invalidated_at: null,
      invalidation_reason: null,
    }),
  });

  assert.equal(result.eligible, true);
  assert.equal(result.classification, 'invoice_supported');
});

test('supplier-verified pricing remains eligible without document evidence', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      price_verification_status: 'verified',
      price_verification_source: 'supplier',
      price_verified_at: '2026-11-08T12:00:00Z',
      price_verification_evidence: {
        source: 'supplier',
      },
    }),
    ingredient: ingredient(),
    evidence: null,
  });

  assert.equal(result.eligible, true);
  assert.equal(result.classification, 'supplier_verified');
});

test('ingredient linking preserves authenticated pricing eligibility', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      ingredient_id: 'ingredient-1',
    }),
    ingredient: ingredient(),
    evidence: evidence(),
  });

  assert.equal(result.eligible, true);
  assert.equal(result.classification, 'invoice_supported');
});

test('changed invoice price cannot reuse authenticated evidence', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      quantity: 4,
      unit_cost: 8,
      amount: 32,
    }),
    ingredient: ingredient(),
    evidence: evidence(),
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'insufficient_source_evidence');
});

test('changed supplier product cannot reuse authenticated evidence', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      item_name: 'Different Product',
    }),
    ingredient: ingredient(),
    evidence: evidence(),
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'insufficient_source_evidence');
});

test('evidence from another restaurant cannot authorize pricing', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine(),
    ingredient: ingredient(),
    evidence: evidence({
      restaurant_id: 'restaurant-b',
    }),
  });

  assert.equal(result.eligible, false);
});

test('missing original pricing snapshot cannot authorize pricing', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine(),
    ingredient: ingredient(),
    evidence: evidence({
      evidence: {},
    }),
  });

  assert.equal(result.eligible, false);
});

test('relinking to an incompatible ingredient cannot authorize pricing', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine(),
    ingredient: ingredient({
      unit: 'oz',
    }),
    evidence: evidence(),
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'incompatible_units');
});


test('authenticated V2 catch-weight evidence supports compatible ingredient pricing', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      item_name: 'Beef Skirt Steak',
      quantity: 9.96,
      unit: 'lb',
      unit_cost: 14.5,
      amount: 144.42,
    }),
    ingredient: ingredient({
      unit: 'oz',
    }),
    evidence: evidence({
      source_type: 'independent_ocr_evidence',
      validation_status: 'source_charge_verified',
      evidence_version: 2,
      evidence: {
        proof_version: 2,
        pricing: {
          invoice_item_id: 'line-1',
          invoice_id: 'invoice-1',
          restaurant_id: RESTAURANT_ID,
          ingredient_id: null,
          item_name: 'Beef Skirt Steak',
          quantity: 9.96,
          unit: 'lb',
          unit_cost: 14.5,
          amount: 144.42,
        },
      },
    }),
  });

  assert.equal(result.eligible, true);
  assert.equal(
    result.classification,
    'invoice_supported'
  );
  assert.equal(result.standardizedPrice.unit, 'oz');

  // $14.50 per lb = $0.90625 per oz.
  assert.ok(
    Math.abs(
      result.standardizedPrice.price - 0.90625
    ) < 0.000001
  );
});


function v2CatchWeightFixture({
  lineOverrides = {},
  ingredientOverrides = {},
  evidenceOverrides = {},
} = {}) {
  const line = invoiceLine({
    item_name: 'Beef Skirt Steak',
    quantity: 9.96,
    unit: 'lb',
    unit_cost: 14.5,
    amount: 144.42,
    ...lineOverrides,
  });

  const ingredientRecord = ingredient({
    unit: 'oz',
    ...ingredientOverrides,
  });

  const evidenceRecord = evidence({
    source_type: 'independent_ocr_evidence',
    validation_status: 'source_charge_verified',
    evidence_version: 2,
    evidence: {
      proof_version: 2,
      pricing: {
        invoice_item_id: 'line-1',
        invoice_id: 'invoice-1',
        restaurant_id: RESTAURANT_ID,
        ingredient_id: null,
        item_name: 'Beef Skirt Steak',
        quantity: 9.96,
        unit: 'lb',
        unit_cost: 14.5,
        amount: 144.42,
      },
    },
    ...evidenceOverrides,
  });

  return {
    line,
    ingredient: ingredientRecord,
    evidence: evidenceRecord,
  };
}

test('V2 evidence with mismatched proof version is rejected', () => {
  const fixture = v2CatchWeightFixture({
    evidenceOverrides: {
      evidence: {
        proof_version: 1,
        pricing: {
          invoice_item_id: 'line-1',
          invoice_id: 'invoice-1',
          restaurant_id: RESTAURANT_ID,
          item_name: 'Beef Skirt Steak',
          quantity: 9.96,
          unit: 'lb',
          unit_cost: 14.5,
          amount: 144.42,
        },
      },
    },
  });

  const result = evaluateInvoicePricingEligibility(fixture);

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'insufficient_source_evidence');
});

test('invalidated V2 evidence cannot authorize pricing', () => {
  const fixture = v2CatchWeightFixture({
    evidenceOverrides: {
      invalidated_at: '2026-11-10T12:00:00Z',
      invalidation_reason: 'invoice_line_modified',
    },
  });

  const result = evaluateInvoicePricingEligibility(fixture);

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'insufficient_source_evidence');
});

test('modified V2 invoice pricing cannot reuse evidence', () => {
  const fixture = v2CatchWeightFixture({
    lineOverrides: {
      unit_cost: 15.5,
      amount: 154.38,
    },
  });

  const result = evaluateInvoicePricingEligibility(fixture);

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'insufficient_source_evidence');
});

test('V2 catch-weight evidence cannot authorize weight-to-volume conversion', () => {
  const fixture = v2CatchWeightFixture({
    ingredientOverrides: {
      unit: 'fl oz',
    },
  });

  const result = evaluateInvoicePricingEligibility(fixture);

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'incompatible_units');
});

test('cross-restaurant V2 evidence cannot authorize pricing', () => {
  const fixture = v2CatchWeightFixture({
    evidenceOverrides: {
      restaurant_id: 'restaurant-b',
    },
  });

  const result = evaluateInvoicePricingEligibility(fixture);

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'insufficient_source_evidence');
});


test('authenticated direct-weight invoice supports ingredient repricing', () => {
  const result = evaluateInvoicePricingEligibility({
    line: invoiceLine({
      item_name: 'Chicken Breast Fresh',
      quantity: 18.4,
      unit: 'lb',
      unit_cost: 4.5,
      amount: 82.8,
    }),
    ingredient: ingredient({
      unit: 'oz',
    }),
    evidence: evidence({
      source_type: 'independent_ocr_evidence',
      validation_status: 'source_charge_verified',
      evidence_version: 2,
      evidence: {
        proof_version: 2,
        pricing: {
          invoice_item_id: 'line-1',
          invoice_id: 'invoice-1',
          restaurant_id: RESTAURANT_ID,
          ingredient_id: null,
          item_name: 'Chicken Breast Fresh',
          quantity: 18.4,
          unit: 'lb',
          unit_cost: 4.5,
          amount: 82.8,
        },
      },
    }),
  });

  assert.equal(result.eligible, true);
  assert.equal(result.classification, 'invoice_supported');

  assert.equal(result.standardizedPrice.unit, 'oz');
  assert.equal(result.standardizedPrice.price, 0.28125);
});
