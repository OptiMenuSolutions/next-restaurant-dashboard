import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTION_DEFAULTS, resolveProjectionSettings } from '../lib/projections/settings.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
import { projectionVolumeEligibility, projectionISOWeekday } from '../lib/projections/eligibility.js';
import { projectRestaurantVolume } from '../lib/projections/volume.js';
import { projectionVolumeDigest } from '../lib/projections/volumeProvenance.js';
import { volumeV4 } from './fixtures/projection-volume-v4.js';

const REST = '10000000-0000-4000-8000-000000000001';
const FOREIGN = '10000000-0000-4000-8000-000000000002';
const GLOBAL = '10000000-0000-4000-8000-000000000101';
const MODEL = { model_major: 4, logic_revision: 'approved-workbook-v4',
  reference_sha256: volumeV4.workbook_sha256, released_at: '2020-01-01T00:00:00Z' };
const ASOF = '2026-11-19';
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const fact = (date, units = 100, extra = {}) => ({ restaurant_id: REST, business_date: date, total_units: units,
  complete: true, source_covered: true, closed: false, early_close: false, holiday_keys: [],
  outlier_status: 'kept', source_revision: `fixture:${date}`, ...extra });
function input(extra = {}) {
  const asOf = extra.asOf || ASOF;
  const settings = { ...PROJECTION_DEFAULTS, ...extra.settings };
  const resolvedSettings = resolveProjectionSettings({ restaurantId: REST, at: `${asOf}T12:00:00Z`,
    globalVersion: { id: GLOBAL, restaurant_id: null, model_major: 4, effective_at: '2020-01-01T00:00:00Z', settings } });
  return { restaurantId: REST, asOf, firstDataDate: '2020-01-01', resolvedSettings,
    modelVersion: { ...MODEL },
    history: [7, 14, 21, 28].map(n => fact(shiftProjectionDate(asOf, -n))),
    calendar: Array.from({ length: settings.horizon_days }, (_, i) => ({ restaurant_id: REST,
      business_date: shiftProjectionDate(asOf, i), closed: false, early_close: false, holiday_keys: [],
      default_factor: 1, configuration_revision: 1, context_digest: 'a'.repeat(64) })),
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'settings')) };
}
const run = extra => projectRestaurantVolume(input(extra));
const first = extra => run(extra).nights[0];

function goldenInput() {
  const history = volumeV4.segments.flatMap(segment => segment.weeks.flat().map((units, i) => {
    const date = shiftProjectionDate(segment.start, i);
    return fact(date, units, volumeV4.flags[date]);
  }));
  const data = input({ settings: volumeV4.settings, history, asOf: volumeV4.as_of, firstDataDate: volumeV4.first_data_date });
  data.calendar = data.calendar.map((row, i) => ({ ...row,
    closed: volumeV4.expected[i].factor === 0,
    holiday_keys: i === 6 ? ['thanksgiving_eve'] : i === 7 ? ['thanksgiving_day'] : [],
    default_factor: volumeV4.expected[i].factor }));
  return data;
}

test('golden: all eight workbook volume results and intermediate values match cached v4 results', () => {
  assert.equal(volumeV4.workbook_sha256, '97e91fb3cf46e6b4726cb121f00f8b70f3fcb42eb914059fdf8fa40a6865b882');
  const actual = projectRestaurantVolume(goldenInput());
  actual.nights.forEach((night, i) => {
    const expected = volumeV4.expected[i];
    assert.equal(night.business_date, expected.business_date);
    for (const key of ['L', 'raw_slope', 'capped_slope', 'h', 'R']) near(night.recent[key], expected[key], 0.01);
    for (const key of ['L_LY', 'S', 'A']) near(night.seasonal[key], expected[key], 0.01);
    near(night.base_volume, expected.base, 0.01);
    near(night.adjusted_volume, expected.adjusted, 0.01);
  });
});

const series = (units, asOf = ASOF) => units.map((value, i) => fact(shiftProjectionDate(asOf, -7 * (units.length - i)), value));
function withLY(data, units = 100) {
  const from = shiftProjectionDate(data.asOf, -56 - data.resolvedSettings.settings.year_alignment_days);
  const end = shiftProjectionDate(data.asOf, -data.resolvedSettings.settings.year_alignment_days + 14);
  for (let date = from; date <= end; date = shiftProjectionDate(date, 7)) data.history.push(fact(date, units));
  return data;
}

