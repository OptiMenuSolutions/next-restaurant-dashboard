import test from 'node:test';
import { reassessProjectedWasteRisk as reassess } from '../lib/wasteRiskReassessment.js';
import { PROJECTION_DEFAULTS, resolveProjectionSettings } from '../lib/projections/settings.js';
import assert from 'node:assert/strict';
import { assessProjectedWasteRisk as assess } from '../lib/wasteRiskProjection.js';
import { shiftProjectionDate as shift } from '../lib/projections/businessTime.js';

const id = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REST = id(1), ING = id(2), DISH = id(3), MON = '2026-11-23';
const ingredient = (extra = {}) => ({ id: ING, restaurant_id: REST, name: 'Chicken thighs', unit: 'lb', ...extra });
const batch = (n, qty, end, extra = {}) => ({ id: id(n), restaurant_id: REST, ingredient_id: ING,
  received_date: '2026-11-20', use_by_date: end, remaining_qty: qty, unit: 'lb', unit_cost: 4.5, ...extra });

function run(start = MON, lows = [8,8,8,0,0,0,0,0], runId = id(10)) {
  return { id: runId, restaurant_id: REST, run_date: start, issued_at: `${start}T10:00:00Z`,
    source_through: shift(start, -1), model_major: 4, calibration_key: 'v4',
    nights: Array.from({ length: 8 }, (_, i) => ({ business_date: shift(start, i), availability: 'available',
      low: lows[i] ?? 0, dishes: [{ dish_id: DISH, active: true, status: 'ok', share: 1 }] })) };
}

function recipeRows(forecast, portion = 1) {
  return forecast.nights.map(n => ({ restaurant_id: REST, business_date: n.business_date,
    dish_id: DISH, active: true, complete: true,
    portions: [{ ingredient_id: ING, quantity: portion, unit: 'lb' }] }));
}

function input(extra = {}) {
  const f = extra.forecast === undefined ? run() : extra.forecast;
  return { restaurantId: REST, assessmentDate: MON, assessedAt: `${MON}T12:00:00Z`,
    timeZone: 'America/New_York', cutoffMinutes: 240, inventoryCutoff: shift(MON, -1),
    resolvedSettings: resolveProjectionSettings({ restaurantId: REST, at: `${MON}T12:00:00Z`,
      globalVersion: { id: id(90), restaurant_id: null, model_major: 4,
        effective_at: '2020-01-01T00:00:00Z', settings: { ...PROJECTION_DEFAULTS } } }),
    inventoryComplete: true, ingredients: [ingredient()], batches: [batch(20, 30, '2026-11-25')],
    forecast: f, recipes: f ? recipeRows(f) : [], ...extra };
}

function next(previous, batches, extra = {}) {
  return input({ assessmentDate: '2026-11-24', assessedAt: '2026-11-24T12:00:00Z',
    inventoryCutoff: MON, forecast: null, recipes: [], frozen: previous.frozen, batches, ...extra });
}

const risk = (r, n) => r.items.find(i => i.batch_id === id(n));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('acceptance: night low times share-weighted converted portions produces 16 lb', () => {
  const f = run(MON, [80]); f.nights[0].expected = 100; f.nights[0].dishes = [
    { dish_id: DISH, active: true, status: 'ok', share: 0.6, low: 0 },
    { dish_id: id(4), active: true, status: 'ok', share: 0.4, low: 0 },
  ];
  const recipes = recipeRows(f, 0.25);
  recipes[0].portions[0] = { ingredient_id: ING, quantity: 4, unit: 'oz' };
  recipes.push({ ...structuredClone(recipes[0]), dish_id: id(4),
    portions: [{ ingredient_id: ING, quantity: 2, unit: 'oz' }] });
  const r = assess(input({ forecast: f, recipes, batches: [batch(20, 20, MON)] }));
  close(r.demand_trace[0].quantity, 16); close(risk(r, 20).risk_qty, 4);
  assert.equal(r.frozen.demands[0].basis.contributions.length, 2);
});

