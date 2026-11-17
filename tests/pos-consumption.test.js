import test from 'node:test';
import assert from 'node:assert/strict';
import { posFixture } from '../scripts/validate-pos-consumption.mjs';
import { compile } from '../lib/recipes/compile.js';
import { dishInstructions, foodUnits, requestTexts, verifyCoverage } from '../lib/pos/usageMath.js';
import { rawRecipe, adjustRecipe, inventoryPortions, simplePlan, combinePieces } from '../lib/pos/usageRecipe.js';
import { inventoryPosInputs } from '../lib/pos/usageInventory.js';

const fixture = () => posFixture({
  restaurantId: '11111111-1111-4111-8111-111111111111',
  mustardId: '22222222-2222-4222-8222-222222222222', today: '2026-11-16',
});
const totals = (parts, f) => Object.fromEntries(
  ['beef', 'chicken', 'bun', 'onion', 'mustard'].map(key => [key,
    parts.filter(part => part.id === f.ids[key]).reduce((sum, part) => sum + part.quantity, 0)]));
const changes = (f, operations) => inventoryPortions(adjustRecipe(f.recipe,
  { operations, unresolved: [] }, f.catalog), f.catalog);

test('batch yield expands to measured portions and preserves shared onion components', () => {
  const f = fixture();
  assert.equal(f.compiled.length, 5);
  assert.deepEqual(totals(inventoryPortions(f.recipe, f.catalog), f),
    { beef: 6, chicken: 0, bun: 1, onion: 1, mustard: 2 });
  const onions = f.compiled.filter(row => row.ingredient_id === f.ids.onion);
  assert.deepEqual(onions.map(row => row.quantity), [0.5, 0.5]);
  assert.notEqual(onions[0].component, onions[1].component);
});

test('nested prep yields scale through both batches', () => {
  const nodes = [
    { id: 'inner', name: 'Inner', kind: 'prep', published: { yield_quantity: 8,
      yield_unit: 'fl oz', lines: [{ name: 'Mustard', ingredient_id: 'mustard', quantity: 8, unit: 'fl oz' }] } },
    { id: 'outer', name: 'Outer', kind: 'prep', published: { yield_quantity: 16,
      yield_unit: 'fl oz', lines: [{ prep_id: 'inner', quantity: 4, unit: 'fl oz' }] } },
    { id: 'dish', name: 'Dish', kind: 'dish', published: {
      lines: [{ prep_id: 'outer', quantity: 2, unit: 'fl oz' }] } },
  ];
  assert.equal(compile(nodes, 'dish')[0].quantity, 0.5);
});

test('circular and unconfirmed batches reject rather than fabricate consumption', () => {
  assert.throws(() => compile([{ id: 'prep', kind: 'prep', name: 'Loop', published: {
    yield_quantity: 1, yield_unit: 'oz', lines: [{ prep_id: 'prep', quantity: 1, unit: 'oz' }],
  } }], 'prep'), /cannot contain itself/);
  assert.throws(() => compile([{ id: 'prep', name: 'Draft' }], 'prep'), /Confirm the batch/);
});

test('raw recipe retains repeated ingredient lines before modifier adjustment', () => {
  const f = fixture();
  const menu = { menu_item_components: f.compiled.map(row => ({ name: row.component,
    component_ingredients: [{ quantity: row.quantity, unit: row.unit,
      ingredients: { id: row.ingredient_id } }] })) };
  assert.equal(rawRecipe(menu, f.catalog).filter(row => row.id === f.ids.onion).length, 2);
});

test('repeated no-onion requests remove that ingredient once across components', () => {
  const f = fixture();
  const plan = simplePlan(f.recipe, { requests: ['no onion', 'no onion'], modifiers: [] }, f.catalog);
  assert.equal(plan.operations.length, 1);
  assert.deepEqual(totals(changes(f, plan.operations), f),
    { beef: 6, chicken: 0, bun: 1, onion: 0, mustard: 2 });
});

