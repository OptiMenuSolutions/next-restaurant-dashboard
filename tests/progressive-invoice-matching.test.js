import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isStrictDirectMatch,
  findStrictDirectMatch,
} from '../lib/progressiveInvoiceMatching.js';

const ingredients = [
  {
    id: 'fried-mozzarella',
    name: 'Fried Mozzarella Sticks',
  },
  {
    id: 'chicken-breast',
    name: 'Chicken Breast Boneless Skinless',
  },
  {
    id: 'mixed-greens',
    name: 'Mixed Greens',
  },
];

test('matches prepared mozzarella sticks', () => {
  assert.equal(
    isStrictDirectMatch(
      '6 LB CASE MOZZARELLA STICK FRIED FROZEN',
      'Fried Mozzarella Sticks'
    ),
    true
  );
});

test('rejects fresh mozzarella', () => {
  assert.equal(
    isStrictDirectMatch(
      '6 LB CASE MOZZARELLA FRESH',
      'Fried Mozzarella Sticks'
    ),
    false
  );
});

test('rejects shredded mozzarella', () => {
  assert.equal(
    isStrictDirectMatch(
      'MOZZARELLA CHEESE SHREDDED 5LB',
      'Fried Mozzarella Sticks'
    ),
    false
  );
});

test('recognizes verified abbreviations', () => {
  assert.equal(
    isStrictDirectMatch(
      'CHKN BRST BNLS SKNLS',
      'Chicken Breast Boneless Skinless'
    ),
    true
  );
});

test('rejects unrelated lettuce products', () => {
  assert.equal(
    isStrictDirectMatch(
      'ROMAINE HEARTS 24CT',
      'Mixed Greens'
    ),
    false
  );
});

test('selects the single eligible direct match', () => {
  const result = findStrictDirectMatch(
    '6 LB CASE MOZZARELLA STICK FRIED FROZEN',
    ingredients
  );

  assert.equal(result.status, 'auto');
  assert.equal(
    result.matches[0].id,
    'fried-mozzarella'
  );
});

test('does not invent a match for an unknown product', () => {
  const result = findStrictDirectMatch(
    'FRESH MOZZARELLA 6LB',
    ingredients
  );

  assert.equal(result.status, 'new');
  assert.equal(result.matches.length, 0);
});

test('does not choose between duplicate identities', () => {
  const duplicateIngredients = [
    {
      id: 'first',
      name: 'Fried Mozzarella Sticks',
    },
    {
      id: 'second',
      name: 'Fried Mozzarella Sticks',
    },
  ];

  const result = findStrictDirectMatch(
    'FRIED MOZZARELLA STICKS',
    duplicateIngredients
  );

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.matches.length, 0);
});

test('does not match an unpublished ingredient', () => {
  const publishedIngredients = [
    ingredients[0],
  ];

  const result = findStrictDirectMatch(
    'CHICKEN BREAST BONELESS SKINLESS',
    publishedIngredients
  );

  assert.equal(result.status, 'new');
});

test('recognizes shredded cheese supplier abbreviations', () => {
  assert.equal(
    isStrictDirectMatch(
      'MOZZARELLA SHRD 4X5 LB CS',
      'Mozzarella Shredded'
    ),
    true
  );
});

test('recognizes sliced ingredient abbreviations', () => {
  assert.equal(
    isStrictDirectMatch(
      'CHEDDAR CHEESE SLCD 5 LB',
      'Cheddar Cheese Sliced'
    ),
    true
  );
});

test('recognizes romaine abbreviations', () => {
  assert.equal(
    isStrictDirectMatch(
      'RMN HEARTS 24 CT',
      'Romaine Hearts'
    ),
    true
  );
});

test('rejects chicken thigh as chicken breast', () => {
  assert.equal(
    isStrictDirectMatch(
      'CHICKEN THIGH BONELESS SKINLESS',
      'Chicken Breast Boneless Skinless'
    ),
    false
  );
});

test('rejects raw product for cooked ingredient', () => {
  assert.equal(
    isStrictDirectMatch(
      'CHICKEN BREAST RAW',
      'Chicken Breast Cooked'
    ),
    false
  );
});