test('acceptance: 30 lb becomes 28 lb and $126 after 10 used versus 8 allowed', () => {
  const first = assess(input({ forecast: run(MON, [8,4,4,4,4,3,3]), batches: [batch(20, 60, '2026-11-29')] }));
  assert.equal(risk(first, 20).risk_qty, 30);
  const newer = run('2026-11-24', [100,100,100,100,100,100,100,100], id(11));
  const second = assess(next(first, [batch(20, 50, '2026-11-29')], { forecast: newer, recipes: recipeRows(newer, 9) }));
  assert.equal(risk(second, 20).remaining_allowance, 22);
  assert.equal(risk(second, 20).risk_qty, 28); assert.equal(risk(second, 20).risk_value, 126);
  assert.equal(second.new_demands.length, 0); assert.equal(second.new_cases.length, 0);
  assert.deepEqual(second.frozen, first.frozen);
});

test('acceptance: a 2 lb shortfall changes total risk by 2 lb, once', () => {
  const first = assess(input({ batches: [batch(20, 10, '2026-11-24'), batch(21, 20, '2026-11-25')] }));
  assert.equal(risk(first, 20).risk_qty, 0); assert.equal(risk(first, 21).risk_qty, 6);
  const second = assess(next(first, [batch(20, 4, '2026-11-24'), batch(21, 20, '2026-11-25')]));
  assert.equal(risk(second, 20).risk_qty, 0); assert.equal(risk(second, 21).risk_qty, 8);
  assert.equal(second.visible_items.reduce((s, r) => s + r.risk_qty, 0), 8);
});

test('acceptance: cap at remaining stock and release to the next FIFO batch gives 10 lb', () => {
  const first = assess(input({ forecast: run(MON, [0,20]),
    batches: [batch(20, 12, '2026-11-24'), batch(21, 24, '2026-11-24')] }));
  assert.equal(risk(first, 21).risk_qty, 16);
  const second = assess(next(first, [batch(20, 6, '2026-11-24'), batch(21, 24, '2026-11-24')]));
  assert.equal(risk(second, 20).remaining_allowance, 6);
  assert.equal(risk(second, 21).remaining_allowance, 14); assert.equal(risk(second, 21).risk_qty, 10);
});

test('acceptance: discarded batch releases its unused allowance, leaving 4 lb at risk', () => {
  const first = assess(input({ forecast: run(MON, [0,20]),
    batches: [batch(20, 12, '2026-11-24'), batch(21, 24, '2026-11-24')] }));
  for (const stocks of [[batch(20, 0, '2026-11-24'), batch(21, 24, '2026-11-24')], [batch(21, 24, '2026-11-24')]]) {
    const r = assess(next(first, stocks));
    assert.equal(risk(r, 21).remaining_allowance, 20); assert.equal(risk(r, 21).risk_qty, 4);
  }
});

test('sales depletion releases only future allowance, never the elapsed night again', () => {
  const first = assess(input({ forecast: run(MON, [8,12]),
    batches: [batch(20, 12, '2026-11-24'), batch(21, 24, '2026-11-24')] }));
  const second = assess(next(first, [batch(20, 0, '2026-11-24'), batch(21, 24, '2026-11-24')]));
  assert.equal(risk(second, 21).remaining_allowance, 12);
  assert.equal(risk(second, 21).risk_qty, 12);
  assert.deepEqual(second.demand_trace.map(d => d.business_date), ['2026-11-24']);
});

test('acceptance: Monday fixes Thursday at 8 lb for a batch joining Wednesday despite a new 10 lb forecast', () => {
  const first = assess(input({ forecast: run(MON, [0,0,0,8]), batches: [batch(20, 20, '2026-11-26')] }));
  const newer = run('2026-11-25', [0,10], id(11));
  const second = assess(input({ assessmentDate: '2026-11-25', assessedAt: '2026-11-25T12:00:00Z',
    inventoryCutoff: '2026-11-24', forecast: newer, recipes: recipeRows(newer), frozen: first.frozen,
    batches: [batch(20, 20, '2026-11-26'), batch(21, 30, '2026-11-26', { received_date: MON })] }));
  const thursday = second.demand_trace.find(d => d.business_date === '2026-11-26');
  assert.equal(thursday.quantity, 8); assert.equal(thursday.basis.run_id, id(10));
  assert.equal(second.new_cases.length, 1); assert.equal(second.new_demands.length, 0);
  assert.equal(thursday.allocated, 8);
});