test('extra portions add to the existing recipe quantity', () => {
  const f = fixture();
  assert.equal(totals(changes(f, f.requests[0].operations), f).beef, 12);
});

test('explicit substitution removes beef and adds the configured chicken portion', () => {
  const f = fixture();
  assert.deepEqual(totals(changes(f, f.requests[1].operations), f),
    { beef: 0, chicken: 6, bun: 1, onion: 1, mustard: 2 });
});

test('a final set quantity replaces the total across repeated component contributions', () => {
  const f = fixture();
  assert.equal(totals(changes(f, [{ action: 'set', ingredient_id: f.ids.onion,
    quantity: 0.75, unit: 'oz', basis: 'configured' }]), f).onion, 0.75);
});

test('ingredient-specific unit conversions apply before shared totals are combined', () => {
  const f = fixture();
  const portions = inventoryPortions([{ id: f.ids.beef, quantity: 0.5, unit: 'lb' },
    { id: f.ids.mustard, quantity: 1, unit: 'cup' }], f.catalog);
  assert.equal(totals(portions, f).beef, 8);
  assert.equal(totals(portions, f).mustard, 8);
});

test('unresolved instructions block usage without mutating the recipe', () => {
  const f = fixture();
  const before = structuredClone(f.recipe);
  assert.throws(() => adjustRecipe(f.recipe, { operations: [], unresolved: ['Specify the portion'] },
    f.catalog), /Specify the portion/);
  assert.deepEqual(f.recipe, before);
});

test('a foreign ingredient cannot enter the restaurant usage recipe', () => {
  const f = fixture();
  assert.throws(() => changes(f, [{ action: 'add', ingredient_id: 'foreign', quantity: 1,
    unit: 'oz', basis: 'configured' }]), /quantity and unit/);
  assert.throws(() => inventoryPortions([{ id: 'foreign', quantity: 1, unit: 'oz' }], f.catalog), /Link the ingredient/);
});

test('unsupported count-to-weight conversion fails without an ingredient factor', () => {
  const f = fixture();
  assert.throws(() => inventoryPortions([{ id: f.ids.beef, quantity: 1, unit: 'each' }], f.catalog));
});

test('contradictory learned requests require review', () => {
  const f = fixture();
  assert.throws(() => combinePieces([
    { id: 'remove', operations: [{ action: 'remove', ingredient_id: f.ids.onion }] },
    { id: 'add', operations: [{ action: 'add', ingredient_id: f.ids.onion, quantity: 1 }] },
  ]), /takes an ingredient off/);
});

test('modifier and typed-request duplicates normalize to one request', () => {
  const instructions = dishInstructions({ specialRequests: ['No Onion'], ticketItemModifiers: [
    { name: 'Sandwich No: Onion', quantity: 1, specialRequests: [] },
    { name: 'Extra Beef', type: 'void', specialRequests: [] },
  ] });
  assert.deepEqual(requestTexts(instructions), ['no onion']);
});

test('unavailable typed requests remain distinguishable from retrieved empty requests', () => {
  assert.equal(dishInstructions({}).requests, null);
  assert.deepEqual(dishInstructions({ specialRequests: [] }).requests, []);
  assert.throws(() => dishInstructions({ specialRequests: [null] }), /Invalid typed requests/);
});

test('refunds, open checks, and non-food lines create no newly prepared servings', () => {
  const item = { type: 'sale', quantity: 2 };
  assert.equal(foodUnits({ ticket_type: 'closed' }, item), 2);
  assert.equal(foodUnits({ ticket_type: 'open' }, item), 0);
  assert.equal(foodUnits({}, { ...item, type: 'refund', quantity: -2 }), 0);
  assert.equal(foodUnits({}, { ...item, isNonSalesRevenue: true }), 0);
});