test('flat history uses the configured blend with a neutral benchmark when LY is missing', () => {
  const row = first();
  near(row.recent.L, 100); near(row.recent.raw_slope, 0); near(row.adjusted_volume, 100);
  assert.equal(row.seasonal.own_ly_available, false);
  assert.deepEqual(row.seasonal.reasons, ['insufficient_ly_base', 'insufficient_ly_target']);
  assert.equal(row.blend.recent, 0.5); assert.equal(row.blend.seasonal, 0.5);
  assert.deepEqual(row.seasonal.benchmark, { status: 'neutral_placeholder', ratio: 1,
    strength: 0.5, public_enabled: true, used: true });
});

for (const [name, values, level, slope, capped, expected] of [
  ['growth', [20, 40, 60, 80, 100, 120, 140, 160], 160, 20, 8, 166.4],
  ['decline', [160, 140, 120, 100, 80, 60, 40, 20], 20, -20, -1, 19.2],
]) test(`${name} hits the signed slope cap before damping`, () => {
  const row = first({ history: series(values) });
  near(row.recent.L, level); near(row.recent.raw_slope, slope);
  near(row.recent.capped_slope, capped); near(row.recent.R, expected);
});

test('the h=2 gap starts at the last eligible weekday, with both damping terms', () => {
  const history = series([50, 60, 70, 80, 90]);
  history.at(-1).outlier_status = 'isolated_outlier';
  const row = first({ history });
  assert.equal(row.recent.h, 2);
  near(row.recent.damping_sum, 0.8 + 0.8 ** 2);
  assert.ok(row.window.excluded.some(item => item.reasons.includes('excluded_outlier')));
});

test('three points use their weighted level; four points enable a fit', () => {
  const three = first({ history: series([80, 100, 120]) });
  assert.equal(three.recent.method, 'weighted_mean'); near(three.recent.raw_slope, 0);
  const w = 0.5 ** (1 / 4);
  near(three.recent.L, (80 * w ** 2 + 100 * w + 120) / (w ** 2 + w + 1));
  const four = first({ history: series([60, 80, 100, 120]) });
  assert.equal(four.recent.method, 'weighted_fit'); near(four.recent.raw_slope, 20);
});

test('the window extends in whole weeks only until the baseline minimum is met', () => {
  const row = first({ history: [fact(shiftProjectionDate(ASOF, -7), 80), fact(shiftProjectionDate(ASOF, -63), 120)] });
  assert.equal(row.status, 'ok'); assert.equal(row.window.weeks, 9); assert.equal(row.window.extended, true);
  assert.equal(row.window.eligible.length, 2); assert.equal(row.recent.method, 'weighted_mean');
});

test('insufficient history stops at the maximum and displays no invented volume', () => {
  const row = first({ history: [fact(shiftProjectionDate(ASOF, -7))] });
  assert.equal(row.status, 'needs_baseline'); assert.equal(row.window.weeks, 16);
  assert.equal(row.base_volume, null); assert.equal(row.adjusted_volume, null);
});

test('a closed target is zero even without baseline; an open holiday still needs a baseline', () => {
  const data = input({ history: [] });
  Object.assign(data.calendar[0], { closed: true, default_factor: 0 });
  const closed = projectRestaurantVolume(data).nights[0];
  assert.equal(closed.status, 'closed'); assert.equal(closed.adjusted_volume, 0);
  Object.assign(data.calendar[0], { closed: false, default_factor: 1.2, holiday_keys: ['thanksgiving_eve'] });
  const holiday = projectRestaurantVolume(data).nights[0];
  assert.equal(holiday.status, 'needs_baseline'); assert.equal(holiday.adjusted_volume, null);
});

test('holiday and early-close factors adjust the base exactly once and preserve its inputs', () => {
  for (const extra of [{ holiday_keys: ['thanksgiving_eve'], default_factor: 1.2 },
    { early_close: true, default_factor: 0.6 }]) {
    const data = input(); Object.assign(data.calendar[0], extra);
    const row = projectRestaurantVolume(data).nights[0];
    near(row.base_volume, 100); near(row.adjusted_volume, 100 * extra.default_factor);
    near(row.recent.R, 100); assert.equal(row.factor, extra.default_factor);
  }
});