test('a batch receives allowance through its own use-by night, never after it', () => {
  const r = assess(input({ forecast: run(MON, [0,100]),
    batches: [batch(20, 20, MON), batch(21, 20, '2026-11-24')] }));
  assert.equal(risk(r, 20).remaining_allowance, 0); assert.equal(risk(r, 20).risk_qty, 20);
  assert.equal(risk(r, 21).remaining_allowance, 20); assert.equal(risk(r, 21).risk_qty, 0);
  const inclusive = assess(input({ forecast: run(MON, [8]), batches: [batch(20, 10, MON)] }));
  assert.equal(risk(inclusive, 20).remaining_allowance, 8);
});

test('zero risk stays hidden and unfrozen; a later positive assessment may freeze', () => {
  const first = assess(input({ forecast: run(MON, [8]), batches: [batch(20, 8, MON)] }));
  assert.equal(first.visible_items.length, 0); assert.equal(first.frozen.demands.length, 0);
  assert.equal(first.frozen.cases.length, 0);
  const second = assess(input({ forecast: run(MON, [7], id(11)), frozen: first.frozen, batches: [batch(20, 8, MON)] }));
  assert.equal(second.visible_items.length, 1); assert.equal(second.frozen.demands[0].quantity, 7);
});

test('hidden zero-risk cases keep their original freeze when positive again', () => {
  const first = assess(input({ forecast: run(MON, [0,8,8]), batches: [batch(20, 20, '2026-11-25')] }));
  const hidden = assess(next(first, [batch(20, 16, '2026-11-25')]));
  assert.equal(hidden.visible_items.length, 0);
  const again = assess(input({ assessmentDate: '2026-11-25', assessedAt: '2026-11-25T12:00:00Z',
    inventoryCutoff: '2026-11-24', forecast: null, recipes: [], frozen: hidden.frozen,
    batches: [batch(20, 16, '2026-11-25')] }));
  assert.equal(risk(again, 20).risk_qty, 8); assert.equal(again.new_cases.length, 0);
  assert.equal(again.frozen.cases[0].first_positive_date, MON);
});

test('new uncovered nights use the latest forecast while existing fixed nights stay unchanged', () => {
  const first = assess(input({ forecast: run(MON, [0,0,0,8]), batches: [batch(20, 20, '2026-11-26')] }));
  const newer = run('2026-11-25', [0,10,6], id(11));
  const r = assess(input({ assessmentDate: '2026-11-25', assessedAt: '2026-11-25T12:00:00Z', inventoryCutoff: '2026-11-24',
    forecast: newer, recipes: recipeRows(newer), frozen: first.frozen,
    batches: [batch(20, 20, '2026-11-26'), batch(21, 30, '2026-11-27', { received_date: MON })] }));
  assert.equal(r.frozen.demands.find(d => d.business_date === '2026-11-26').quantity, 8);
  const friday = r.frozen.demands.find(d => d.business_date === '2026-11-27');
  assert.equal(friday.quantity, 6); assert.equal(friday.basis.run_id, id(11));
});

test('an older published run retains its age but completed allowance nights are dropped', () => {
  const r = assess(input({ assessmentDate: '2026-11-25', assessedAt: '2026-11-25T12:00:00Z',
    inventoryCutoff: '2026-11-24', forecast: run(MON, [100,100,8]), batches: [batch(20, 20, '2026-11-25')] }));
  assert.equal(r.forecast.age_business_days, 2); assert.equal(r.forecast.source_through, '2026-11-22');
  assert.equal(r.demand_trace.length, 1); assert.equal(risk(r, 20).remaining_allowance, 8);
});

test('a stale run cannot extrapolate beyond its horizon or freeze partial coverage', () => {
  const r = assess(input({ assessmentDate: '2026-11-25', assessedAt: '2026-11-25T12:00:00Z',
    inventoryCutoff: '2026-11-24', batches: [batch(20, 30, '2026-12-01')] }));
  assert.equal(risk(r, 20).reason, 'forecast_horizon_missing');
  assert.equal(risk(r, 20).risk_qty, null); assert.equal(r.new_demands.length, 0);
});

test('closed nights contribute zero without requiring recipes', () => {
  const f = run(MON, [0]); f.nights[0].availability = 'closed';
  const r = assess(input({ forecast: f, recipes: [], batches: [batch(20, 5, MON)] }));
  assert.equal(risk(r, 20).risk_qty, 5); assert.equal(r.frozen.demands[0].quantity, 0);
});

