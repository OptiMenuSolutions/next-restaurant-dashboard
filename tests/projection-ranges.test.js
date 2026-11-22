import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTION_DEFAULTS as defaults, resolveProjectionSettings } from '../lib/projections/settings.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
import { checkedProjectionForecasts } from '../lib/projections/checkedForecasts.js';
import { rangeStatistics, percentileInc, inverseStandardNormal, volumeRange, dishRange, projectionBias } from '../lib/projections/rangeMath.js';
import { projectProjectionRanges } from '../lib/projections/ranges.js';
import { projectRestaurantVolume } from '../lib/projections/volume.js';
import { projectDishShares } from '../lib/projections/shares.js';
import { rangesV4 as golden } from './fixtures/projection-ranges-v4.js';

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REST = id(1), ASOF = '2026-11-19', SNAP = `${ASOF}T12:00:00Z`;
const near = (a, b, label = '') => typeof b === 'number'
  ? assert.ok(typeof a === 'number' && Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(b)), `${label}: ${a} != ${b}`)
  : assert.equal(a, b, label);
const source = (date, total = 100, extra = {}) => ({ restaurant_id: REST, business_date: date,
  total_units: total, complete: true, source_covered: true, closed: false, early_close: false,
  holiday_keys: [], outlier_status: 'normal', source_revision: `source:${date}`, ...extra });
function archiveInput(major = 4) {
  const history = [], dishFacts = [], runs = new Map();
  for (const [date, total, eligible, actuals, forecasts, vector] of golden.days) {
    history.push(source(date, total, { outlier_status: eligible ? 'normal' : 'excluded' }));
    actuals.forEach((units, j) => dishFacts.push({ restaurant_id: REST, business_date: date, dish_id: id(10 + j),
      units, source_revision: `source:${date}`, recommended: true, sold_out: true }));
    forecasts.forEach((expected, h) => {
      const runDate = shiftProjectionDate(date, -h);
      if (!runs.has(runDate)) runs.set(runDate, { id: id(100 + runs.size), restaurant_id: REST,
        run_date: runDate, source_through: shiftProjectionDate(runDate, -1), issued_at: `${runDate}T06:00:00Z`,
        model_major: major, calibration_key: major === 4 ? golden.calibration_key : golden.calibration_key.replace(/^4/, '2'),
        supersedes_id: null, nights: [] });
      runs.get(runDate).nights.push({ target_date: date, days_ahead: h + 1, availability: 'available', expected,
        dishes: golden.proportions[vector].map((p, j) => ({ dish_id: id(10 + j), expected: expected * p })) });
    });
  }
  return { restaurantId: REST, asOf: ASOF, snapshotAt: SNAP, lastCompleteDate: golden.last_complete,
    settings: defaults, calibrationKey: golden.calibration_key, history, dishFacts, archives: [...runs.values()] };
}
const stats = (observations = [], settings = defaults) => rangeStatistics(observations, settings);
const obs = (date, ratio) => ({ target_date: date, ratio });

for (const mode of ['default', 'empirical']) test(`v4 ${mode} caches: all volume, dish and weekly bias values`, () => {
  assert.equal(golden.original_sha256, '97e91fb3cf46e6b4726cb121f00f8b70f3fcb42eb914059fdf8fa40a6865b882');
  assert.equal(golden.recalculated_sha256, '6eac1f41b0a70a51765727fdd3f687173807907d270d31ea86f64d990face698');
  const checked = checkedProjectionForecasts(archiveInput(mode === 'default' ? 2 : 4)), caches = golden[mode];
  const observations = (h, dish) => checked.observations.filter(row => row.days_ahead === h && row.dish_id === dish);
  const volumes = [];
  for (const row of caches.volume) {
    const h = row[0], sample = observations(h, null), st = stats(sample);
    const v = volumeRange({ expected: 100, daysAhead: h, historyWeeks: 98, statistics: st, settings: defaults });
    volumes.push(v);
    [st.count, st.span_weeks, st.low_quantile, st.high_quantile, v.lower_ratio, v.upper_ratio, v.e, v.source,
      st.median, projectionBias(sample, golden.last_complete, defaults).status, st.distinct_weeks]
      .forEach((value, j) => near(value, row[j + 1], `volume ${h} column ${j + 2}`));
  }
  for (let i = 0; i < caches.dishes.length; i++) {
    const row = caches.dishes[i], h = row[0], sample = observations(h, id(10 + i % 10)), st = stats(sample);
    const [isNew, lambda] = caches.new[i];
    // The workbook rounds its derived z to two decimals. Reproduce its cache
    // through the existing override; runtime defaults remain unrounded.
    const result = dishRange({ expected: row[2], e: volumes[h - 1].e, isNew, lambda, statistics: st,
      settings: { ...defaults, range_z_override: golden.cached_z } });
    [st.count, st.span_weeks, st.low_quantile, st.high_quantile, result.e, result.new_factor, result.fallback_half_width,
      result.lower, result.upper, result.source, st.median, result.random_half_width,
      projectionBias(sample, golden.last_complete, defaults).status, st.distinct_weeks]
      .forEach((value, j) => near(value, row[j + 3], `dish ${i} column ${j + 4}`));
  }
  for (const row of caches.bias) {
    const sample = observations(row[1], row[0] === 'VOLUME' ? null : id(9 + Number(row[0].slice(1))));
    const bias = projectionBias(sample, golden.last_complete, defaults);
    near(stats(sample).median, row[2]);
    bias.weeks.forEach((week, j) => near(week.median, row[3 + j]));
    near(bias.qualifying_weeks, row[15]); near(bias.status, row[16]);
  }
});