test('A uses L rather than R, and the blend uses versioned weights', () => {
  const data = withLY(input({ history: series([80, 90, 100, 110]), settings: { volume_recent_weight: 0.25 } }));
  const row = projectRestaurantVolume(data).nights[0];
  near(row.seasonal.S, 1); near(row.seasonal.A, row.recent.L);
  assert.notEqual(row.seasonal.A, row.recent.R);
  near(row.base_volume, 0.25 * row.recent.R + 0.75 * row.seasonal.A);
});

test('LY fits stop at the current latest eligible weekday shifted by 364 days', () => {
  const data = withLY(input({ history: series([80, 90, 100, 110]) }));
  const row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.seasonal.fit.latest_date, shiftProjectionDate(row.recent.latest_date, -364));
  assert.ok(row.seasonal.fit.nights.every(n => n.business_date <= row.seasonal.base_window.until));
});

test('LY target holidays are excluded; one usable week is sufficient and no weeks uses neutral seasonality', () => {
  const data = withLY(input());
  const centre = shiftProjectionDate(ASOF, -364);
  for (const date of [centre, shiftProjectionDate(centre, 7)]) {
    data.history.find(n => n.business_date === date).holiday_keys = ['thanksgiving_day'];
  }
  let row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.seasonal.own_ly_available, true); assert.equal(row.seasonal.target_window.eligible.length, 1);
  data.history.find(n => n.business_date === shiftProjectionDate(centre, -7)).complete = false;
  row = projectRestaurantVolume(data).nights[0];
  near(row.seasonal.A, row.recent.L); assert.equal(row.blend.recent, 0.5);
  assert.equal(row.seasonal.benchmark.used, true);
  assert.ok(row.seasonal.reasons.includes('insufficient_ly_target'));
});

test('three LY base nights use the neutral benchmark; four permit own LY', () => {
  const data = withLY(input());
  const cutoff = shiftProjectionDate(ASOF, -385);
  data.history = data.history.filter(n => n.business_date >= cutoff);
  let row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.seasonal.fit, null); assert.equal(row.seasonal.own_ly_available, false);
  assert.equal(row.seasonal.benchmark.used, true);
  data.history.push(fact(shiftProjectionDate(ASOF, -392), 80));
  row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.seasonal.fit.method, 'weighted_fit'); assert.equal(row.seasonal.own_ly_available, true);
});

test('both seasonal bounds are enforced and zero LY levels use a flagged neutral ratio', () => {
  for (const [targetUnits, expected] of [[1000, 1.33], [0, 0.75]]) {
    const data = withLY(input());
    data.history.filter(n => n.business_date >= shiftProjectionDate(ASOF, -371) && n.business_date <= shiftProjectionDate(ASOF, -357))
      .forEach(n => { n.total_units = targetUnits; });
    near(projectRestaurantVolume(data).nights[0].seasonal.S, expected);
  }
  const data = withLY(input(), 0);
  const row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.seasonal.S, 1); assert.equal(row.seasonal.zero_denominator_neutral, true);
});

test('volume quantities floor at zero while the raw decline remains signed', () => {
  const row = first({ history: series([1000, 0, 0, 0]) });
  assert.ok(row.recent.raw_slope < 0); assert.ok(row.recent.raw_level < 0);
  assert.equal(row.recent.L, 0); assert.equal(row.recent.R, 0); assert.equal(row.adjusted_volume, 0);
});

test('one shared rule excludes every volume flag but retains recommended and sold-out demand', () => {
  const options = { restaurantId: REST, asOf: ASOF };
  for (const [change, reason] of [[{ complete: false }, 'incomplete'], [{ source_covered: false }, 'not_pos_covered'],
    [{ closed: true }, 'closed'], [{ early_close: true }, 'early_close'],
    [{ holiday_keys: ['halloween'] }, 'holiday'], [{ outlier_status: 'one_off_event' }, 'excluded_outlier']]) {
    assert.ok(projectionVolumeEligibility(fact('2026-11-12', 100, change), options).reasons.includes(reason));
  }
  assert.equal(projectionVolumeEligibility(fact('2026-11-12', 100,
    { recommended: true, sold_out: true, recommendation_flags_complete: false }), options).eligible, true);
  assert.equal(projectionVolumeEligibility(fact(ASOF), options).eligible, false);
});