test('an unavailable dish using the ingredient makes its estimate unavailable, even at a zero night low', () => {
  for (const low of [0, 20]) {
    const f = run(MON, [low]); f.nights[0].dishes[0].status = 'needs_baseline'; f.nights[0].dishes[0].share = null;
    const r = assess(input({ forecast: f, batches: [batch(20, 5, MON)] }));
    assert.equal(risk(r, 20).reason, 'ingredient_dish_forecast_unavailable'); assert.equal(risk(r, 20).visible, false);
  }
});

test('missing archived dish rows and incomplete recipes never become zero demand', () => {
  for (const change of [i => { i.forecast.nights[0].dishes = []; }, i => { i.recipes = []; }, i => { i.recipes[0].complete = false; }]) {
    const i = input({ batches: [batch(20, 5, MON)] }); change(i);
    const r = assess(i); assert.equal(risk(r, 20).status, 'unavailable'); assert.equal(r.new_cases.length, 0);
  }
});

test('an unrelated unavailable dish does not redistribute its share to this ingredient', () => {
  const f = run(MON, [80]); f.nights[0].dishes = [
    { dish_id: DISH, active: true, status: 'ok', share: 0.6 },
    { dish_id: id(4), active: true, status: 'needs_baseline', share: null },
  ];
  const recipes = recipeRows(f, 0.25); recipes.push({ ...structuredClone(recipes[0]), dish_id: id(4), portions: [{ ingredient_id: id(5), quantity: 1, unit: 'lb' }] });
  const r = assess(input({ forecast: f, recipes, ingredients: [ingredient(), ingredient({ id: id(5), name: 'Rice' })], batches: [batch(20, 20, MON)] }));
  close(r.demand_trace[0].quantity, 12);
});

test('unlinked lines and unknown ages need review instead of invented risk', () => {
  for (const [extra, reason] of [[{ ingredient_id: null }, 'link_ingredient'], [{ use_by_date: null }, 'unknown_use_by_date']]) {
    const r = assess(input({ batches: [batch(20, 5, MON, extra)] }));
    assert.equal(risk(r, 20).reason, reason); assert.equal(risk(r, 20).risk_qty, null);
  }
});

test('missing conversions stay unavailable; costs may be unknown without inventing zero dollars', () => {
  const noUnit = assess(input({ ingredients: [ingredient({ unit: null })] }));
  assert.equal(risk(noUnit, 20).reason, 'missing_ingredient_unit');
  const i = input({ batches: [batch(20, 30, MON)] }); i.recipes[0].portions[0].unit = 'slice';
  assert.equal(risk(assess(i), 20).reason, 'ingredient_conversion_required');
  const r = assess(input({ forecast: run(MON, [8]), batches: [batch(20, 10, MON, { unit_cost: null })] }));
  assert.equal(risk(r, 20).risk_qty, 2); assert.equal(risk(r, 20).risk_value, null);
});

test('costs convert into the same canonical unit as quantities', () => {
  const r = assess(input({ ingredients: [ingredient({ unit: 'oz' })], forecast: run(MON, [0]), batches: [batch(20, 2, MON)] }));
  assert.equal(risk(r, 20).risk_qty, 32); assert.equal(risk(r, 20).unit_cost, 4.5 / 16);
  assert.equal(risk(r, 20).risk_value, 9);
});

test('competing older stock outside the risk window still consumes the shared demand', () => {
  const r = assess(input({ forecast: run(MON, [20]),
    batches: [batch(20, 100, '2026-12-10'), batch(21, 30, MON, { received_date: '2026-11-21' })] }));
  assert.equal(risk(r, 20).status, 'outside_risk_window'); assert.equal(risk(r, 21).risk_qty, 30);
});

test('future stock is excluded and a known overdue batch has no future allowance', () => {
  const r = assess(input({ batches: [batch(20, 5, '2026-11-22'), batch(21, 9, '2026-11-25', { received_date: MON })] }));
  assert.equal(risk(r, 20).status, 'overdue'); assert.equal(risk(r, 20).risk_qty, 5);
  assert.equal(risk(r, 21).status, 'outside_inventory_cutoff');
});

