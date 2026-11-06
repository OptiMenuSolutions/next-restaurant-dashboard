
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ingredientIdentityConflicts,
  safeguardIngredientMatch,
  resolveInvoiceIngredientMatches,
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


test('incorrect historical ingredient association requires review', () => {
  const items = [{
    item_name_normalized: 'Broccoli Crowns Fresh',
  }];

  const ingredients = [{
    id: 'broccoli-1',
    name: 'Broccoli Florets Frozen',
  }];

  const remembered = new Map([
    ['broccoli crowns fresh', 'broccoli-1'],
  ]);

  const aiResults = [{
    status: 'auto',
    matches: [ingredients[0]],
  }];

  const results = resolveInvoiceIngredientMatches(
    items,
    ingredients,
    remembered,
    aiResults
  );

  assert.equal(results[0].status, 'ambiguous');
  assert.equal(results[0].matches[0].id, 'broccoli-1');
});

test('incorrect Claude match requires review', () => {
  const items = [{
    item_name_normalized: 'Spring Mix',
  }];

  const ingredients = [{
    id: 'salad-1',
    name: 'Salad Blend Iceberg Romaine Chopped',
  }];

  const results = resolveInvoiceIngredientMatches(
    items,
    ingredients,
    new Map(),
    [{
      status: 'auto',
      matches: [ingredients[0]],
    }]
  );

  assert.equal(results[0].status, 'ambiguous');
});

test('legitimate remembered supplier abbreviation remains automatic', () => {
  const items = [{
    item_name_normalized: 'Chicken Breast BNLS SKNLS',
  }];

  const ingredients = [{
    id: 'chicken-1',
    name: 'Chicken Breast Boneless Skinless',
  }];

  const remembered = new Map([
    ['chicken breast bnls sknls', 'chicken-1'],
  ]);

  const results = resolveInvoiceIngredientMatches(
    items,
    ingredients,
    remembered,
    []
  );

  assert.equal(results[0].status, 'auto');
  assert.equal(results[0].matches[0].id, 'chicken-1');
});


test('legitimate produce descriptions remain compatible', () => {
  const equivalentPairs = [
    ['Chives', 'Fresh Chives'],
    ['Mushrooms Button Whole', 'Button Mushrooms'],
    ['Coleslaw Fresh Prepared', 'Coleslaw'],
    ['Pico de Gallo Fresh-Cut', 'Pico de Gallo'],
  ];

  for (const [invoiceName, ingredientName] of equivalentPairs) {
    assert.equal(
      ingredientIdentityConflicts(invoiceName, ingredientName),
      false,
      `${invoiceName} should match ${ingredientName}`
    );
  }
});

test('legitimate historical produce matches remain automatic', () => {
  const pairs = [
    ['Chives', 'Fresh Chives'],
    ['Mushrooms Button Whole', 'Button Mushrooms'],
    ['Coleslaw Fresh Prepared', 'Coleslaw'],
    ['Pico de Gallo Fresh-Cut', 'Pico de Gallo'],
  ];

  for (const [index, [invoiceName, ingredientName]] of pairs.entries()) {
    const result = safeguardIngredientMatch(invoiceName, {
      status: 'auto',
      matches: [{
        id: `ingredient-${index}`,
        name: ingredientName,
        score: 1,
      }],
    });

    assert.equal(result.status, 'auto', invoiceName);
  }
});

test('produce equivalences do not permit unrelated product merges', () => {
  const conflictingPairs = [
    ['Broccoli Crowns', 'Broccoli Florets'],
    ['Broccoli Crowns', 'Broccoli'],
    ['Spring Mix', 'Mixed Greens'],
    ['Salad Blend Iceberg Romaine Chopped', 'Mixed Greens'],
    ['Spring Mix', 'Salad Blend Iceberg Romaine Chopped'],
  ];

  for (const [invoiceName, ingredientName] of conflictingPairs) {
    assert.equal(
      ingredientIdentityConflicts(invoiceName, ingredientName),
      true,
      `${invoiceName} must not automatically match ${ingredientName}`
    );
  }
});

test('chicken breast cannot auto-match chicken thigh', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Chicken Breast Boneless Skinless',
      'Chicken Thigh Boneless Skinless'
    ),
    true
  );
});

test('chicken wings cannot auto-match chicken breast', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Chicken Wings',
      'Chicken Breast'
    ),
    true
  );
});

test('raw chicken cannot auto-match cooked chicken', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Raw Chicken Breast',
      'Cooked Chicken Breast'
    ),
    true
  );
});

test('breaded and unbreaded products remain separate', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Breaded Chicken Tenders',
      'Unbreaded Chicken Tenders'
    ),
    true
  );
});

test('different ground beef fat ratios remain separate', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Ground Beef 80/20',
      'Ground Beef 90/10'
    ),
    true
  );
});

test('unspecified ground beef ratio requires review', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Ground Beef 80/20',
      'Ground Beef'
    ),
    true
  );
});

test('identical ground beef fat ratios remain compatible', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'Ground Beef 80/20',
      'Ground Beef 80/20'
    ),
    false
  );
});

test('supplier abbreviations preserve equivalent identities', () => {
  assert.equal(
    ingredientIdentityConflicts(
      'CHKN BRST BNLS SKNLS',
      'Chicken Breast Boneless Skinless'
    ),
    false
  );
});