test('employee-error waste consumes food while a pre-preparation void does not', () => {
  assert.equal(foodUnits({}, { type: 'void', quantity: 2, voidReason: 'employee error' }), 2);
  assert.equal(foodUnits({}, { type: 'void', quantity: 2, voidReason: 'customer changed mind' }), 0);
  assert.throws(() => foodUnits({}, { type: 'void', quantity: 1 }), /Unmapped void reason/);
});

test('unsupported dish quantities reject rather than round silently', () => {
  for (const quantity of [NaN, Infinity, -1, 0.5, 101]) {
    assert.throws(() => foodUnits({}, { type: 'sale', quantity }), /Unsupported dish quantity/);
  }
});

test('the explicit eight-ticket fixture reconciles net sales and refunds', () => {
  const f = fixture();
  assert.doesNotThrow(() => verifyCoverage({ tickets: f.tickets, sales: [{ sale_date: '2026-11-16',
    item_name: 'Validation Burger', quantity_sold: 6, refunds: 1, voids: 0 }] }));
});

test('missing, excessive, or wrong-date aggregated sales fail coverage', () => {
  const f = fixture();
  const row = { sale_date: '2026-11-16', item_name: 'Validation Burger', quantity_sold: 6, refunds: 1 };
  for (const sales of [[], [{ ...row, quantity_sold: 7 }], [{ ...row, sale_date: '2026-11-15' }]]) {
    assert.throws(() => verifyCoverage({ tickets: f.tickets, sales }), /disagree/);
  }
});

function inputDb({ enabled = true, usable = true, revision = 'current', savedRevision = revision,
  error = null } = {}) {
  const scope = [];
  const result = { usable, source_revision: savedRevision, sales: [
    { id: 'prepared', sale_date: '2026-11-16' }, { id: 'future', sale_date: '2026-11-17' },
  ], recipes: [{ id: 'prepared' }, { id: 'future' }] };
  return { scope, from(table) {
    return { select() { return this; }, eq(column, value) { scope.push([table, column, value]); return this; },
      async maybeSingle() { return { error, data: table === 'pos_usage_settings'
        ? { enabled, start_date: '2026-11-16' } : result }; } };
  }, async rpc(name, args) { scope.push([name, args.p_restaurant_id]);
    return { data: { revision }, error }; } };
}

test('prepared servings replace covered Shift4 sales and retain other sources', async () => {
  const db = inputDb();
  const rows = [
    { id: 'covered', pos_system: 'shift4', sale_date: '2026-11-16', upload_session_id: null },
    { id: 'historical', pos_system: 'shift4', sale_date: '2026-11-15' },
    { id: 'manual', pos_system: 'shift4', sale_date: '2026-11-16', upload_session_id: 'upload' },
    { id: 'square', pos_system: 'square', sale_date: '2026-11-16' },
  ];
  const inputs = await inventoryPosInputs(db, 'tenant', '2026-11-16', rows, [{ id: 'menu' }]);
  assert.deepEqual(inputs.posSales.map(row => row.id), ['historical', 'manual', 'square', 'prepared']);
  assert.ok(db.scope.every(row => row.at(-1) === 'tenant'));
});

test('disabled and not-yet-started usage retain the original sales', async () => {
  const rows = [{ id: 'original' }];
  for (const [db, date] of [[inputDb({ enabled: false }), '2026-11-16'], [inputDb(), '2026-11-15']]) {
    assert.deepEqual((await inventoryPosInputs(db, 'tenant', date, rows, [])).posSales, rows);
  }
});

test('unusable or stale publications preserve inventory by failing visibly', async () => {
  for (const options of [{ usable: false }, { savedRevision: 'old' }]) {
    await assert.rejects(inventoryPosInputs(inputDb(options), 'tenant', '2026-11-16', [], []), /Inventory preserved/);
  }
});

test('database read failures propagate instead of becoming zero usage', async () => {
  await assert.rejects(inventoryPosInputs(inputDb({ error: new Error('database unavailable') }),
    'tenant', '2026-11-16', [], []), /database unavailable/);
});