test('an expiry correction cannot silently reset an existing baseline', () => {
  const first = assess(input());
  const r = assess(next(first, [batch(20, 20, '2026-11-26')]));
  assert.equal(risk(r, 20).reason, 'baseline_reassessment_required');
  assert.deepEqual(r.frozen, first.frozen);
});

test('invalid tenant, duplicate identities, partial inventory and tampered freezes reject', () => {
  for (const change of [i => { i.batches[0].restaurant_id = id(99); }, i => i.batches.push(i.batches[0]),
    i => { i.inventoryComplete = false; }, i => { i.forecast.restaurant_id = id(99); },
    i => { i.recipes[0].restaurant_id = id(99); }, i => { i.batches[0].remaining_qty = NaN; }]) {
    const i = input(); change(i); assert.throws(() => assess(i));
  }
  const first = assess(input()); const i = next(first, [batch(20, 20, '2026-11-25')]);
  i.frozen = structuredClone(first.frozen); i.frozen.demands[0].quantity++;
  assert.throws(() => assess(i), /digest/);
});

test('missing timezone, wrong business date, future publication and source after inventory reject or stay unavailable', () => {
  for (const extra of [{ timeZone: null }, { timeZone: 'Bad/Zone' }, { assessedAt: `${MON}T08:30:00Z` },
    { assessedAt: MON }, { inventoryCutoff: MON }]) assert.throws(() => assess(input(extra)));
  const future = input(); future.forecast.issued_at = `${MON}T13:00:00Z`; assert.throws(() => assess(future));
  const ahead = assess(input({ inventoryCutoff: '2026-11-21', batches: [batch(20, 30, MON)] }));
  assert.equal(risk(ahead, 20).reason, 'inventory_behind_forecast');
});

test('business dates remain correct across DST, leap day and year boundaries', () => {
  for (const [start, at] of [['2026-03-08','2026-03-08T08:00:00Z'], ['2026-11-01','2026-11-01T09:00:00Z'],
    ['2028-02-29','2028-02-29T12:00:00Z'], ['2026-12-31','2026-12-31T12:00:00Z']]) {
    const f = run(start, [8]); f.issued_at = at;
    const r = assess(input({ assessmentDate: start, assessedAt: at, inventoryCutoff: shift(start,-1),
      forecast: f, batches: [batch(20, 10, start, { received_date: shift(start,-2) })] }));
    assert.equal(risk(r, 20).risk_qty, 2);
  }
});

test('results are immutable and deterministic, do not mutate inputs, and conserve every demand night', () => {
  const i = input({ batches: [batch(21, 30, '2026-11-25'), batch(20, 10, '2026-11-24')] });
  const before = structuredClone(i), r = assess(i);
  assert.deepEqual(i, before); assert.ok(Object.isFrozen(r) && Object.isFrozen(r.frozen.demands[0].basis));
  assert.deepEqual(r, assess({ ...i, batches: [...i.batches].reverse(), recipes: [...i.recipes].reverse() }));
  for (const night of r.demand_trace) close(night.allocated + night.unused, night.quantity);
  for (const row of r.items) assert.ok(row.remaining_allowance <= row.remaining_qty);
  assert.equal(Object.isFrozen(i.batches[0]), false);
});

test('different ingredient costs are valued per batch and one shared daily budget is conserved', () => {
  const r = assess(input({ forecast: run(MON, [8]), batches: [batch(20, 10, MON), batch(21, 10, MON, { unit_cost: 2 })] }));
  assert.equal(risk(r, 20).risk_value, 9); assert.equal(risk(r, 21).risk_value, 20);
  assert.equal(r.demand_trace[0].allocated, 8);
});

test('the seven-day boundary is inclusive and the following day is outside the card window', () => {
  const r = assess(input({ forecast: run(MON, []), batches: [batch(20, 10, shift(MON,7)), batch(21, 10, shift(MON,8))] }));
  assert.equal(risk(r, 20).visible, true); assert.equal(risk(r, 21).status, 'outside_risk_window');
});

test('ingredient and night freezes keep their original sources and ages without a new forecast', () => {
  const first = assess(input());
  const second = assess(next(first, [batch(20, 20, '2026-11-25')]));
  assert.equal(second.forecast, null); assert.equal(second.forecast_sources[0].run_id, id(10));
  assert.equal(second.forecast_sources[0].age_business_days, 1);
  assert.equal(second.forecast_sources[0].source_through, '2026-11-22');
});

