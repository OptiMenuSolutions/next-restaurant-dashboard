import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ingredientPurchaseRows, purchaseAge, purchaseAmount,
  ingredientDisplayPrice, ingredientPurchaseUnitCost,
} from '../lib/ingredientPurchasing.js';
import { createPurchaseHistoryHandler } from '../pages/api/ingredients/purchase-history.js';

const RID = 'purchase-restaurant';
const ingredient = { id: 'beef', restaurant_id: RID, unit: 'oz' };
const line = (overrides = {}) => ({
  id: 'line-1', invoice_id: 'invoice-1', ingredient_id: 'beef',
  restaurant_id: RID, item_name: 'Beef', quantity: 10,
  unit: 'lb', unit_cost: 4, amount: 40,
  invoices: {
    id: 'invoice-1', restaurant_id: RID,
    date: '2026-10-31', delivery_date: '2026-11-01',
  },
  ...overrides,
});
const verified = () => line({
  price_verification_status: 'verified',
  price_verification_source: 'supplier',
  price_verified_at: '2026-11-01T12:00:00Z',
  price_verification_evidence: { source: 'supplier' },
});

test('delivery date controls eligibility without changing the invoice date', () => {
  const original = line();
  assert.equal(ingredientPurchaseRows([original], RID, '2026-10-31').length, 0);
  const [row] = ingredientPurchaseRows([original], RID, '2026-11-01');
  assert.equal(row.invoices.effective_date, '2026-11-01');
  assert.equal(row.invoices.date, '2026-10-31');
  assert.equal(original.invoices.effective_date, undefined);
});

test('fallback, unknown dates, malformed dates and tenant isolation', () => {
  const inputs = [
    line({ id: 'fallback', invoices: { restaurant_id: RID, date: '2026-10-31' } }),
    line({ id: 'unknown', invoices: { restaurant_id: RID } }),
    line({ id: 'invalid', invoices: { restaurant_id: RID, date: '2026-10-31', delivery_date: '2026-02-30' } }),
    line({ id: 'other', invoices: { restaurant_id: 'other', date: '2026-10-31' } }),
  ];
  assert.deepEqual(ingredientPurchaseRows(inputs, RID, '2026-11-01').map(r => r.id), ['fallback']);
  assert.throws(() => ingredientPurchaseRows([], RID, null));
});

test('late uploads are ordered by delivery date with stable ties', () => {
  const rows = [
    line({ id: 'old', invoices: { restaurant_id: RID, date: '2026-01-01', created_at: '2026-11-13' } }),
    line({ id: 'a' }), line({ id: 'b' }),
  ];
  assert.deepEqual(ingredientPurchaseRows(rows, RID, '2026-11-13').map(r => r.id), ['b', 'a', 'old']);
});

test('calendar windows ignore browser timezone and DST duration', () => {
  assert.equal(purchaseAge('2026-11-02', '2026-11-01'), 1);
  assert.equal(purchaseAge('2026-03-09', '2026-03-08'), 1);
  assert.equal(purchaseAge('2026-11-01', '2026-10-03'), 29);
  assert.equal(purchaseAge('2026-11-01', '2026-10-02'), 30);
  assert.equal(purchaseAge('2026-11-01', null), null);
});

test('explicit zero totals are preserved', () => {
  assert.equal(purchaseAmount({ amount: 0, quantity: 10, unit_cost: 4 }), 0);
  assert.equal(purchaseAmount({ amount: null, quantity: 10, unit_cost: 4 }), 40);
});

test('current display price preserves approvals and unresolved values', () => {
  assert.equal(ingredientDisplayPrice({ last_price: 2, is_estimated: true, price_approved_at: '2026-11-01' }), 2);
  assert.equal(ingredientDisplayPrice({ last_price: 9, is_estimated: true }), null);
  assert.equal(ingredientDisplayPrice({ last_price: 9, is_estimated: false, price_status: 'needs_review' }), null);
  assert.equal(ingredientDisplayPrice({ last_price: 0, is_estimated: false }), 0);
  assert.equal(ingredientDisplayPrice({ last_price: null, is_estimated: false }), null);
});

test('physical conversion requires verified source and compatible units', () => {
  assert.equal(ingredientPurchaseUnitCost(verified(), ingredient), 0.25);
  assert.equal(ingredientPurchaseUnitCost(line(), ingredient), null);
  assert.equal(ingredientPurchaseUnitCost(verified(), { ...ingredient, restaurant_id: 'other' }), null);
  assert.equal(ingredientPurchaseUnitCost(verified(), { ...ingredient, unit: 'fl oz' }), null);
  assert.equal(ingredientPurchaseUnitCost({ ...verified(), unit: 'case' }, ingredient), null);
});

function response() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('purchase endpoint rejects unauthenticated requests before database reads', async () => {
  const handler = createPurchaseHistoryHandler({
    db: { from() { throw new Error('Database must not be read'); } },
    verifyOwner: async () => ({ error: 'Unauthorized', status: 401 }),
  });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('purchase endpoint rejects writes', async () => {
  const res = response();
  await createPurchaseHistoryHandler()({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
});

test('server report scopes reads and handles shortened pages without exposing evidence', async () => {
  const tables = {
    ingredients: [ingredient],
    invoice_items: [verified(), { ...verified(), id: 'line-2' }],
    invoice_supported_price_evidence: [],
  };
  const db = {
    from(table) {
      const filters = [];
      const q = {
        select() { return q; },
        eq(key, value) { filters.push([key, value]); return q; },
        not() { return q; }, is() { return q; }, order() { return q; },
        async maybeSingle() {
          assert.equal(table, 'restaurants');
          assert.deepEqual(filters, [['id', RID]]);
          return { data: { id: RID, operational_timezone: 'America/New_York' }, error: null };
        },
        async range(from) {
          const key = table === 'invoice_items' ? 'invoices.restaurant_id' : 'restaurant_id';
          assert.deepEqual(filters, [[key, RID]]);
          return { data: tables[table].slice(from, from + 1), error: null };
        },
      };
      return q;
    },
  };
  const res = response();
  await createPurchaseHistoryHandler({
    db, verifyOwner: async () => ({ restaurant: { id: RID } }),
  })({ method: 'GET', query: { restaurant_id: 'other' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.restaurantId, RID);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].display_unit_cost, 0.25);
  assert.equal('price_verification_evidence' in res.body.items[0], false);
});

for (const version of [1, 2]) {
  test('V' + version + ' authenticated evidence remains eligible; invalidated evidence does not', () => {
    const source = line();
    const evidence = {
      invoice_item_id: source.id, invoice_id: source.invoice_id,
      restaurant_id: RID, evidence_version: version,
      source_type: version === 1 ? 'structured_ocr_table' : 'independent_ocr_evidence',
      validation_status: version === 1 ? 'source_table_consistent' : 'source_charge_verified',
      evidence: {
        proof_version: version,
        pricing: { ...source, invoice_item_id: source.id },
      },
    };
    assert.equal(ingredientPurchaseUnitCost(source, ingredient, evidence), 0.25);
    assert.equal(ingredientPurchaseUnitCost(source, ingredient, { ...evidence, invalidated_at: '2026-11-02' }), null);
    assert.equal(ingredientPurchaseUnitCost(source, ingredient, { ...evidence, restaurant_id: 'other' }), null);
  });
}
