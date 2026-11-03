
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateProductSourceConsensus,
} from '../lib/productSourceConsensus.js';

const invoiceProduct = {
  supplier: 'Example Distributor',
  brand: 'Example Foods',
  sku: 'SUP456',
};

const trustedSuppliers = [{
  supplier: 'Example Distributor',
  hostname: 'catalog.example.com',
}];

function source(url, pack, approved = true) {
  return {
    url,
    retrieval: {
      status: 'retrieved',
      sourceDocument: {
        origin: 'anthropic_web_fetch',
        url,
        text: [
          '# Example Strawberry Glaze',
          'Supplier SKU: SUP456',
          'Brand: Example Foods',
          `Pack Size: ${pack}`,
        ].join('\n'),
      },
    },
    directSupplierDecision: {
      conversionApproved: approved,
      conversion: approved
        ? {
            fromUnit: 'can',
            toUnit: 'oz',
            factor: 104,
            scope: 'per_container',
          }
        : null,
    },
  };
}

const first =
  source('https://catalog.example.com/a', '3/104 oz.');

const second =
  source('https://catalog.example.com/b', '3/104 oz.');

function evaluate(sources) {
  return evaluateProductSourceConsensus({
    invoiceProduct,
    sources,
    trustedSuppliers,
  });
}

test('approves consistent authenticated sources', () => {
  const result = evaluate([first, second]);

  assert.equal(result.status, 'verified');
  assert.equal(result.conversionApproved, true);
  assert.equal(result.conversion.factor, 104);
});

test('blocks conflicting package specifications', () => {
  const conflicting = source(
    'https://catalog.example.com/b',
    '3/96 oz.',
    false
  );

  const result = evaluate([first, conflicting]);

  assert.equal(result.status, 'needs_review');
  assert.equal(result.conversionApproved, false);
  assert.match(result.reason, /conflicting/i);
});

test('blocks unavailable authenticated source', () => {
  const unavailable = {
    url: 'https://catalog.example.com/b',
    retrieval: { status: 'unavailable' },
  };

  const result = evaluate([first, unavailable]);

  assert.equal(result.conversionApproved, false);
});

test('unrelated manufacturer page cannot override supplier', () => {
  const unrelated = source(
    'https://manufacturer.example.org/product',
    '6/120 oz.',
    false
  );

  const result = evaluate([first, unrelated]);

  assert.equal(result.status, 'verified');
  assert.equal(result.conversion.factor, 104);
});

test('unregistered sources alone cannot approve', () => {
  const untrusted = source(
    'https://unknown.example.org/product',
    '3/104 oz.'
  );

  const result = evaluate([untrusted]);

  assert.equal(result.conversionApproved, false);
});

test('blocks source with mismatched supplier SKU', () => {
  const wrong = source(
    'https://catalog.example.com/b',
    '3/104 oz.',
    false
  );

  wrong.retrieval.sourceDocument.text =
    wrong.retrieval.sourceDocument.text.replace(
      'SUP456', 'OTHER999'
    );

  const result = evaluate([first, wrong]);

  assert.equal(result.conversionApproved, false);
});

test('blocks conflicting weight and volume units', () => {
  const differentUnit = source(
    'https://catalog.example.com/b',
    '3/104 fl oz',
    false
  );

  const result = evaluate([first, differentUnit]);

  assert.equal(result.conversionApproved, false);
  assert.match(result.reason, /conflicting/i);
});