test('unknown inventory context cannot grant its reserved demand to another batch', () => {
  const r = assess(input({ batches: [batch(20, 10, null), batch(21, 30, '2026-11-25')] }));
  assert.equal(risk(r, 21).reason, 'inventory_context_incomplete'); assert.equal(r.new_cases.length, 0);
});

test('one ingredient failure does not stop an unrelated ingredient estimate', () => {
  const second = ingredient({ id: id(5), name: 'Rice' });
  const f = run(MON, [8]);
  const recipes = recipeRows(f); recipes[0].portions.push({ ingredient_id: second.id, quantity: 1, unit: 'lb' });
  recipes[0].portions[0].unit = 'slice';
  const r = assess(input({ ingredients: [ingredient(), second], forecast: f, recipes,
    batches: [batch(20, 20, MON), batch(21, 20, MON, { ingredient_id: second.id })] }));
  assert.equal(risk(r, 20).status, 'unavailable'); assert.equal(risk(r, 21).risk_qty, 12);
});

test('run dates, night identities, shares, units, costs and quantities reject invalid values', () => {
  for (const change of [i => { i.forecast.nights[0].business_date = '2026-11-24'; },
    i => { i.forecast.nights[0].dishes[0].share = 2; }, i => { i.batches[0].unit_cost = -1; },
    i => { i.batches[0].remaining_qty = -1; }, i => { i.recipes[0].portions[0].quantity = Infinity; },
    i => { i.forecast.nights[0].low = Infinity; }]) {
    const i = input(); change(i); assert.throws(() => assess(i));
  }
});

test('a partial saved freeze cannot substitute a newer forecast inside its original coverage', () => {
  const first = assess(input({ forecast: run(MON, [0,8,8]), batches: [batch(20, 30, '2026-11-25')] }));
  const state = structuredClone(first.frozen);
  state.demands = state.demands.filter(d => d.business_date !== '2026-11-24');
  const newer = run('2026-11-24', [100,100], id(11));
  const r = assess(next(first, [batch(20, 25, '2026-11-25')], { frozen: state, forecast: newer, recipes: recipeRows(newer) }));
  assert.equal(risk(r, 20).reason, 'frozen_coverage_missing'); assert.equal(risk(r, 20).risk_qty, null);
  assert.equal(r.new_demands.length, 0);
});

function withUncovered(share) {
  const f = run(MON, [20]);
  f.nights[0].dishes[0].share = 1 - share;
  f.nights[0].dishes.push({ dish_id: id(4), active: true, status: 'ok', share });
  return input({ forecast: f, batches: [batch(20, 30, MON)] });
}

test('an uncovered zero-share dish never blocks or contributes uncovered share', () => {
  const r = assess(withUncovered(0));
  assert.equal(risk(r, 20).risk_qty, 10); assert.equal(risk(r, 20).may_be_overstated, false);
});

test('recipe coverage below or at the versioned limit computes with a pinned disclosure', () => {
  for (const share of [0.05, 0.10]) {
    const r = assess(withUncovered(share));
    close(risk(r, 20).remaining_allowance, 20 * (1-share));
    assert.equal(risk(r, 20).may_be_overstated, true);
    assert.equal(r.frozen.demands[0].basis.uncovered_share, share);
    assert.equal(r.frozen.demands[0].basis.recipe_coverage_limit, 0.10);
    assert.equal(risk(r, 20).recipe_coverage[0].uncovered_dishes[0].dish_id, id(4));
  }
});

test('coverage above the limit or an unknown uncovered share stays unavailable', () => {
  const i = withUncovered(0.11);
  assert.equal(risk(assess(i), 20).reason, 'recipe_coverage_incomplete');
  i.forecast.nights[0].dishes[1].share = null;
  assert.equal(risk(assess(i), 20).risk_qty, null);
});

