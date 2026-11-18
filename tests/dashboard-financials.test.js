import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardDishFinancials, dashboardMarginStats, loadDashboardMenuItems } from '../lib/dashboardFinancials.js';

const rid = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function fixture() {
  const ingredient = { id: 'beef', restaurant_id: rid, name: 'Ground Beef', unit: 'oz',
    last_price: 0.5, is_estimated: false, price_status: 'invoice',
    ingredient_unit_conversions: [], ingredient_conversion_default_links: [] };
  const line = { quantity: 0.125, unit: 'lb', ingredients: ingredient };
  const item = { id: 'dish', restaurant_id: rid, name: 'Validation Burger', price: 10, cost: 999,
    menu_item_components: [{ component_ingredients: [line] }] };
  return { ingredient, line, item };
}

test('recipe units produce a $1 plate, $9 contribution, 10% food cost and 90% gross margin', () => {
  const { item } = fixture();
  assert.deepEqual(dashboardDishFinancials(item), { price: 10, cost: 1, contribution: 9,
    foodCostPct: 10, marginPct: 90, estimated: false });
});

test('the current recipe overrides a stale stored menu cost', () => {
  const { item, ingredient } = fixture();
  ingredient.last_price = 0.75;
  assert.equal(dashboardDishFinancials(item).cost, 1.5);
});

test('all components contribute and rounding occurs once for the complete plate', () => {
  const { item, line, ingredient } = fixture();
  ingredient.last_price = 0.333;
  line.quantity = 1;
  line.unit = 'oz';
  item.menu_item_components.push({ component_ingredients: [{ ...line }] });
  assert.equal(dashboardDishFinancials(item).cost, 0.67);
});

test('approved estimates remain usable and are explicitly identified', () => {
  const { item, ingredient } = fixture();
  ingredient.is_estimated = true;
  ingredient.price_approved_at = '2026-11-01T12:00:00Z';
  assert.equal(dashboardDishFinancials(item).cost, 1);
  assert.equal(dashboardDishFinancials(item).estimated, true);
});

test('unapproved AI prices do not create a margin', () => {
  const { item, ingredient } = fixture();
  ingredient.is_estimated = true;
  assert.equal(dashboardDishFinancials(item).marginPct, null);
});

test('an invalid approval timestamp cannot authorize an estimate', () => {
  const { item, ingredient } = fixture();
  ingredient.is_estimated = true;
  ingredient.price_approved_at = 'invalid';
  assert.equal(dashboardDishFinancials(item).cost, null);
});

test('needs-review pricing blocks both old invoice prices and approved estimates', () => {
  for (const estimated of [true, false]) {
    const { item, ingredient } = fixture();
    Object.assign(ingredient, { price_status: 'needs_review', is_estimated: estimated,
      price_approved_at: '2026-11-01T12:00:00Z' });
    assert.equal(dashboardDishFinancials(item).cost, null);
  }
});

for (const field of ['quantity', 'last_price']) {
  test(`missing, malformed, negative, or nonfinite ${field} cannot become zero`, () => {
    for (const value of [null, undefined, '', ' ', 'bad', false, [], -1, NaN, Infinity]) {
      const { item, line, ingredient } = fixture();
      (field === 'quantity' ? line : ingredient)[field] = value;
      assert.equal(dashboardDishFinancials(item).cost, null);
    }
  });
}

test('numeric strings calculate normally', () => {
  const { item, line, ingredient } = fixture();
  line.quantity = '0.125';
  ingredient.last_price = '0.5';
  item.price = '10';
  assert.equal(dashboardDishFinancials(item).cost, 1);
});

test('an explicitly free verified ingredient produces a valid 100% gross margin', () => {
  const { item, ingredient } = fixture();
  ingredient.last_price = 0;
  assert.equal(dashboardDishFinancials(item).cost, 0);
  assert.equal(dashboardDishFinancials(item).marginPct, 100);
});

test('explicit zero recipe quantity matches the canonical zero-contribution rule', () => {
  const { item, line, ingredient } = fixture();
  line.quantity = 0;
  ingredient.last_price = null;
  ingredient.is_estimated = true;
  assert.equal(dashboardDishFinancials(item).cost, 0);
});

