import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toDisplayUnitCost,
  invoicePriceChange,
} from '../lib/invoiceDisplayPricing.js';


test('unresolved invoice cost remains null', () => {
  assert.equal(toDisplayUnitCost(null), null);
  assert.equal(toDisplayUnitCost(undefined), null);
  assert.equal(toDisplayUnitCost(''), null);
});


test('valid invoice unit costs remain unchanged', () => {
  assert.equal(toDisplayUnitCost(13.5), 13.5);
  assert.equal(toDisplayUnitCost(14), 14);
  assert.equal(toDisplayUnitCost('4.75'), 4.75);
});


test('invalid invoice costs cannot become display prices', () => {
  assert.equal(toDisplayUnitCost(NaN), null);
  assert.equal(toDisplayUnitCost(Infinity), null);
  assert.equal(toDisplayUnitCost(-5), null);
  assert.equal(toDisplayUnitCost('invalid'), null);
});


test('HTK-1007 unresolved mayonnaise cannot trigger a price alert', () => {
  const line = {
    unitCost: toDisplayUnitCost(null),
    prevUnitCost: 13.5,
    amount: 56,
  };

  assert.equal(line.unitCost, null);
  assert.equal(invoicePriceChange(line), null);
});


test('valid mayonnaise price increase is calculated correctly', () => {
  const line = {
    unitCost: 14,
    prevUnitCost: 13.5,
    amount: 56,
  };

  const change = invoicePriceChange(line);

  assert.ok(Math.abs(change - 3.7037037037) < 0.000001);
});


test('missing previous price cannot trigger an alert', () => {
  assert.equal(
    invoicePriceChange({
      unitCost: 14,
      prevUnitCost: null,
    }),
    null
  );
});


test('invalid previous price cannot trigger an alert', () => {
  assert.equal(
    invoicePriceChange({
      unitCost: 14,
      prevUnitCost: 0,
    }),
    null
  );
});


test('valid price decreases remain supported', () => {
  assert.equal(
    invoicePriceChange({
      unitCost: 9,
      prevUnitCost: 10,
    }),
    -10
  );
});


test('equal unit costs produce zero percentage change', () => {
  assert.equal(
    invoicePriceChange({
      unitCost: 13.5,
      prevUnitCost: 13.5,
    }),
    0
  );
});