test('a lower later coverage limit does not rewrite an already frozen night', () => {
  const first = assess(withUncovered(0.08));
  const i = withUncovered(0.08); i.frozen = first.frozen;
  i.resolvedSettings = resolveProjectionSettings({ restaurantId: REST, at: `${MON}T12:00:00Z`,
    globalVersion: { id: id(91), restaurant_id: null, model_major: 4, effective_at: '2020-01-01T00:00:00Z',
      settings: { ...PROJECTION_DEFAULTS, waste_recipe_uncovered_share_max: 0.01 } } });
  const r = assess(i);
  assert.equal(risk(r, 20).status, 'ok'); assert.equal(risk(r, 20).recipe_coverage[0].limit, 0.10);
});

test('floating-point residuals do not become permanent freezes or visible risk', () => {
  const r = assess(input({ forecast: run(MON, [0.3]), batches: [batch(20, 0.1+0.2, MON)] }));
  assert.equal(risk(r, 20).risk_qty, 0); assert.equal(r.visible_items.length, 0);
  assert.equal(r.new_cases.length, 0); assert.equal(r.new_demands.length, 0);
  const large = assess(input({ forecast: run(MON, [1e9-0.5]), batches: [batch(20, 1e9, MON)] }));
  assert.equal(large.visible_items.length, 0);
});

test('overdue actual FIFO can shift risk to a newer lot while allowance stops at use-by', () => {
  const first = assess(input({ batches: [batch(20,10,MON),batch(21,20,'2026-11-25')] }));
  const tuesday = assess(next(first,[batch(20,2,MON),batch(21,20,'2026-11-25')]));
  assert.equal(risk(tuesday,20).status,'overdue'); assert.equal(risk(tuesday,20).remaining_allowance,0);
  assert.equal(risk(tuesday,21).risk_qty,4);
  // Tuesday's eight units of actual consumption use two overdue units first,
  // then six from the newer lot. No disposal has yet been confirmed.
  const wednesday = assess(input({ assessmentDate:'2026-11-25',assessedAt:'2026-11-25T12:00:00Z',
    inventoryCutoff:'2026-11-24',forecast:null,recipes:[],frozen:tuesday.frozen,
    batches:[batch(20,0,MON),batch(21,14,'2026-11-25')] }));
  assert.equal(risk(wednesday,21).risk_qty,6);
  assert.equal(tuesday.visible_items.reduce((s,r)=>s+r.risk_qty,0),6);
  assert.equal(wednesday.visible_items.reduce((s,r)=>s+r.risk_qty,0),6);
});

const correction = (reason, extra = {}) => ({ id: id(95), restaurant_id: REST, actor_id: id(96),
  reason, source_event_id: 'fixture-event', batch_ids: [id(20)], ingredient_ids: [ING],
  business_dates: ['2026-11-24'], dish_ids: [DISH], ...extra });

test('count and disposal corrections retain the fixed demand and cap/release allowance', () => {
  const first = assess(input({ forecast: run(MON, [0,20]),
    batches: [batch(20,12,'2026-11-24'),batch(21,24,'2026-11-24')] }));
  for (const [reason, qty, expected] of [['physical_count',6,10],['confirmed_disposal',0,4]]) {
    const r = reassess(next(first,[batch(20,qty,'2026-11-24'),batch(21,24,'2026-11-24')]), correction(reason));
    assert.deepEqual(r.frozen.demands,first.frozen.demands);
    assert.equal(risk(r,21).risk_qty,expected);
  }
});

test('an authorized shelf-life extension freezes only newly covered nights', () => {
  const first = assess(input({batches:[batch(20,30,MON)]}));
  const fresh = run('2026-11-24',[10,12],id(11));
  const r = reassess(next(first,[batch(20,30,'2026-11-25')],{forecast:fresh,recipes:recipeRows(fresh)}),correction('storage_or_shelf_life'));
  assert.deepEqual(r.frozen.demands[0],first.frozen.demands[0]);
  assert.deepEqual(r.new_demands.map(d=>d.quantity),[10,12]);
  assert.equal(r.frozen.cases[0].first_positive_date,MON);
  assert.equal(r.frozen.cases[0].coverage_through,'2026-11-25');
  assert.doesNotThrow(()=>assess(next(r,[batch(20,30,'2026-11-25')])));
});