test('a missing recipe unit uses the ingredient price unit', () => {
  const { item, line } = fixture();
  line.unit = ' ';
  line.quantity = 2;
  assert.equal(dashboardDishFinancials(item).cost, 1);
});

test('a local piece-weight conversion calculates the verified cost', () => {
  const { item, line, ingredient } = fixture();
  line.quantity = 1;
  line.unit = 'each';
  ingredient.ingredient_unit_conversions = [{ ingredient_id: ingredient.id,
    from_unit: 'each', to_unit: 'oz', factor: 4, basis: 'measured' }];
  assert.equal(dashboardDishFinancials(item).cost, 2);
});

test('unsupported, estimated, foreign, or conflicting conversions remain unavailable', () => {
  for (const mode of ['missing', 'estimated', 'foreign', 'conflicting']) {
    const { item, line, ingredient } = fixture();
    line.quantity = 1;
    line.unit = 'each';
    const conversion = { ingredient_id: ingredient.id, from_unit: 'each', to_unit: 'oz',
      factor: 4, basis: 'measured' };
    if (mode !== 'missing') ingredient.ingredient_unit_conversions = [conversion];
    if (mode === 'estimated') conversion.basis = 'estimated';
    if (mode === 'foreign') conversion.ingredient_id = 'unrelated';
    if (mode === 'conflicting') ingredient.ingredient_unit_conversions.push({ ...conversion, factor: 8 });
    assert.equal(dashboardDishFinancials(item).cost, null);
  }
});

test('unknown density conversions cannot authorize a financial cost', () => {
  const { item, line } = fixture();
  line.unit = 'fl oz';
  assert.equal(dashboardDishFinancials(item).cost, null);
});

test('missing recipe, mapping, unit, or tenant context fails closed', () => {
  for (const mutate of [f => { f.item.menu_item_components = []; },
    f => { f.line.ingredients = null; }, f => { f.ingredient.unit = null; },
    f => { delete f.item.restaurant_id; }, f => { f.ingredient.restaurant_id = other; },
    f => { f.item.menu_item_components = [{}]; }]) {
    const f = fixture();
    mutate(f);
    assert.equal(dashboardDishFinancials(f.item).cost, null);
  }
  assert.equal(dashboardDishFinancials(fixture().item, { restaurantId: other }).cost, null);
});

test('legacy flat recipes work only when component recipes do not exist', () => {
  const { item, line } = fixture();
  item.menu_item_ingredients = [{ ...line, quantity: 100, unit: undefined }];
  assert.equal(dashboardDishFinancials(item).cost, 1);
  item.menu_item_components = [];
  assert.equal(dashboardDishFinancials(item).cost, 50);
});

test('missing, zero, negative, or invalid menu prices never produce percentages or contribution', () => {
  for (const price of [null, '', '10bad', 0, -1, Infinity]) {
    const { item } = fixture();
    item.price = price;
    const metrics = dashboardDishFinancials(item);
    assert.equal(metrics.cost, 1);
    assert.equal(metrics.marginPct, null);
    assert.equal(metrics.foodCostPct, null);
    assert.equal(metrics.contribution, null);
  }
});

test('loss-making dishes retain their negative margin and contribution', () => {
  const { item, ingredient } = fixture();
  ingredient.last_price = 6;
  const metrics = dashboardDishFinancials(item);
  assert.equal(metrics.contribution, -2);
  assert.equal(metrics.foodCostPct, 120);
  assert.equal(metrics.marginPct, -20);
});

test('arithmetic overflow cannot produce infinite financial percentages', () => {
  const { item } = fixture();
  item.price = Number.MIN_VALUE;
  const metrics = dashboardDishFinancials(item);
  assert.equal(metrics.cost, 1);
  assert.equal(metrics.marginPct, null);
  assert.equal(metrics.foodCostPct, null);
  assert.equal(dashboardMarginStats([item]).pricedCount, 0);
});