test('percentiles interpolate exactly like PERCENTILE.INC and derive the normal z', () => {
  near(percentileInc([40, 10, 30, 20], 0.1), 13); near(percentileInc([1, 2], 0.5), 1.5);
  near(inverseStandardNormal(0.9), 1.2815515655446004); near(inverseStandardNormal(0.5), 0);
  near(inverseStandardNormal(0.025), -1.959963984540054);
  assert.throws(() => percentileInc([], 0.1)); assert.throws(() => inverseStandardNormal(1));
});
test('eight default horizons, cold-start boundary and settings-driven endpoints', () => {
  for (let h = 1; h <= 8; h++) {
    const warm = volumeRange({ expected: 100, daysAhead: h, historyWeeks: 8, statistics: stats(), settings: defaults });
    const cold = volumeRange({ expected: 100, daysAhead: h, historyWeeks: 7.99, statistics: stats(), settings: defaults });
    near(warm.e, 0.15 + 0.1 * (h - 1) / 7); near(cold.e, warm.e * 1.5);
  }
  const s = { ...defaults, volume_half_width_near: 0.2, volume_half_width_far: 0.4, cold_start_range_multiplier: 2 };
  near(volumeRange({ expected: 10, daysAhead: 8, historyWeeks: 2, statistics: stats(), settings: s }).e, 0.8);
});
test('worked examples use the derived z and full precision', () => {
  for (const [expected, low, high] of [[9, 4.78, 13.22], [40, 28.83, 51.17]]) {
    const r = dishRange({ expected, e: 0.15, isNew: false, statistics: stats(), settings: defaults });
    assert.ok(Math.abs(r.lower - low) < 0.015); assert.ok(Math.abs(r.upper - high) < 0.015);
  }
});
test('both volume quantile clamps apply before e is calculated', () => {
  for (const [low, high, expectedLow, expectedHigh] of [[1.2, 1.4, 1, 1.4], [0.6, 0.8, 0.6, 1]]) {
    const st = { empirical_available: true, low_quantile: low, high_quantile: high, median: 1 };
    const r = volumeRange({ expected: 10, daysAhead: 1, historyWeeks: 10, statistics: st, settings: defaults });
    near(r.lower_ratio, expectedLow); near(r.upper_ratio, expectedHigh); near(r.e, (expectedHigh - expectedLow) / 2);
  }
});
test('two observations, span and distinct weeks are independent calibration gates', () => {
  const s = { ...defaults, minimum_empirical_weeks: 1 };
  assert.equal(stats([obs('2026-01-01', 1)], s).empirical_available, false);
  assert.equal(stats([obs('2026-01-01', 1), obs('2026-01-08', 1)], s).empirical_available, true);
  // Span: 49 days = 7 weeks; 56 days = 8 weeks, with eight week buckets.
  const span = days => Array.from({ length: days }, (_, i) => obs(shiftProjectionDate('2026-01-05', i), 1));
  assert.equal(stats(span(49)).empirical_available, false); assert.equal(stats(span(56)).empirical_available, true);
  const gaps = [0, 7, 14, 21, 28, 35, 70].map(i => obs(shiftProjectionDate('2026-01-05', i), 1));
  assert.equal(stats(gaps).distinct_weeks, 7); assert.equal(stats(gaps).empirical_available, false);
  assert.equal(stats([...gaps, obs('2026-02-16', 1)]).empirical_available, true);
  assert.equal(stats(span(56).map(r => ({ ...r, ratio: 0 }))).empirical_available, false);
});
test('new-dish lambda widening and empirical random floor match the equations', () => {
  const st = { empirical_available: true, low_quantile: 1, high_quantile: 1, median: 1 };
  for (const lambda of [0, 0.5]) {
    const r = dishRange({ expected: 9, e: 0.15, isNew: true, lambda, statistics: st, settings: defaults });
    near(r.new_factor, 2 - lambda); assert.equal(r.source, 'POISSON + VOLUME; NEW WIDENING');
    near(r.lower, Math.max(0, 9 - r.fallback_half_width));
  }
  const r = dishRange({ expected: 9, e: 0.15, isNew: false, statistics: st, settings: defaults });
  near(r.lower, 9 - r.random_half_width); near(r.upper, 9 + r.random_half_width);
  const override = dishRange({ expected: 9, e: 0.15, isNew: false, statistics: stats(), settings: { ...defaults, range_z_override: 2 } });
  near(override.random_half_width, 6);
});
test('coverage controls percentiles and z without a new setting or calibration identity', () => {
  const s = { ...defaults, range_coverage: 0.9 }, sample = [obs('2026-01-01', 1), obs('2026-01-08', 2)];
  const st = stats(sample, s); near(st.p_low, 0.05); near(st.p_high, 0.95); near(st.low_quantile, 1.05);
  const r = dishRange({ expected: 10, e: 0.15, isNew: false, statistics: st, settings: s });
  near(r.z, 1.6448536269514722);
});
test('null and zero stay unavailable or zero without invented percentages', () => {
  for (const expected of [null, 0]) {
    const r = dishRange({ expected, e: 0.15, isNew: false, statistics: stats(), settings: defaults });
    assert.deepEqual([r.lower, r.expected, r.upper], [expected, expected, expected]);
    const v = volumeRange({ expected, daysAhead: 1, historyWeeks: 0, statistics: stats(), settings: defaults });
    assert.deepEqual([v.lower, v.expected, v.upper], [expected, expected, expected]);
  }
});
test('Sunday bias skips its containing week and uses only the latest N weeks', () => {
  const latest = '2026-11-22', rows = [obs('2026-11-22', 1), obs('2026-11-15', 1.2), obs('2026-11-08', 0.8),
    obs('2026-11-01', 1.2), obs('2026-10-25', 0.8)];
  let r = projectionBias(rows, latest, defaults);
  assert.equal(r.weeks[0].until, '2026-11-15'); assert.equal(r.status, 'consistent forecast bias');
  assert.equal(projectionBias(rows.filter(x => x.target_date !== '2026-11-08'), latest, defaults).status, 'INSUFFICIENT HISTORY');
  assert.equal(projectionBias([...rows, obs('2026-11-15', 0.8)], latest, defaults).status, 'NO PERSISTENT BIAS');
  r = projectionBias([obs('2027-01-03', 1.2)], '2027-01-04', defaults); assert.equal(r.weeks[0].from, '2026-12-28');
});

