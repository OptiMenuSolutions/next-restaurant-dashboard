
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ingredientIdentityConflicts,
  safeguardIngredientMatch,
} from '../lib/invoiceIngredientIdentity.js';

const ingredient = (id, name) => ({ id, name, score: 0.99 });

test('fresh broccoli crowns do not auto-match frozen florets', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Broccoli Crowns Fresh',
      'Broccoli Florets Frozen'
    ),
    true
  );
});

test('spring mix does not auto-match chopped iceberg romaine', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Spring Mix',
      'Salad Blend Iceberg Romaine Chopped'
    ),
    true
  );
});

test('specific broccoli products do not auto-match generic broccoli', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Broccoli Florets Frozen',
      'Broccoli'
    ),
    true
  );
});

test('equivalent supplier abbreviations remain compatible', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Chicken Breast BNLS SKNLS',
      'Chicken Breast Boneless Skinless'
    ),
    false
  );
});

test('purchase packaging differences do not cause identity conflicts', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Mozzarella 5lb',
      'Mozzarella'
    ),
    false
  );
});

test('conflicting automatic matches become review candidates', () => {
  const result = safeguardIngredientMatch(
    'Broccoli Crowns Fresh',
    {
      status: 'auto',
      matches: [ingredient('broccoli-1', 'Broccoli Florets Frozen')],
    }
  );

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.matches[0].id, 'broccoli-1');
});

test('compatible automatic matches remain automatic', () => {
  const result = safeguardIngredientMatch(
    'Chicken Breast BNLS SKNLS',
    {
      status: 'auto',
      matches: [
        ingredient('chicken-1', 'Chicken Breast Boneless Skinless'),
      ],
    }
  );

  assert.equal(result.status, 'auto');
  assert.equal(result.matches[0].id, 'chicken-1');
});
