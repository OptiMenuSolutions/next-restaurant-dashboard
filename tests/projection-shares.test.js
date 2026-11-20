import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTION_DEFAULTS, resolveProjectionSettings } from '../lib/projections/settings.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
import { projectRestaurantVolume } from '../lib/projections/volume.js';
import { projectDishShares } from '../lib/projections/shares.js';
import { sharesV4 } from './fixtures/projection-shares-v4.js';
import { volumeV4 } from './fixtures/projection-volume-v4.js';

const REST = '10000000-0000-4000-8000-000000000001';
const FOREIGN = '20000000-0000-4000-8000-000000000001';
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ASOF = '2026-11-19';
const styles = ['Comfort/Heavy', 'Light/Fresh', 'Neutral'];
const near = (actual, expected, label = '') => {
  if (typeof expected === 'number') assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
  else assert.equal(actual, expected, label);
};
const dish = (n, style, extra = {}) => ({ id: id(n + 10), restaurant_id: REST, forecastable: true,
  style_category: style, is_new: false, is_returning: false, launch_date: '2024-01-01', removed_date: null, ...extra });
const model = { model_major: 4, logic_revision: 'approved-workbook-v4',
  reference_sha256: volumeV4.workbook_sha256, released_at: '2020-01-01T00:00:00Z' };