test('shared eligibility excludes each source flag but retains recommended and sold-out dish facts', () => {
  const data = archiveInput(), date = data.history[20].business_date;
  const base = checkedProjectionForecasts(data).observations.filter(r => r.target_date === date);
  assert.ok(base.some(r => r.dish_id !== null));
  for (const patch of [{ complete: false }, { source_covered: false }, { closed: true }, { early_close: true },
    { holiday_keys: ['halloween'] }, ...['isolated_outlier', 'short_run', 'pending_review', 'one_off_event'].map(outlier_status => ({ outlier_status }))]) {
    const copy = structuredClone(data); Object.assign(copy.history[20], patch);
    assert.equal(checkedProjectionForecasts(copy).observations.filter(r => r.target_date === date).length, 0);
  }
  for (const outlier_status of ['active_run', 'confirmed_shift', 'unchecked']) {
    const copy = structuredClone(data); Object.assign(copy.history[20], { outlier_status });
    assert.equal(checkedProjectionForecasts(copy).observations.filter(r => r.target_date === date).length, base.length);
  }
});
test('calibration identity is exact and zero stored forecasts never calibrate a dish', () => {
  for (const patch of [{ model_major: 3 }, { calibration_key: `${golden.calibration_key}|other` }]) {
    const data = archiveInput(); data.archives.forEach(run => Object.assign(run, patch));
    assert.equal(checkedProjectionForecasts(data).observations.length, 0);
  }
  const data = archiveInput(); data.archives.forEach(run => run.nights.forEach(n => { n.expected = 0; }));
  assert.equal(checkedProjectionForecasts(data).observations.length, 0);
});
test('archive corrections select one visible whole run and reject broken chains', () => {
  const data = archiveInput(), parent = data.archives[10], child = structuredClone(parent);
  child.id = id(500); child.supersedes_id = parent.id; child.issued_at = `${parent.run_date}T07:00:00Z`;
  data.archives.push(child);
  const checked = checkedProjectionForecasts(data);
  assert.equal(checked.observations.some(r => r.archive_id === parent.id), false);
  assert.ok(checked.observations.some(r => r.archive_id === child.id));
  child.issued_at = '2026-11-20T12:00:00Z';
  assert.ok(checkedProjectionForecasts(data).observations.some(r => r.archive_id === parent.id));
  child.issued_at = SNAP; child.supersedes_id = id(999); assert.throws(() => checkedProjectionForecasts(data), /archive history/);
});
test('missing actuals and revision mismatches are visible exclusions, never zero sales', () => {
  const data = archiveInput(), fact = data.dishFacts.splice(200, 1)[0];
  let r = checkedProjectionForecasts(data);
  assert.ok(r.excluded.some(x => x.dish_id === fact.dish_id && x.target_date === fact.business_date && x.reasons.includes('missing_dish_actual')));
  fact.source_revision = 'stale'; data.dishFacts.push(fact); r = checkedProjectionForecasts(data);
  assert.ok(r.excluded.some(x => x.reasons.includes('dish_source_revision_mismatch')));
});
test('inclusive 84-day cutoff excludes older and future target dates', () => {
  const data = archiveInput(), r = checkedProjectionForecasts(data);
  assert.equal(r.from, '2026-08-27'); assert.ok(r.observations.some(x => x.target_date === r.from));
  assert.ok(r.observations.some(x => x.target_date === r.through));
  for (const date of ['2026-08-26', ASOF]) {
    const copy = structuredClone(data), run = structuredClone(copy.archives[0]);
    run.id = id(900); run.run_date = shiftProjectionDate(date, -7); run.source_through = shiftProjectionDate(run.run_date, -1);
    run.issued_at = `${run.run_date}T06:00:00Z`; run.nights = [{ ...run.nights[0], target_date: date, days_ahead: 8 }];
    copy.archives = copy.archives.filter(r => r.run_date !== run.run_date); copy.archives.push(run);
    assert.equal(checkedProjectionForecasts(copy).observations.some(x => x.target_date === date), false);
  }
});
test('missing context, invalid values, duplicate rows and tenant leakage fail visibly', () => {
  const changes = [d => { d.restaurantId = null; }, d => { delete d.lastCompleteDate; }, d => { delete d.archives; },
    d => { d.history[0].restaurant_id = id(2); }, d => { d.dishFacts[0].restaurant_id = id(2); },
    d => { d.archives[0].restaurant_id = id(2); }, d => { d.history.push(d.history[0]); },
    d => { d.dishFacts.push(d.dishFacts[0]); }, d => { d.archives.push(d.archives[0]); },
    d => { d.archives[0].nights[0].expected = NaN; }, d => { d.archives[0].nights[0].days_ahead = 99; }];
  for (const change of changes) { const data = archiveInput(); change(data); assert.throws(() => checkedProjectionForecasts(data)); }
});

