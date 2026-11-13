import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsRevenue, analyticsDishMetrics } from '../lib/analyticsReporting.js';

test('reported revenue takes priority over current selling price', () => {
  assert.equal(analyticsRevenue({ revenue: 80, quantity_sold: 10, unit_price: 12 }, 15), 80);
});

test('explicit zero POS revenue and prices are preserved', () => {
  assert.equal(analyticsRevenue({ revenue: 0, quantity_sold: 10 }, 15), 0);
  assert.equal(analyticsRevenue({ quantity_sold: 10, unit_price: 0 }, 15), 0);
});

test('missing revenue uses recorded POS price before the menu fallback', () => {
  assert.equal(analyticsRevenue({ quantity_sold: 10, unit_price: 8 }, 15), 80);
  assert.equal(analyticsRevenue({ quantity_sold: 10 }, 15), 150);
});

test('different selling prices use summed revenue rather than the last price', () => {
  const dish = analyticsDishMetrics({ qty: 20, rev: 190, cogs: 60, cost: 3, price: 12 });
  assert.equal(dish.contribTotal, 130);
  assert.equal(dish.contribPer, 6.5);
  assert.equal(dish.price, 9.5);
  assert.equal(dish.foodCostPct, 60 / 190 * 100);
});

test('discounted revenue reconciles contribution with the period total', () => {
  const dish = analyticsDishMetrics({ qty: 10, rev: 80, cogs: 30, cost: 3, price: 12 });
  assert.equal(dish.contribTotal, 50);
  assert.equal(dish.contribPer, 5);
  assert.equal(dish.foodCostPct, 37.5);
});

test('missing costs cannot turn partial costing into a full contribution', () => {
  for (const data of [{ cost: null }, { cost: 3, costMissing: true }]) {
    const dish = analyticsDishMetrics({ qty: 10, rev: 80, cogs: 30, ...data });
    assert.equal(dish.contribTotal, null);
    assert.equal(dish.foodCostPct, null);
  }
});

test('a verified zero recipe cost remains a usable observation', () => {
  const dish = analyticsDishMetrics({ qty: 10, rev: 80, cogs: 0, cost: 0 });
  assert.equal(dish.contribTotal, 80);
  assert.equal(dish.foodCostPct, 0);
});

test('zero sales cannot invent per-plate economics', () => {
  const dish = analyticsDishMetrics({ qty: 0, rev: 0, cogs: 0, cost: 3, price: 12 });
  assert.equal(dish.contribPer, null);
  assert.equal(dish.foodCostPct, null);
});