function seal(data, overrides = {}) {
  data.resolvedSettings = resolveProjectionSettings({ restaurantId: REST, at: data.snapshotAt,
    globalVersion: { id: id(101), restaurant_id: null, model_major: 4, effective_at: '2020-01-01T00:00:00Z',
      settings: { ...PROJECTION_DEFAULTS, ...overrides } } });
  data.volume = projectRestaurantVolume({ ...data, modelVersion: model, firstDataDate: data.firstDataDate, calendar: data.calendar });
  return data;
}
function context({ days = 112, settings = {}, menu = styles.map((s, i) => dish(i, s)) } = {}) {
  const firstDataDate = shiftProjectionDate(ASOF, -days), history = [], dishFacts = [];
  for (let i = 0; i < days; i++) {
    const date = shiftProjectionDate(firstDataDate, i), revision = `fixture:${date}`;
    const active = menu.filter(d => d.launch_date <= date && (!d.removed_date || date < d.removed_date));
    const facts = active.map(d => ({ restaurant_id: REST, business_date: date, dish_id: d.id,
      units: 10, recommended: false, sold_out: false, source_revision: revision }));
    dishFacts.push(...facts);
    history.push({ restaurant_id: REST, business_date: date, total_units: facts.length * 10,
      complete: true, source_covered: true, closed: false, early_close: false, holiday_keys: [],
      outlier_status: 'kept', source_revision: revision });
  }
  return seal({ restaurantId: REST, asOf: ASOF, snapshotAt: `${ASOF}T12:00:00Z`, firstDataDate,
    styleCategories: styles, dishes: menu, history, dishFacts, launchHistory: [],
    calendar: Array.from({ length: 8 }, (_, i) => ({ restaurant_id: REST, business_date: shiftProjectionDate(ASOF, i),
      closed: false, early_close: false, holiday_keys: [], default_factor: 1, configuration_revision: 1, context_digest: 'a'.repeat(64) })) }, settings);
}
function golden() {
  const w = sharesV4, flags = { 'Isolated outlier': 'isolated_outlier', 'Short run': 'short_run', 'One-off event': 'one_off_event' };
  const history = w.history.map(([date, units, complete, closed, early, holiday, status]) => ({
    restaurant_id: REST, business_date: date, total_units: units, complete: !!complete, source_covered: true,
    closed: !!closed, early_close: !!early,
    holiday_keys: holiday ? [holiday.toLowerCase().replace(/['.]/g, '').replace(/[^a-z0-9]+/g, '_')] : [],
    outlier_status: flags[status] || 'kept', source_revision: `cache:${date}` }));
  const menu = w.dishes.map((row, i) => dish(i, row[3], { is_new: !!row[4], launch_date: row[5],
    removed_date: row[6], is_returning: !!row[7], last_season_removed_date: row[8],
    owner_prior_weight: row[9], share_trend_per_week: row[10], last_season_category_count: row[11] }));
  const dishFacts = w.facts.flatMap(([date, units, rec, sold]) => units.map((value, i) => ({
    restaurant_id: REST, business_date: date, dish_id: menu[i].id, units: value,
    recommended: rec[i] === '?' ? null : rec[i] === '1', sold_out: sold[i] === '?' ? null : sold[i] === '1',
    source_revision: `cache:${date}` })));
  const own = w.launch_history.filter(row => row[3] === 'Own' && row[4] === 1);
  const launchHistory = own.map((row, i) => ({ id: id(201 + i), restaurant_id: REST, dish_id: menu[i].id,
    style_category: row[1], launch_date: '2024-01-01', observed_through: '2024-01-28', launch_index: row[6],
    created_at: '2024-02-01T12:00:00Z', supersedes_id: null }));
  const data = context();
  Object.assign(data, { firstDataDate: w.first_data_date, history, dishes: menu, dishFacts, launchHistory });
  data.calendar = data.calendar.map((row, i) => ({ ...row, closed: volumeV4.expected[i].factor === 0,
    default_factor: volumeV4.expected[i].factor,
    holiday_keys: i === 6 ? ['thanksgiving_eve'] : i === 7 ? ['thanksgiving_day'] : [] }));
  return seal(data, { ...volumeV4.settings, ...w.settings });
}

test('golden: every cached Category E-O, Baseline E-P and Dish Model E-W value matches v4', () => {
  assert.equal(sharesV4.workbook_sha256, '97e91fb3cf46e6b4726cb121f00f8b70f3fcb42eb914059fdf8fa40a6865b882');
  const data = golden(), result = projectDishShares(data);
  assert.equal(sharesV4.category_expected.length, 24); assert.equal(sharesV4.baseline_expected.length, 10);
  assert.equal(sharesV4.dish_expected.length, 80);
  for (const row of sharesV4.category_expected) {
    const actual = result.nights.find(n => n.business_date === row[0]).categories.find(c => c.style_category === row[1]);
    const values = [actual.base_share, actual.ly_target_from, actual.ly_target_until, actual.ly_target_share,
      actual.ly_base_share, actual.own_ratio, actual.ratio_source, actual.capped_ratio,
      actual.raw_share, actual.active_dish_count, actual.share];
    values.forEach((value, i) => near(value, row[i + 4], `Category ${row[0]} ${row[1]} col ${i + 5}`));
  }
  for (const row of sharesV4.baseline_expected) {
    const actual = result.baselines.find(b => b.dish_id === data.dishes[Number(row[0].slice(1)) - 1].id);
    const values = [actual.clean_nights_base, actual.lookback_weeks, actual.clean_nights, actual.method,
      actual.raw_share, actual.n, actual.O, actual.lambda, actual.returning_index,
      actual.own_launch_index, actual.pooled_launch_index, actual.prior_source];
    values.forEach((value, i) => near(value, row[i + 4], `Baseline ${row[0]} col ${i + 5}`));
  }
  for (const row of sharesV4.dish_expected) {
    const actual = result.nights.find(n => n.business_date === row[0]).dishes.find(d => d.dish_id === data.dishes[Number(row[1].slice(1)) - 1].id);
    const values = [+actual.active, +actual.is_new, actual.n, actual.lambda, actual.O, actual.P, actual.prior_source,
      actual.proposed_share, actual.baseline_share, actual.weekday_clean_nights, actual.weekday_clean_share,
      actual.raw_existing_share, actual.normalized_existing_share, actual.proposed_new_total, actual.capped_new_total,
      actual.within_category_share, actual.category_share, actual.overall_share, actual.expected_units];
    values.forEach((value, i) => near(value, row[i + 4], `Dish ${row[0]} ${row[1]} col ${i + 5}`));
  }
  assert.ok(result.nights.every(n => n.checks.available));
  result.nights.forEach(n => near(n.dishes.reduce((total, d) => total + d.expected_units, 0), n.adjusted_volume));
});

const output = data => projectDishShares(data);
const firstDish = (data, index = 0) => output(data).nights[0].dishes.find(d => d.dish_id === data.dishes[index].id);
function recount(data, settings = {}) {
  for (const night of data.history) night.total_units = data.dishFacts.filter(f => f.business_date === night.business_date).reduce((n, f) => n + f.units, 0);
  return seal(data, { ...data.resolvedSettings.settings, ...settings });
}
const ownLaunch = (data, extra = {}) => ({ id: id(201), restaurant_id: REST, dish_id: data.dishes[0].id,
  style_category: styles[0], launch_date: '2024-01-01', observed_through: '2024-01-28',
  launch_index: 0.8, created_at: '2024-02-01T00:00:00Z', supersedes_id: null, ...extra });

for (const tier of [8, 9, 16]) {
  for (const enough of [true, false]) test(`lookback ${tier} weeks at ${enough ? 'ten' : 'nine'} clean nights`, () => {
    const data = context({ days: 128 });
    const last = tier === 8 ? 10 : tier === 9 ? 57 : 106;
    const keep = new Set(Array.from({ length: 9 }, (_, i) => shiftProjectionDate(ASOF, -i - 1)));
    if (enough) keep.add(shiftProjectionDate(ASOF, -last));
    data.dishFacts.filter(f => f.dish_id === data.dishes[0].id).forEach(f => { f.recommended = !keep.has(f.business_date); });
    const row = firstDish(data);
    assert.equal(row.lookback_weeks, enough ? tier : 16);
    assert.equal(row.clean_nights, enough ? 10 : 9);
    assert.equal(row.baseline_method, enough ? 'CLEAN ONLY' : 'BASELINE INCLUDES RECOMMENDATION NIGHTS');
  });
}

test('clean selection removes excluded nights from both numerator and category denominator', () => {
  const data = context({ menu: [dish(0, styles[0]), dish(3, styles[0]), dish(1, styles[1]), dish(2, styles[2])] });
  for (const f of data.dishFacts) {
    if (f.dish_id === data.dishes[0].id) f.units = 1;
    if (f.dish_id === data.dishes[1].id) f.units = 3;
  }
  const rows = data.dishFacts.filter(f => f.dish_id === data.dishes[0].id).slice(-2);
  rows[0].units = 100; rows[0].recommended = true;
  rows[1].units = 100; rows[1].sold_out = true;
  recount(data);
  const row = firstDish(data);
  near(row.baseline.raw_share, 0.25);
  assert.deepEqual(row.baseline.trace.excluded.map(f => f.reason).sort(), ['recommended', 'sold_out']);
  assert.equal(row.category.trace.base_dates.length, 56);
});

for (const treatment of ['exclude', 'adjust']) test(`${treatment} handles recommendation fallback and still excludes sold out`, () => {
  const data = context({ settings: { recommendation_treatment: treatment },
    menu: [dish(0, styles[0]), dish(3, styles[0]), dish(1, styles[1]), dish(2, styles[2])] });
  for (const f of data.dishFacts) {
    if (f.dish_id === data.dishes[0].id) { f.units = 2.5; f.recommended = true; }
    if (f.dish_id === data.dishes[1].id) f.units = 7.5;
  }
  const last = data.dishFacts.filter(f => f.dish_id === data.dishes[0].id).at(-1);
  last.units = 100; last.sold_out = true;
  recount(data);
  const row = firstDish(data);
  near(row.baseline.raw_share, treatment === 'adjust' ? 0.2 : 0.25);
  assert.equal(row.clean_nights, 0);
  assert.equal(row.baseline_method, treatment === 'adjust' ? 'ADJUST ASSUMED LIFT' : 'BASELINE INCLUDES RECOMMENDATION NIGHTS');
  assert.equal(row.baseline.trace.included_dates.includes(last.business_date), false);
});

test('null flags count as clean like false flags, with different provenance and an unknown-flags trace', () => {
  const data = context(), a = output(data);
  data.dishFacts.forEach(f => { f.recommended = null; f.sold_out = null; });
  const b = output(data);
  assert.notEqual(a.provenance.context_digest, b.provenance.context_digest);
  for (let i = 0; i < 3; i++) {
    near(a.baselines[i].raw_share, b.baselines[i].raw_share);
    assert.equal(b.baselines[i].trace.unknown_flags.length, 112);
    assert.equal(a.baselines[i].trace.unknown_flags.length, 0);
  }
  near(a.nights[0].dishes[0].expected_units, b.nights[0].dishes[0].expected_units);
});

for (const index of [0.5, 2]) test(`a launch with n=0 uses its prior and the ${index === 2 ? 'binding' : 'nonbinding'} cap`, () => {
  const data = context({ settings: { default_launch_index: index },
    menu: [...styles.map((s, i) => dish(i, s)), dish(3, styles[0], { is_new: true, launch_date: ASOF })] });
  const row = firstDish(data, 3);
  assert.equal(row.n, 0); assert.equal(row.lambda, 0); assert.equal(row.O, 0);
  near(row.P, index / 2); near(row.proposed_share, index / 2);
  assert.equal(row.cap_applied, index === 2);
  assert.equal(row.category.trace.cap_skipped_no_existing, false);
  near(row.within_category_share, Math.min(0.5, index / 2));
});

test('multiple new dishes share the binding category cap proportionally', () => {
  const data = context({ menu: [...styles.map((s, i) => dish(i, s)),
    dish(3, styles[0], { is_new: true, launch_date: ASOF }), dish(4, styles[0], { is_new: true, launch_date: ASOF })] });
  const group = output(data).nights[0].dishes.filter(d => d.style_category === styles[0]);
  near(group.find(d => !d.is_new).within_category_share, 0.5);
  group.filter(d => d.is_new).forEach(d => { near(d.within_category_share, 0.25); assert.equal(d.cap_applied, true); });
});

test('returning-season, own-launch and default sources follow the workbook priority', () => {
  const data = golden();
  let result = output(data);
  assert.equal(result.baselines[7].prior_source, 'RETURNING SEASON');
  near(result.baselines[7].returning_index, 1.11190597853858);
  assert.equal(result.baselines[6].prior_source, 'OWN LAUNCHES'); near(result.baselines[6].launch_index, 0.8);
  assert.equal(result.baselines[8].prior_source, 'EVEN SPLIT'); near(result.baselines[8].launch_index, 1);
  data.dishes[7].last_season_removed_date = null;
  result = output(data); assert.equal(result.baselines[7].prior_source, 'OWN LAUNCHES');
  data.launchHistory = [];
  result = output(data); assert.equal(result.baselines[7].prior_source, 'EVEN SPLIT');
});

test('returning evidence includes the removal date and the preceding 27 days without recency weighting', () => {
  const data = golden(), end = data.dishes[7].last_season_removed_date;
  const base = output(data).baselines[7];
  assert.ok(base.trace.returning_dates.includes(end));
  assert.ok(base.trace.returning_dates.includes(shiftProjectionDate(end, -27)));
  assert.equal(base.trace.returning_dates.includes(shiftProjectionDate(end, -28)), false);
});

test('own-launch corrections replace their parents once and future corrections cannot leak', () => {
  const data = context(); data.launchHistory = [ownLaunch(data)];
  const replacement = ownLaunch(data, { id: id(202), supersedes_id: id(201), launch_index: 1.4,
    created_at: `${ASOF}T10:00:00Z` });
  data.launchHistory.push(replacement);
  near(output(data).baselines[0].launch_index, 1.4);
  replacement.created_at = '2026-11-20T10:00:00Z';
  near(output(data).baselines[0].launch_index, 0.8);
});

test('launch indexes are averaged by style before clamping, not selected by the target dish', () => {
  const data = context(); data.launchHistory = [ownLaunch(data, { launch_index: 0 }),
    ownLaunch(data, { id: id(202), dish_id: data.dishes[1].id, launch_index: 5 })];
  near(output(data).baselines[0].own_launch_index, 2);
  assert.equal(output(data).baselines[1].own_launch_index, null);
});

test('a category with no active dishes is zero and the other category shares renormalize', () => {
  const data = context(); data.dishes[2].removed_date = ASOF;
  const row = output(data).nights[0];
  near(row.categories.find(c => c.style_category === styles[2]).share, 0);
  row.categories.filter(c => c.style_category !== styles[2]).forEach(c => near(c.share, 0.5));
  assert.equal(row.dishes.find(d => d.dish_id === data.dishes[2].id).expected_units, 0);
});

test('launch dates are inclusive and removal dates exclusive inside the horizon', () => {
  const boundary = shiftProjectionDate(ASOF, 2);
  const data = context({ menu: [dish(0, styles[0], { removed_date: boundary }), dish(4, styles[0]),
    dish(1, styles[1]), dish(2, styles[2]), dish(3, styles[0], { is_new: true, launch_date: boundary })] });
  const result = output(data);
  for (let i = 0; i < 8; i++) {
    const old = result.nights[i].dishes.find(d => d.dish_id === data.dishes[0].id);
    const added = result.nights[i].dishes.find(d => d.dish_id === data.dishes[4].id);
    assert.equal(old.active, i < 2); assert.equal(added.active, i >= 2);
    if (i >= 2) assert.equal(old.expected_units, 0); else assert.equal(added.expected_units, 0);
  }
});

test('the new-dish duration ends exactly at its configured boundary', () => {
  const data = context({ menu: [dish(0, styles[0], { is_new: true, launch_date: shiftProjectionDate(ASOF, -56) }),
    dish(1, styles[1]), dish(2, styles[2])] });
  assert.equal(firstDish(data).is_new, false);
});

for (const status of ['closed', 'needs_baseline']) test(`${status} volume preserves zero or unavailable dish units`, () => {
  const data = context({ days: status === 'closed' ? 112 : 7 });
  if (status === 'closed') Object.assign(data.calendar[0], { closed: true, default_factor: 0 });
  seal(data);
  const row = output(data).nights[0];
  assert.equal(row.status, status);
  row.dishes.forEach(d => assert.equal(d.expected_units, status === 'closed' ? 0 : null));
});

test('category seasonality uses Monday-centered target periods and the public-data switch', () => {
  for (const enabled of [false, true]) {
    const data = context({ settings: { public_benchmarks_enabled: enabled } });
    const row = output(data).nights[0].categories[0];
    assert.equal(row.ly_target_from, '2025-11-10'); assert.equal(row.ly_target_until, '2025-11-30');
    assert.equal(row.own_ratio, null); near(row.capped_ratio, 1);
    assert.equal(row.ratio_source, enabled ? 'GOOGLE SEARCH PROXY' : 'NEUTRAL: NO SEASONAL DATA');
    assert.equal(row.trace.proxy_status, enabled ? 'neutral_placeholder' : 'not_used');
  }
});

test('the category base stays at eight weeks while dish lookbacks can extend', () => {
  const data = golden(), row = output(data).nights[0];
  assert.equal(row.dishes[0].lookback_weeks, 9);
  assert.equal(row.dishes[2].lookback_weeks, 16);
  assert.equal(row.categories[0].trace.base_from, '2026-09-24');
  assert.equal(row.categories[0].trace.base_until, '2026-11-18');
});

test('weekday mix uses clean evidence and its configured shrinkage, even for an adjusted baseline', () => {
  const data = golden(); seal(data, { ...data.resolvedSettings.settings, weekday_mix_enabled: true, recommendation_treatment: 'adjust' });
  const row = firstDish(data), weight = row.weekday_clean_nights / (row.weekday_clean_nights + 8);
  near(row.raw_existing_share, weight * row.weekday_clean_share + (1 - weight) * row.baseline_share);
});

test('optional share trend uses the workbook target-to-last-complete horizon and never seasonal ratios', () => {
  const data = context({ settings: { share_trend_enabled: true } });
  data.dishes[0].share_trend_per_week = 0.7;
  const result = output(data);
  near(result.nights[0].dishes[0].raw_existing_share, 1.1);
  near(result.nights[7].dishes[0].raw_existing_share, 1.8);
});

test('owner cold-start weights use the existing switch and threshold without inventing volume', () => {
  const data = context({ days: 7, settings: { owner_estimates_enabled: true } });
  data.dishes.forEach((d, i) => { d.owner_prior_weight = i + 1; });
  const row = output(data).nights[0];
  near(row.categories.find(c => c.style_category === styles[0]).share, 1 / 6);
  assert.equal(row.dishes[0].expected_units, null); assert.equal(row.dishes[0].baseline.owner_prior_used, true);
});

test('mismatching volume snapshots, settings, tenants and source revisions reject', () => {
  const cases = [
    d => { d.volume = structuredClone(d.volume); d.volume.nights[0].adjusted_volume++; },
    d => { d.dishes[0].restaurant_id = FOREIGN; },
    d => { d.dishFacts[0].restaurant_id = FOREIGN; },
    d => { d.launchHistory = [ownLaunch(d, { restaurant_id: FOREIGN })]; },
    d => { d.dishFacts[0].source_revision = 'stale'; },
    d => { d.styleCategories = null; },
    d => { d.dishes[0].style_category = null; },
    d => { d.dishFacts.pop(); },
    d => { d.dishFacts.push({ ...d.dishFacts[0] }); },
    d => { d.dishFacts[0].units = -1; },
    d => { d.dishFacts[0].recommended = undefined; },
    d => { d.snapshotAt = ASOF; },
    d => { d.dishes[0].id = d.dishes[1].id; },
  ];
  cases.forEach(change => { const data = context(); change(data); assert.throws(() => output(data)); });
});

test('a missing explicit zero still fails when the source total would otherwise reconcile', () => {
  const data = context(); data.dishFacts[0].units = 0; recount(data); data.dishFacts.shift();
  assert.throws(() => output(data), /Missing dish fact/);
});

test('an all-new category allocates its full share and records the approved cap exception', () => {
  const data = context(); data.dishes[0].is_new = true; data.dishes[0].launch_date = ASOF;
  const result = output(data);
  for (const night of result.nights) {
    const row = night.dishes.find(d => d.dish_id === data.dishes[0].id);
    assert.equal(night.status, 'ok'); assert.equal(night.checks.conserved, true);
    assert.equal(row.category.trace.cap_skipped_no_existing, true);
    assert.equal(row.cap_applied, false); near(row.capped_new_total, 1);
    near(row.within_category_share, 1); near(row.expected_units, 10);
  }
});

test('multiple all-new dishes receive proportional proposals rather than capped or equal shares', () => {
  const data = golden();
  for (const index of [0, 1, 5]) data.dishes[index].removed_date = ASOF;
  const night = output(data).nights[2];
  const group = night.dishes.filter(d => d.active && d.style_category === styles[0]);
  assert.equal(group.length, 2); assert.ok(group.every(d => d.is_new));
  assert.notEqual(group[0].proposed_share, group[1].proposed_share);
  const proposed = group.reduce((total, row) => total + row.proposed_share, 0);
  for (const row of group) {
    near(row.within_category_share, row.proposed_share / proposed);
    assert.equal(row.category.trace.cap_skipped_no_existing, true);
    assert.equal(row.cap_applied, false);
  }
  near(group.reduce((total, row) => total + row.within_category_share, 0), 1);
  assert.equal(night.status, 'ok'); assert.equal(night.checks.conserved, true);
});

test('existing dishes with zero shares do not prevent the new dishes from filling the category', () => {
  const data = context({ settings: { default_launch_index: 0.5 }, menu: [...styles.map((s, i) => dish(i, s)),
    dish(3, styles[0], { is_new: true, launch_date: ASOF })] });
  data.dishFacts.filter(f => f.dish_id === data.dishes[0].id).forEach(f => { f.sold_out = true; });
  const night = output(data).nights[0];
  const added = night.dishes.find(d => d.dish_id === data.dishes[3].id);
  const existing = night.dishes.find(d => d.dish_id === data.dishes[0].id);
  near(existing.normalized_existing_share, 0); near(existing.within_category_share, 0);
  near(added.proposed_share, 0.25); near(added.within_category_share, 1); near(added.expected_units, 10);
  assert.equal(added.category.trace.cap_skipped_no_existing, true);
  assert.equal(added.category.status, 'ok'); assert.equal(night.status, 'ok');
});

test('an unallocatable category marks only its affected nights and preserves healthy categories', () => {
  const boundary = shiftProjectionDate(ASOF, 3);
  const data = context({ menu: [dish(0, styles[0]), dish(3, styles[0], { removed_date: boundary }),
    dish(1, styles[1]), dish(2, styles[2])] });
  data.dishFacts.filter(f => f.dish_id === data.dishes[0].id).forEach(f => { f.units = 0; });
  recount(data);
  const result = output(data);
  for (let i = 0; i < result.nights.length; i++) {
    const night = result.nights[i], category = night.categories.find(c => c.style_category === styles[0]);
    assert.equal(night.volume_status, 'ok');
    assert.equal(night.status, i < 3 ? 'ok' : 'needs_baseline');
    assert.equal(night.checks.conserved, i < 3);
    assert.equal(category.status, i < 3 ? 'ok' : 'needs_baseline');
    assert.equal(category.reason, i < 3 ? null : 'no_positive_dish_share');
    for (const row of night.dishes.filter(d => d.style_category !== styles[0])) {
      assert.equal(row.status, 'ok'); near(row.expected_units, 10);
    }
    if (i >= 3) {
      const missing = night.dishes.find(d => d.dish_id === data.dishes[0].id);
      const removed = night.dishes.find(d => d.dish_id === data.dishes[1].id);
      assert.equal(missing.status, 'needs_baseline'); assert.equal(missing.expected_units, null);
      assert.equal(missing.overall_share, null); assert.equal(removed.expected_units, 0);
      assert.ok(night.reasons.some(r => r.code === category.reason && r.style_category === styles[0]));
    }
  }
});

test('missing category evidence returns unavailable checks without failing the run', () => {
  const result = output(context({ days: 0 }));
  for (const night of result.nights) {
    assert.equal(night.status, 'needs_baseline'); assert.equal(night.checks.conserved, false);
    assert.ok(night.reasons.some(r => r.code === 'category_shares_not_conserved'));
    night.categories.forEach(c => { assert.equal(c.status, 'needs_baseline'); assert.equal(c.reason, 'category_share_unavailable'); });
    night.dishes.forEach(d => assert.equal(d.expected_units, null));
  }
});

test('owner estimates remain off and supplied compatibility weights do not affect projections', () => {
  assert.equal(PROJECTION_DEFAULTS.owner_estimates_enabled, false);
  const data = context({ days: 7 });
  data.dishes.forEach((d, i) => { d.owner_prior_weight = i === 0 ? 100 : 1; });
  const row = output(data).nights[0];
  row.categories.forEach(c => { near(c.share, 1 / 3); assert.equal(c.trace.owner_prior_used, false); });
  row.dishes.forEach(d => { assert.equal(d.baseline.owner_prior_used, false); assert.equal(d.expected_units, null); });
});

test('future observations cannot change the result or its digest', () => {
  const data = context(), a = output(data);
  data.dishFacts.push({ ...data.dishFacts[0], business_date: ASOF, units: 999999 });
  data.history.push({ ...data.history[0], business_date: ASOF, total_units: 999999 });
  assert.deepEqual(output(data), a);
});

test('inputs stay unchanged; order, serialization and repeated runs are deterministic', () => {
  const data = golden(), before = structuredClone(data), a = output(data);
  assert.deepEqual(data, before);
  data.dishes.reverse(); data.dishFacts.reverse(); data.history.reverse(); data.launchHistory.reverse(); data.styleCategories = [...styles].reverse();
  assert.deepEqual(output(data), a);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  assert.equal(Reflect.set(a.nights[0].dishes[0], 'expected_units', 0), false);
  assert.equal(Reflect.set(a.baselines[0].trace.included_dates, '0', ASOF), false);
});

test('serialized caller inputs are not frozen as a side effect of freezing the result', () => {
  const data = JSON.parse(JSON.stringify(context()));
  assert.equal(Object.isFrozen(data.volume.provenance.settings_snapshot), false);
  output(data);
  assert.equal(Object.isFrozen(data.volume.provenance.settings_snapshot), false);
  assert.equal(Object.isFrozen(data.volume.provenance.model_version), false);
});

test('launch histories reject missing parents, branches, cycles and cross-dish supersession', () => {
  for (const kind of ['missing', 'branch', 'cycle', 'cross_dish']) {
    const data = context(), parent = ownLaunch(data);
    const child = ownLaunch(data, { id: id(202), supersedes_id: id(201) });
    data.launchHistory = [parent, child];
    if (kind === 'missing') child.supersedes_id = id(999);
    if (kind === 'branch') data.launchHistory.push({ ...child, id: id(203) });
    if (kind === 'cycle') parent.supersedes_id = child.id;
    if (kind === 'cross_dish') child.dish_id = data.dishes[1].id;
    assert.throws(() => output(data), error => error.code === 'PROJECTION_SHARE_INVALID');
  }
});