test('invoice date and shortened shelf life preserve original demand ownership', () => {
  const first=assess(input());
  const r=reassess(next(first,[batch(20,30,'2026-11-24',{received_date:'2026-11-19'})]),correction('invoice_quantity_or_date'));
  assert.deepEqual(r.frozen.demands,first.frozen.demands);
  assert.equal(r.frozen.cases[0].use_by_date,'2026-11-24');
  assert.equal(r.frozen.cases[0].coverage_through,'2026-11-25');
  assert.doesNotThrow(()=>assess(next(r,[batch(20,30,'2026-11-24',{received_date:'2026-11-19'})])));
});

test('a newly confirmed closure zeroes only its scoped night through an explicit correction', () => {
  const first=assess(input());
  const r=reassess(next(first,[batch(20,30,'2026-11-25')]),correction('confirmed_closure'));
  assert.deepEqual(r.frozen.demands.map(d=>d.quantity),[8,0,8]);
  assert.equal(r.frozen.demands[1].last_correction_id,id(95));
  assert.equal(r.frozen.demands[1].basis.run_id,first.frozen.demands[1].basis.run_id);
});

test('dish removal changes only that dish contribution without rebalancing other shares', () => {
  const f=run();f.nights.forEach(n=>{n.dishes[0].share=0.5;n.dishes.push({...n.dishes[0],dish_id:id(4)});});
  const recipes=recipeRows(f);recipes.push(...recipeRows(f,2).map(r=>({...r,dish_id:id(4)})));
  const first=assess(input({forecast:f,recipes,batches:[batch(20,50,'2026-11-25')]}));
  const r=reassess(next(first,[batch(20,50,'2026-11-25')]),correction('dish_removal'));
  assert.equal(r.frozen.demands[1].quantity,8);
  assert.equal(r.frozen.demands[1].basis.contributions[0].share,0.5);
  assert.equal(r.frozen.demands[0].quantity,12);
});

test('unapproved reset reasons and elapsed-night corrections reject', () => {
  const first=assess(input());const i=next(first,[batch(20,30,'2026-11-25')]);
  assert.throws(()=>reassess(i,correction('new_forecast')),/scope/);
  assert.throws(()=>reassess(i,correction('confirmed_closure',{business_dates:[MON]})),/Elapsed/);
  assert.throws(()=>reassess(next(first,[batch(20,30,'2026-11-24')]),correction('physical_count')),/cannot change/);
});

test('an authorized extension may finish freezing later when its missing forecast arrives', () => {
  const first=assess(input({batches:[batch(20,30,MON)]}));
  const pending=reassess(next(first,[batch(20,30,'2026-11-25')]),correction('storage_or_shelf_life'));
  assert.equal(pending.items[0].status,'unavailable');
  const fresh=run('2026-11-24',[10,12],id(11));
  const ready=assess(next(pending,[batch(20,30,'2026-11-25')],{assessedAt:'2026-11-24T13:00:00Z',forecast:fresh,recipes:recipeRows(fresh)}));
  assert.equal(ready.items[0].status,'ok');
  assert.equal(ready.new_demands.length,2);
  assert.doesNotThrow(()=>assess(next(ready,[batch(20,30,'2026-11-25')],{assessedAt:'2026-11-24T13:00:00Z'})));
});

test('fallback gives an uncovered tail zero allowance without freezing synthetic demand', () => {
  const forecast = run(shift(MON, -1), Array(8).fill(1));
  const useBy = shift(MON, 7);
  const fallback = assess(input({
    forecast, forecastFallback: true, recipes: recipeRows(forecast),
    batches: [batch(20, 30, useBy)],
  }));
  assert.equal(fallback.forecast_fallback, true);
  assert.equal(risk(fallback, 20).risk_qty, 23);
  assert.equal(fallback.frozen.cases[0].coverage_through, shift(MON, 6));
  assert.equal(fallback.frozen.demands.some(row => row.business_date === useBy), false);

  const day = shift(MON, 1);
  const newer = run(day, Array(8).fill(2), id(11));
  const following = assess(next(fallback, [batch(20, 30, useBy)], {
    forecast: newer, forecastFallback: false, recipes: recipeRows(newer),
    frozen: {
      cases: fallback.frozen.cases,
      demands: fallback.frozen.demands.filter(row => row.business_date > MON),
    },
  }));
  assert.equal(following.frozen.cases[0].coverage_through, useBy);
  assert.equal(following.new_demands.length, 1);
  assert.equal(following.new_demands[0].business_date, useBy);
  assert.equal(risk(following, 20).risk_qty, 22);
});