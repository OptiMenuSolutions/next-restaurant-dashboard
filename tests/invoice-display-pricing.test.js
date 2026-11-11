import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toDisplayUnitCost,
  invoicePriceChange,
  invoicePurchaseSummary,
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


const formatMoney = value => `$${Number(value).toFixed(2)}`;

test('catch-weight purchase displays its valid physical-unit cost', () => {
  const result = invoicePurchaseSummary({
    purchaseQuantity: 1,
    purchaseUnit: 'case',
    purchaseUnitPrice: null,
    qty: '18.4 lb',
    unit: 'lb',
    unitCost: 4.6,
    amount: 84.64,
  }, formatMoney);

  assert.equal(
    result,
    '1 case · Costed as 18.4 lb @ $4.60/lb'
  );
});

test('genuinely unresolved purchase remains unresolved', () => {
  const result = invoicePurchaseSummary({
    purchaseQuantity: 1,
    purchaseUnit: 'case',
    purchaseUnitPrice: null,
    qty: '1 case',
    unit: 'case',
    unitCost: null,
    amount: 84.64,
  }, formatMoney);

  assert.equal(
    result,
    '1 case · Purchase price unresolved'
  );
});

test('ordinary purchases retain their documented case pricing', () => {
  const result = invoicePurchaseSummary({
    purchaseQuantity: 2,
    purchaseUnit: 'case',
    purchaseUnitPrice: 40,
    qty: '20 lb',
    unit: 'lb',
    unitCost: 4,
    amount: 80,
  }, formatMoney);

  assert.equal(result, '2 case @ $40.00/case');
});

test('missing unit prices never fall back to invoice totals', () => {
  const result = invoicePurchaseSummary({
    purchaseQuantity: 1,
    purchaseUnit: 'case',
    purchaseUnitPrice: null,
    qty: '1 case',
    unit: 'case',
    unitCost: null,
    amount: 150,
  }, formatMoney);

  assert.equal(
    result,
    '1 case · Purchase price unresolved'
  );

  assert.equal(result.includes('$150'), false);
});
