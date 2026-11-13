import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceComparisons } from '../lib/invoiceComparisons.js';
import { invoicePriceChange } from '../lib/invoiceDisplayPricing.js';

const RID = 'comparison-restaurant';
const invoice = { id: 'current' };
const row = { id: 'current-line', ingredientId: 'beef', unitCost: 4.8, unit: 'lb' };
const purchase = (id, invoiceId, date, cost, extra = {}) => ({
  id, invoice_id: invoiceId, ingredient_id: 'beef', display_unit_cost: cost,
  invoices: { id: invoiceId, restaurant_id: RID, date: '2026-01-01', delivery_date: date,
    created_at: '2026-11-13T12:00:00Z', supplier: 'Supplier', number: invoiceId, ...extra },
});
const current = () => purchase('current-line', 'current', '2026-11-12', 0.3);
const compare = (items, rows = [row]) => invoiceComparisons(invoice, rows, {
  restaurantId: RID, today: '2026-11-13', items,
}, RID)[0];

test('previous price follows delivery date rather than printed invoice date', () => {
  const result = compare([
    current(),
    purchase('older', 'old', '2026-11-09', 0.2, { date: '2026-11-12' }),
    purchase('previous', 'previous', '2026-11-11', 0.25, { date: '2026-10-01' }),
  ]);
  assert.equal(result.prevDate, '2026-11-11');
  assert.equal(result.prevUnitCost, 0.25);
});

test('price changes use the shared ingredient-unit basis and preserve purchase prices', () => {
  const result = compare([current(), purchase('previous', 'previous', '2026-11-11', 0.25)]);
  assert.equal(result.unitCost, 4.8);
  assert.equal(result.unit, 'lb');
  assert.ok(Math.abs(invoicePriceChange(result) - 20) < 1e-9);
});

test('unresolved current or prior pricing cannot trigger comparisons', () => {
  assert.equal(compare([{ ...current(), display_unit_cost: null },
    purchase('previous', 'previous', '2026-11-11', 0.25)]).prevUnitCost, null);
  assert.equal(compare([current(),
    purchase('previous', 'previous', '2026-11-11', null)]).prevUnitCost, null);
  assert.equal(invoicePriceChange({ unitCost: 4.8, comparisonUnitCost: null, prevUnitCost: 0.25 }), null);
});

test('future, unknown, and same-day deliveries do not invent an earlier delivery date', () => {
  for (const date of ['2026-11-14', null, '2026-02-30']) {
    assert.equal(compare([purchase('current-line', 'current', date, 0.3),
      purchase('previous', 'previous', '2026-11-11', 0.25)]).prevDate, null);
  }
  assert.equal(compare([current(), purchase('same-day', 'same-day', '2026-11-12', 0.2)]).prevDate, null);
});

test('cross-restaurant records and responses are rejected', () => {
  assert.equal(compare([current(), purchase('other', 'other', '2026-11-11', 0.2,
    { restaurant_id: 'other' })]).prevDate, null);
  assert.throws(() => invoiceComparisons(invoice, [row], {
    restaurantId: 'other', today: '2026-11-13', items: [],
  }, RID));
});

test('duplicate invoice numbers from the same supplier do not manufacture a comparison', () => {
  assert.equal(compare([current(), purchase('copy', 'copy', '2026-11-11', 0.2,
    { number: 'current' })]).prevDate, null);
});

test('conflicting prior prices for the same ingredient stay unresolved', () => {
  const result = compare([current(),
    purchase('prior-a', 'previous', '2026-11-11', 0.2),
    purchase('prior-b', 'previous', '2026-11-11', 0.25),
  ]);
  assert.equal(result.prevDate, null);
});

test('stale comparisons are cleared without changing input records', () => {
  const stale = { ...row, prevUnitCost: 99, prevDate: 'OLD', comparisonUnitCost: 99 };
  const result = compare([], [stale]);
  assert.equal(result.prevUnitCost, null);
  assert.equal(result.prevDate, null);
  assert.equal(stale.prevUnitCost, 99);
});