test('future and unfinished as-of dates cannot change forecasts or their digest', () => {
  const data = goldenInput(); const before = projectRestaurantVolume(data);
  data.history.push(fact(ASOF, 999999), fact(shiftProjectionDate(ASOF, 1), 999999));
  assert.deepEqual(projectRestaurantVolume(data), before);
});

test('input ordering is irrelevant; full precision and immutability survive serialization', () => {
  const data = goldenInput(); const before = structuredClone(data);
  const a = projectRestaurantVolume(data);
  assert.deepEqual(data, before);
  data.history.reverse(); data.calendar.reverse();
  data.modelVersion = Object.fromEntries(Object.entries(data.modelVersion).reverse());
  assert.deepEqual(projectRestaurantVolume(data), a);
  assert.ok(Object.isFrozen(a.nights[0].recent.nights[0]));
  assert.equal(Reflect.set(a.nights[0], 'base_volume', 0), false);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  assert.notEqual(a.nights[0].adjusted_volume, Math.round(a.nights[0].adjusted_volume));
});

test('date arithmetic spans leap day and the 364-day alignment without weekday drift', () => {
  const date = '2024-02-29'; const data = input({ asOf: date, history: series([80, 90, 100], date) });
  const row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.recent.h, 1);
  assert.equal(shiftProjectionDate(date, -364), '2023-03-02');
  assert.equal(projectionISOWeekday(date), projectionISOWeekday(shiftProjectionDate(date, -364)));
  assert.equal(projectRestaurantVolume(input({ asOf: '2026-12-31', history: series([80, 90, 100], '2026-12-31') })).nights[1].business_date, '2027-01-01');
});

test('damping handles zero, one and a value close to one', () => {
  for (const phi of [0, 1, 1 - 1e-12]) {
    const data = input({ history: series([80, 90, 100]), settings: { trend_damping: phi } });
    const row = projectRestaurantVolume(data).nights[7];
    near(row.recent.damping_sum, phi + phi ** 2, 1e-12);
  }
});

test('missing, foreign and unsupported model or settings contexts reject', () => {
  for (const mutate of [d => { delete d.asOf; }, d => { delete d.firstDataDate; }, d => { delete d.resolvedSettings; },
    d => { delete d.modelVersion; }, d => { d.modelVersion = []; }, d => { d.modelVersion.model_major = 5; },
    d => { d.modelVersion.logic_revision = 'another-model'; }, d => { d.modelVersion.released_at = '2026-11-19'; },
    d => { d.modelVersion.reference_sha256 = 'invalid'; },
    d => { d.resolvedSettings.model_major = 5; }, d => { d.resolvedSettings.restaurant_id = FOREIGN; },
    d => { d.resolvedSettings.settings_digest = 'f'.repeat(64); }]) {
    const data = structuredClone(input()); mutate(data); assert.throws(() => projectRestaurantVolume(data));
  }
});

test('bad, duplicate and cross-tenant source rows never become empty successful reads', () => {
  for (const mutate of [d => { d.history.push({ ...d.history[0] }); },
    d => { d.history[0].restaurant_id = FOREIGN; }, d => { d.history[0].total_units = -1; },
    d => { d.history[0].total_units = NaN; }, d => { d.history[0].total_units = '100'; },
    d => { delete d.history[0].source_covered; }, d => { d.history[0].outlier_status = 'typo'; },
    d => { d.history[0].holiday_keys = ['halloween', 'halloween']; },
    d => { d.calendar.pop(); }, d => { d.calendar[0] = { ...d.calendar[1] }; },
    d => { d.calendar[0].restaurant_id = FOREIGN; }, d => { d.calendar[0].default_factor = -1; },
    d => { d.calendar[0].default_factor = 1.2; }, d => { delete d.calendar[0].context_digest; }]) {
    const data = structuredClone(input()); mutate(data); assert.throws(() => projectRestaurantVolume(data));
  }
});

test('overflow and invalid windows fail rather than emitting non-finite audit values', () => {
  assert.throws(() => first({ history: series([1e308, 1e308, 1e308]) }));
  assert.throws(() => first({ settings: { base_window_weeks: 8.5 } }));
  assert.throws(() => first({ settings: { year_alignment_days: 365 } }));
  assert.throws(() => first({ settings: { volume_half_life_weeks: 1e-300 } }));
});