function pipeline(days = 112) {
  const history = [], dishFacts = [], firstDataDate = shiftProjectionDate(ASOF, -days);
  const styles = ['Comfort/Heavy', 'Light/Fresh', 'Neutral'];
  const dishes = styles.map((style_category, i) => ({ id: id(10 + i), restaurant_id: REST, forecastable: true,
    style_category, is_new: false, is_returning: false, launch_date: '2024-01-01', removed_date: null }));
  for (let i = 0; i < days; i++) {
    const date = shiftProjectionDate(firstDataDate, i); history.push(source(date, 30));
    dishes.forEach(d => dishFacts.push({ restaurant_id: REST, business_date: date, dish_id: d.id,
      units: 10, source_revision: `source:${date}`, recommended: false, sold_out: false }));
  }
  const resolvedSettings = resolveProjectionSettings({ restaurantId: REST, at: SNAP, globalVersion: {
    id: id(3), restaurant_id: null, model_major: 4, effective_at: '2020-01-01T00:00:00Z', settings: { ...defaults } } });
  const calendar = Array.from({ length: 8 }, (_, i) => ({ restaurant_id: REST, business_date: shiftProjectionDate(ASOF, i),
    closed: i === 7, early_close: false, holiday_keys: [], default_factor: i === 7 ? 0 : 1,
    configuration_revision: 1, context_digest: 'a'.repeat(64) }));
  const volume = projectRestaurantVolume({ restaurantId: REST, asOf: ASOF, firstDataDate, resolvedSettings, history, calendar,
    modelVersion: { model_major: 4, logic_revision: 'approved-workbook-v4', reference_sha256: golden.original_sha256,
      released_at: '2020-01-01T00:00:00Z' } });
  const shares = projectDishShares({ restaurantId: REST, asOf: ASOF, snapshotAt: SNAP, resolvedSettings, volume,
    history, styleCategories: styles, dishes, dishFacts, launchHistory: [] });
  return { restaurantId: REST, asOf: ASOF, snapshotAt: SNAP, lastCompleteDate: days ? shiftProjectionDate(ASOF, -1) : null,
    resolvedSettings, volume, shares, history, dishFacts, archives: [] };
}
test('Steps 4 and 5 feed ranges without changing points; closed and partial categories retain their meaning', () => {
  const data = pipeline(), before = structuredClone(data), result = projectProjectionRanges(data);
  assert.deepEqual(data, before); assert.ok(Object.isFrozen(result.nights[0].volume));
  result.nights.forEach((n, i) => {
    near(n.volume.expected, data.volume.nights[i].adjusted_volume); assert.equal(n.confidence, data.volume.nights[i].history.tier);
    n.dishes.forEach(d => assert.ok(0 <= d.lower && d.lower <= d.expected && d.expected <= d.upper));
  });
  assert.deepEqual([result.nights[7].volume.lower, result.nights[7].volume.upper], [0, 0]);
  const partial = structuredClone(data); partial.shares.nights[0].dishes[0].status = 'needs_baseline';
  partial.shares.nights[0].dishes[0].expected_units = null;
  const r = projectProjectionRanges(partial); assert.equal(r.nights[0].dishes[0].lower, null);
  assert.ok(r.nights[0].dishes[1].upper > 0);
});
test('no history or limited history returns null ranges while closed nights remain zero', () => {
  for (const days of [0, 7]) {
    const result = projectProjectionRanges(pipeline(days));
    assert.deepEqual([result.nights[0].volume.lower, result.nights[0].volume.expected, result.nights[0].volume.upper], [null, null, null]);
    assert.equal(result.nights[7].volume.upper, 0);
  }
});
test('persistent bias remains diagnostic and cannot shift the point forecast', () => {
  const data = pipeline();
  data.archives = data.history.slice(-84).map((n, i) => ({ id: id(1000 + i), restaurant_id: REST, model_major: 4,
    calibration_key: data.resolvedSettings.calibration_key, run_date: n.business_date,
    source_through: shiftProjectionDate(n.business_date, -1), issued_at: `${n.business_date}T06:00:00Z`, supersedes_id: null,
    nights: [{ target_date: n.business_date, days_ahead: 1, availability: 'available', expected: 20,
      dishes: [10, 11, 12].map(j => ({ dish_id: id(j), expected: 20 / 3 })) }] }));
  const result = projectProjectionRanges(data).nights[0];
  assert.equal(result.volume.bias.status, 'consistent forecast bias');
  near(result.volume.expected, data.volume.nights[0].adjusted_volume);
  near(result.volume.lower_ratio, 1); near(result.volume.upper_ratio, 1);
});
test('determinism ignores array order and output identity traces changed calibration evidence', () => {
  const data = pipeline(), first = projectProjectionRanges(data), copy = structuredClone(data);
  copy.history.reverse(); copy.dishFacts.reverse(); copy.volume.nights.reverse(); copy.shares.nights.reverse();
  copy.shares.nights.forEach(n => n.dishes.reverse());
  near(projectProjectionRanges(data).provenance.context_digest, first.provenance.context_digest);
  assert.equal(projectProjectionRanges(copy).provenance.context_digest, first.provenance.context_digest);
  assert.deepEqual(projectProjectionRanges(copy).nights, first.nights);
  const arc = archiveInput(); assert.deepEqual(checkedProjectionForecasts(arc), checkedProjectionForecasts({ ...arc,
    history: [...arc.history].reverse(), dishFacts: [...arc.dishFacts].reverse(), archives: [...arc.archives].reverse() }));
});
test('stale provenance, model changes and unsupported range values cannot enter the pipeline', () => {
  for (const change of [d => { d.volume.provenance.model_major = 5; }, d => { d.shares.provenance.volume_context_digest = 'b'.repeat(64); },
    d => { d.resolvedSettings.settings.range_coverage = 0.9; }, d => { d.lastCompleteDate = '2026-11-17'; },
    d => { d.shares.nights[0].adjusted_volume = 999; }]) {
    const data = structuredClone(pipeline()); change(data); assert.throws(() => projectProjectionRanges(data));
  }
});