test('summary is a mean of priced dish margins with explicit estimate and missing counts', () => {
  const first = fixture(), second = fixture(), missing = fixture();
  first.ingredient.last_price = 3;
  second.ingredient.last_price = 4;
  second.ingredient.is_estimated = true;
  second.ingredient.price_approved_at = '2026-11-01T12:00:00Z';
  missing.ingredient.last_price = null;
  const stats = dashboardMarginStats([first.item, second.item, missing.item], { restaurantId: rid });
  close(stats.avgMargin, 30);
  assert.deepEqual({ ...stats, avgMargin: 30 }, { avgMargin: 30, lowMargin: 2, pctAbove50: 0,
    pctBelow25: 0.5, pricedCount: 2, totalCount: 3, unpricedCount: 1, estimatedCount: 1 });
});

test('the 50% and 25% distribution boundaries remain inclusive and exclusive respectively', () => {
  const a = fixture(), b = fixture();
  a.ingredient.last_price = 2.5;
  b.ingredient.last_price = 3.75;
  const stats = dashboardMarginStats([a.item, b.item]);
  assert.equal(stats.lowMargin, 1);
  assert.equal(stats.pctAbove50, 0.5);
  assert.equal(stats.pctBelow25, 0);
});

test('an unpriced or empty menu has no invented average margin', () => {
  assert.equal(dashboardMarginStats([]).avgMargin, null);
  const { item, ingredient } = fixture();
  ingredient.last_price = null;
  assert.equal(dashboardMarginStats([item]).avgMargin, null);
  assert.equal(dashboardMarginStats([item]).unpricedCount, 1);
});

test('only the explicit tour option trusts a sample stored cost', () => {
  const item = { price: 10, cost: 3 };
  assert.equal(dashboardDishFinancials(item).cost, null);
  assert.equal(dashboardDishFinancials(item, { sample: true }).marginPct, 70);
  assert.equal(dashboardDishFinancials(item, { sample: true }).estimated, true);
});

function pagedDb(count, { short = 500, failAt = -1, invalidAt = -1, foreignAt = -1 } = {}) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, filters: [] };
    calls.push(call);
    return {
      select(value) { call.select = value; return this; },
      eq(key, value) { call.filters.push([key, value]); return this; },
      is(key, value) { call.filters.push([key, value]); return this; },
      order(key, value) { call.order = [key, value]; return this; },
      async range(from, to) {
        call.range = [from, to];
        if (calls.length - 1 === failAt) return { error: new Error('Synthetic recipe read failure') };
        if (calls.length - 1 === invalidAt) return { data: null };
        return { data: Array.from({ length: Math.max(0, Math.min(count - from, to - from + 1, short)) },
          (_, index) => ({ id: String(from + index), restaurant_id: calls.length - 1 === foreignAt ? other : rid })) };
      },
    };
  } };
}

for (const [count, short] of [[1001, 500], [10001, 500], [1001, 37]]) {
  test(`complete recipe read of ${count} dishes with server pages of ${short}`, async () => {
    const db = pagedDb(count, { short });
    const rows = await loadDashboardMenuItems(db, rid);
    assert.equal(rows.length, count);
    assert.equal(new Set(rows.map(row => row.id)).size, count);
    assert.equal(db.calls.at(-1).range[0], count);
    for (const call of db.calls) {
      assert.equal(call.table, 'menu_items');
      assert.deepEqual(call.filters, [['restaurant_id', rid], ['archived_at', null]]);
      assert.deepEqual(call.order, ['id', { ascending: true }]);
      assert.match(call.select, /price_status/);
      assert.match(call.select, /menu_item_ingredients/);
    }
  });
}

for (const failAt of [0, 1]) {
  test(`page ${failAt + 1} failure cannot return partial or empty successful financial data`, async () => {
    await assert.rejects(loadDashboardMenuItems(pagedDb(1001, { failAt }), rid), /recipe read failure/);
  });
}

test('null and foreign-tenant recipe responses are rejected on any page', async () => {
  for (const page of [0, 1]) {
    await assert.rejects(loadDashboardMenuItems(pagedDb(1001, { invalidAt: page }), rid), /Invalid/);
    await assert.rejects(loadDashboardMenuItems(pagedDb(1001, { foreignAt: page }), rid), /Invalid/);
  }
});

test('missing restaurant context cannot issue a recipe read', async () => {
  const db = pagedDb(1);
  await assert.rejects(loadDashboardMenuItems(db, null), /restaurant ID/);
  assert.equal(db.calls.length, 0);
});