test('the digest records source corrections, calendar provenance and model identity', () => {
  const data = goldenInput(); const a = projectRestaurantVolume(data).provenance.context_digest;
  data.history[0].source_revision = 'corrected';
  const b = projectRestaurantVolume(data).provenance.context_digest; assert.notEqual(a, b);
  data.calendar[0].context_digest = 'b'.repeat(64);
  const c = projectRestaurantVolume(data).provenance.context_digest; assert.notEqual(b, c);
  data.modelVersion.released_at = '2020-01-02T00:00:00Z';
  assert.notEqual(projectRestaurantVolume(data).provenance.context_digest, c);
  assert.equal(projectionVolumeDigest({ a: 1, b: 2 }), projectionVolumeDigest({ b: 2, a: 1 }));
});

test('recency weights halve exactly every four weeks and a missing night is never a zero sale', () => {
  const row = first({ history: [fact(shiftProjectionDate(ASOF, -7), 100), fact(shiftProjectionDate(ASOF, -35), 100)] });
  const nights = row.recent.nights;
  near(nights[0].weight / nights[1].weight, 0.5);
  assert.ok(row.window.excluded.some(n => n.reasons.includes('missing_night')));
  assert.equal(row.recent.nights.length, 2);
});

test('a first-data cutoff excludes older supplied observations without converting them into zeros', () => {
  const data = input({ firstDataDate: shiftProjectionDate(ASOF, -14) });
  data.history.push(fact(shiftProjectionDate(ASOF, -1)));
  const row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.recent.nights.length, 2);
  assert.ok(row.window.excluded.some(n => n.reasons.includes('before_first_data')));
  near(row.base_volume, 100);
});

test('configured seasonal weights zero and one retain their exact meanings when LY is usable', () => {
  for (const weight of [0, 1]) {
    const row = projectRestaurantVolume(withLY(input({ history: series([80, 90, 100, 110]),
      settings: { volume_recent_weight: weight } }))).nights[0];
    near(row.base_volume, weight === 0 ? row.seasonal.A : row.recent.R);
  }
});

test('a disabled public-data switch still permits a labeled neutral assumption, without fabricating own LY', () => {
  const data = withLY(input({ settings: { public_benchmarks_enabled: false } }));
  const cutoff = shiftProjectionDate(ASOF, -371);
  data.history = data.history.filter(n => n.business_date >= cutoff);
  const row = projectRestaurantVolume(data).nights[0];
  assert.ok(row.seasonal.reasons.includes('insufficient_ly_base'));
  assert.equal(row.seasonal.own_ly_available, false);
  assert.equal(row.seasonal.benchmark.status, 'neutral_placeholder');
  assert.equal(row.seasonal.benchmark.public_enabled, false);
  assert.equal(row.seasonal.benchmark.used, true);
  near(row.base_volume, row.blend.recent * row.recent.R + row.blend.seasonal * row.recent.L);
});

test('shared eligibility handles incomplete unavailable units and includes confirmed shifts', () => {
  const options = { restaurantId: REST, asOf: ASOF };
  const unavailable = projectionVolumeEligibility(fact('2026-11-12', null, { complete: false, source_revision: null }), options);
  assert.deepEqual(unavailable.reasons, ['incomplete', 'invalid_units']);
  assert.equal(projectionVolumeEligibility(fact('2026-11-12', 100, { outlier_status: 'confirmed_shift' }), options).eligible, true);
  assert.throws(() => projectionVolumeEligibility(fact('2026-11-12', Infinity, { complete: false }), options));
});

test('provenance uses the existing registered v4 model and settings identities only', () => {
  const result = run();
  assert.equal(result.provenance.model_major, 4);
  assert.equal(result.provenance.logic_revision, 'approved-workbook-v4');
  assert.equal(result.provenance.calibration_key, '4|a=0.5|b=0.5|phi=0.8|vh=4|sh=4');
  assert.deepEqual(result.provenance.model_version, MODEL);
  assert.equal(Object.hasOwn(result.provenance, 'volume_policy_version'), false);
  assert.equal(Object.hasOwn(result.nights[0].provenance, 'policy_version_id'), false);
});