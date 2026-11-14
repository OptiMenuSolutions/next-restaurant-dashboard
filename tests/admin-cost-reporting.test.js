import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCostReviewReference, isCostApprovalToday, loadCostReviewHistory,
} from '../lib/admin/costReviewHistory.js';

const RID = 'restaurant-ny';
const NOW = new Date('2026-11-14T06:00:00Z');
const restaurant = { id: RID, operational_timezone: 'America/New_York' };
const ingredient = {
  id: 'beef', restaurant_id: RID, unit: 'oz', last_price: 0.25,
  last_ordered_at: '2026-11-14', is_estimated: false, price_status: 'invoice',
};
const line = (overrides = {}) => ({
  id: 'line-1', invoice_id: 'invoice-1', ingredient_id: 'beef',
  restaurant_id: RID, item_name: 'Beef', quantity: 10,
  unit: 'lb', unit_cost: 4, amount: 40,
  price_verification_status: 'verified', price_verification_source: 'supplier',
  price_verified_at: '2026-11-14T01:00:00Z',
  price_verification_evidence: { source: 'supplier' },
  invoices: { id: 'invoice-1', restaurant_id: RID, date: '2026-11-01', delivery_date: '2026-11-14' },
  ...overrides,
});

function database(items = [], evidence = [], { fail, invalid, cap = 137 } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.ok(['invoice_items', 'invoice_supported_price_evidence'].includes(table));
      const filters = [];
      const q = {
        select() { return q; },
        in(column, values) { filters.push(['in', column, values]); return q; },
        is(column, value) { filters.push(['is', column, value]); return q; },
        order(column) { assert.equal(column, 'id'); return q; },
        async range(from, to) {
          calls.push({ table, from, filters });
          if (fail?.(table, from)) return { data: null, error: { message: 'Synthetic read failure' } };
          if (invalid?.(table, from)) return { data: null, error: null };
          const rows = (table === 'invoice_items' ? items : evidence).filter(row =>
            filters.every(([op, key, value]) => op === 'in' ? value.includes(row[key]) : row[key] == value));
          return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
        },
      };
      return q;
    },
  };
}

const options = { now: NOW, allowSupported: () => false };
const history = (db, ingredients = [ingredient], restaurants = [restaurant], extra = {}) =>
  loadCostReviewHistory(db, ingredients, restaurants, { ...options, ...extra });

test('current references require a usable invoice price and a delivered date', () => {
  const original = structuredClone(ingredient);
  assert.equal(isCostReviewReference(ingredient, restaurant, NOW), true);
  for (const change of [
    { last_ordered_at: '2026-11-15' }, { last_ordered_at: null },
    { last_ordered_at: '2026-02-30' }, { price_status: 'needs_review' },
    { last_price: null }, { last_price: 0 }, { is_estimated: true },
    { price_status: 'approved', price_approved_at: '2026-11-01T12:00:00Z' },
  ]) assert.equal(isCostReviewReference({ ...ingredient, ...change }, restaurant, NOW), false);
  assert.deepEqual(ingredient, original);
});

test('the same instant gives each restaurant its own reference cutoff', () => {
  assert.equal(isCostReviewReference(ingredient, restaurant, NOW), true);
  assert.equal(isCostReviewReference(ingredient, { ...restaurant, operational_timezone: 'America/Los_Angeles' }, NOW), false);
  assert.equal(isCostReviewReference(ingredient, { ...restaurant, id: 'another' }, NOW), false);
});

test('missing and invalid restaurant timezones fail before history reads', async () => {
  const db = { from() { throw new Error('Unexpected database read'); } };
  for (const zone of [null, undefined, 'invalid/zone']) {
    await assert.rejects(history(db, [ingredient], [{ ...restaurant, operational_timezone: zone }]), /time zone/);
  }
  await assert.rejects(history(db, [ingredient], []), /purchase restaurant/);
});

test('delivery dates govern eligibility and old invoice dates do not hide recent deliveries', async () => {
  const items = [
    line({ id: 'recent-delivery', invoices: { ...line().invoices, date: '2025-01-01' } }),
    line({ id: 'future', invoices: { ...line().invoices, delivery_date: '2026-11-15' } }),
    line({ id: 'bad', invoices: { ...line().invoices, delivery_date: '2026-02-30' } }),
    line({ id: 'unknown', invoices: { ...line().invoices, date: null, delivery_date: null } }),
  ];
  const original = structuredClone(items);
  assert.deepEqual((await history(database(items))).get('beef|oz'), [0.25]);
  assert.deepEqual(items, original);
});

test('one report applies a separate local cutoff to each restaurant', async () => {
  const west = { id: 'restaurant-la', operational_timezone: 'America/Los_Angeles' };
  const westIngredient = { ...ingredient, id: 'beef-la', restaurant_id: west.id, last_ordered_at: '2026-11-13' };
  const westLine = line({
    id: 'west-today', ingredient_id: westIngredient.id,
    invoice_id: 'invoice-la', restaurant_id: west.id,
    invoices: { id: 'invoice-la', restaurant_id: west.id, date: '2026-11-13', delivery_date: '2026-11-13' },
  });
  const result = await history(database([
    line(), westLine,
    { ...westLine, id: 'west-tomorrow', invoices: { ...westLine.invoices, delivery_date: '2026-11-14' } },
  ]), [ingredient, westIngredient], [restaurant, west]);
  assert.deepEqual(result.get('beef|oz'), [0.25]);
  assert.deepEqual(result.get('beef-la|oz'), [0.25]);
});

