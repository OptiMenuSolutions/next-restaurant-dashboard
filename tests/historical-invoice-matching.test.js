// Copy to tests/historical-invoice-matching.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalUnitCompatible } from '../lib/historicalInvoiceMatching.js';
import { findStrictDirectMatch } from '../lib/progressiveInvoiceMatching.js';

test('matching stays strict for historical invoices', () => {
  const eligible = [{id:'oil',name:'Olive oil'},{id:'ranch',name:'Mayonnaise'}];
  assert.equal(findStrictDirectMatch('Olive Oil',eligible).matches[0]?.id,'oil');
  assert.equal(findStrictDirectMatch('Ground Beef 80/20',eligible).status,'new');
});

test('count packs cannot fabricate ounce-based costs', () => {
  assert.equal(historicalUnitCompatible('ct','oz'),false);
  assert.equal(historicalUnitCompatible('lb','oz'),true);
  assert.equal(historicalUnitCompatible('gal','fl oz'),true);
  assert.equal(historicalUnitCompatible('gal','oz'),false);
});

test('historical matching rejects unverified cans', () => {
  assert.equal(
    historicalUnitCompatible('can', 'fl oz'),
    false
  );

  assert.equal(
    historicalUnitCompatible('#10 can', 'oz'),
    false
  );
});

test('historical matching rejects unverified cases', () => {
  assert.equal(
    historicalUnitCompatible('case', 'oz'),
    false
  );

  assert.equal(
    historicalUnitCompatible('cs', 'lb'),
    false
  );
});

test('historical matching rejects unknown physical units', () => {
  assert.equal(
    historicalUnitCompatible(null, 'oz'),
    false
  );

  assert.equal(
    historicalUnitCompatible('lb', null),
    false
  );
});

test('historical matching preserves valid unit categories', () => {
  assert.equal(
    historicalUnitCompatible('lb', 'oz'),
    true
  );

  assert.equal(
    historicalUnitCompatible('gal', 'fl oz'),
    true
  );

  assert.equal(
    historicalUnitCompatible('ct', 'each'),
    true
  );

  assert.equal(
    historicalUnitCompatible('lb', 'fl oz'),
    false
  );
});