test('invoice-date fallback and the inclusive 180-day boundary are preserved', async () => {
  const date = age => new Date(Date.parse('2026-11-14T00:00:00Z') - age * 86400000).toISOString().slice(0, 10);
  const items = [0, 180, 181].map((age, id) => line({ id: String(id), invoices: {
    ...line().invoices, date: date(age), delivery_date: null,
  } }));
  assert.deepEqual((await history(database(items))).get('beef|oz'), [0.25, 0.25]);
});

test('raw pound and ounce prices are compared in the ingredient unit', async () => {
  const items = [line(), line({ id: 'ounces', quantity: 160, unit: 'oz', unit_cost: 0.25 })];
  assert.deepEqual((await history(database(items))).get('beef|oz'), [0.25, 0.25]);
});

test('unverified, incompatible and mismatched invoice rows cannot support volatility', async () => {
  const items = [
    line({ id: 'unverified', price_verification_status: null }),
    line({ id: 'volume', unit: 'fl oz' }),
    line({ id: 'case', unit: 'case' }),
    line({ id: 'wrong-owner', invoices: { ...line().invoices, restaurant_id: 'other' } }),
    line({ id: 'wrong-invoice', invoice_id: 'other' }),
    line({ id: 'wrong-ingredient', ingredient_id: 'other' }),
  ];
  assert.equal((await history(database(items))).size, 0);
});

function authenticated(source, version, overrides = {}) {
  return {
    id: 'evidence-' + source.id, invoice_item_id: source.id, invoice_id: source.invoice_id,
    restaurant_id: RID, evidence_version: version, invalidated_at: null,
    source_type: version === 1 ? 'structured_ocr_table' : 'independent_ocr_evidence',
    validation_status: version === 1 ? 'source_table_consistent' : 'source_charge_verified',
    evidence: { proof_version: version, pricing: { ...source, invoice_item_id: source.id } },
    ...overrides,
  };
}

for (const version of [1, 2]) {
  test('V' + version + ' evidence requires activation, exact identity and active original pricing', async () => {
    const source = line({ price_verification_status: null });
    const evidence = authenticated(source, version);
    assert.equal((await history(database([source], [evidence]))).size, 0);
    assert.deepEqual((await history(database([source], [evidence]), [ingredient], [restaurant], {
      allowSupported: () => true,
    })).get('beef|oz'), [0.25]);
    for (const change of [
      { invalidated_at: '2026-11-14T01:00:00Z' },
      { invalidation_reason: 'pricing_changed' }, { restaurant_id: 'other' },
      { invoice_id: 'other' },
    ]) assert.equal((await history(database([source], [{ ...evidence, ...change }]), [ingredient], [restaurant], {
      allowSupported: () => true,
    })).size, 0);
  });
}

test('history and evidence reads continue beyond server row limits', async () => {
  const items = Array.from({ length: 1101 }, (_, id) => line({ id: 'line-' + id, price_verification_status: null }));
  const evidence = items.map(source => authenticated(source, 2));
  const db = database(items, evidence);
  assert.equal((await history(db, [ingredient], [restaurant], { allowSupported: () => true })).get('beef|oz').length, 1101);
  for (const table of ['invoice_items', 'invoice_supported_price_evidence']) {
    assert.ok(db.calls.filter(call => call.table === table).length > 2);
  }
});

test('first-page and later-page failures cannot return partial histories', async () => {
  const items = Array.from({ length: 300 }, (_, id) => line({ id: 'line-' + id }));
  const evidence = items.map(source => authenticated(source, 1));
  for (const table of ['invoice_items', 'invoice_supported_price_evidence']) {
    for (const offset of [0, 137]) {
      await assert.rejects(history(database(items, evidence, {
        fail: (name, from) => name === table && from >= offset,
      }), [ingredient], [restaurant], { allowSupported: () => true }), /Synthetic read failure/);
    }
  }
});

test('invalid responses remain visible failures in both history sources', async () => {
  for (const table of ['invoice_items', 'invoice_supported_price_evidence']) {
    await assert.rejects(history(database([], [], { invalid: name => name === table }), [ingredient], [restaurant], {
      allowSupported: () => true,
    }), /Invalid invoice response/);
  }
});

test('Approved today includes Eastern daylight-saving midnight', () => {
  const now = new Date('2026-07-01T16:00:00Z');
  assert.equal(isCostApprovalToday('2026-07-01T04:30:00Z', now), true);
  assert.equal(isCostApprovalToday('2026-07-01T03:59:59Z', now), false);
  assert.equal(isCostApprovalToday('2026-07-01T00:30:00-04:00', now), true);
});

test('Approved today respects winter midnight and rejects future or invalid timestamps', () => {
  assert.equal(isCostApprovalToday('2026-11-14T04:30:00Z', NOW), false);
  assert.equal(isCostApprovalToday('2026-11-14T05:30:00Z', NOW), true);
  for (const value of [null, '', '2026-11-14', 'invalid', '2026-11-14T07:00:00Z']) {
    assert.equal(isCostApprovalToday(value, NOW), false);
  }
});