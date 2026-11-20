import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTION_DEFAULTS, resolveProjectionSettings } from '../lib/projections/settings.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';
import { projectRestaurantVolume } from '../lib/projections/volume.js';
import { volumeV4 } from './fixtures/projection-volume-v4.js';
import { volumeV4Limited } from './fixtures/projection-volume-v4-limited.js';

const REST = '10000000-0000-4000-8000-000000000001';
const VERSION = '10000000-0000-4000-8000-000000000101';
const ASOF = '2026-11-19';
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const fact = (date, units = 100, extra = {}) => ({ restaurant_id: REST, business_date: date,
  total_units: units, complete: true, source_covered: true, closed: false, early_close: false,
  holiday_keys: [], outlier_status: 'kept', source_revision: `tier:${date}`, ...extra });
function context(days, overrides = {}) {
  const firstDataDate = shiftProjectionDate(ASOF, -days);
  const history = Array.from({ length: days }, (_, i) => fact(shiftProjectionDate(firstDataDate, i)));
  const resolvedSettings = resolveProjectionSettings({ restaurantId: REST, at: `${ASOF}T12:00:00Z`,
    globalVersion: { id: VERSION, restaurant_id: null, model_major: 4, effective_at: '2020-01-01T00:00:00Z',
      settings: { ...PROJECTION_DEFAULTS, ...overrides } } });
  return { restaurantId: REST, asOf: ASOF, firstDataDate, history, resolvedSettings,
    modelVersion: { model_major: 4, logic_revision: 'approved-workbook-v4',
      reference_sha256: volumeV4.workbook_sha256, released_at: '2020-01-01T00:00:00Z' },
    calendar: Array.from({ length: resolvedSettings.settings.horizon_days }, (_, i) => ({ restaurant_id: REST,
      business_date: shiftProjectionDate(ASOF, i), closed: false, early_close: false, holiday_keys: [],
      default_factor: 1, configuration_revision: 1, context_digest: 'a'.repeat(64) })) };
}

for (const [days, tier] of [[13, 'needs_baseline'], [14, 'limited_history'], [15, 'limited_history'],
  [27, 'limited_history'], [28, 'cold_start'], [29, 'cold_start'],
  [55, 'cold_start'], [56, 'benchmark_seasonality'], [57, 'benchmark_seasonality'],
  [363, 'benchmark_seasonality'], [364, 'own_seasonality'], [365, 'own_seasonality']]) {
  test(`v4 history tier at ${days} days is ${tier}`, () => {
    const row = projectRestaurantVolume(context(days)).nights[0];
    near(row.history.weeks, days / 7);
    assert.equal(row.history.tier, tier);
    assert.equal(row.history.cold_start, days < 56);
    assert.equal(row.history.own_seasonality_allowed, days >= 364);
    assert.equal(row.status, days < 14 ? 'needs_baseline' : 'ok');
    if (days < 14) assert.equal(row.adjusted_volume, null);
    else {
      near(row.base_volume, 100);
      assert.equal(row.recent.method, days < 28 ? 'weighted_mean' : 'weighted_fit');
    }
  });
}

test('each history-tier boundary follows overridden versioned settings', () => {
  const settings = { minimum_history_weeks: 3, minimum_trend_weeks: 5, cold_start_weeks: 9, own_seasonality_weeks: 60 };
  for (const [days, tier] of [[20, 'needs_baseline'], [21, 'limited_history'], [34, 'limited_history'],
    [35, 'cold_start'], [62, 'cold_start'], [63, 'benchmark_seasonality'],
    [419, 'benchmark_seasonality'], [420, 'own_seasonality']]) {
    assert.equal(projectRestaurantVolume(context(days, settings)).nights[0].history.tier, tier);
  }
});

test('minimum_trend_weeks controls the eligible-point threshold, without a separate policy', () => {
  const data = context(70, { minimum_trend_weeks: 5 });
  data.history = [7, 14, 21, 28].map((n, i) => fact(shiftProjectionDate(ASOF, -n), 140 - i * 10));
  let row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.recent.method, 'weighted_mean'); near(row.recent.raw_slope, 0);
  data.history.push(fact(shiftProjectionDate(ASOF, -35), 100));
  row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.recent.method, 'weighted_fit'); near(row.recent.raw_slope, 10);
});

test('an inadequate weekday count still needs baseline after reaching the maximum lookback', () => {
  const data = context(140, { minimum_weekday_nights: 3, maximum_volume_lookback_weeks: 10 });
  data.history = [7, 14, 77].map(n => fact(shiftProjectionDate(ASOF, -n)));
  const row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.history.needs_baseline, false);
  assert.equal(row.status, 'needs_baseline'); assert.equal(row.window.weeks, 10);
  assert.equal(row.adjusted_volume, null);
});

test('neutral seasonality retains the configured blend rather than using R alone', () => {
  const data = context(70, { volume_recent_weight: 0.25 });
  data.history = [7, 14, 21, 28].map((n, i) => fact(shiftProjectionDate(ASOF, -n), 140 - i * 10));
  const row = projectRestaurantVolume(data).nights[0];
  assert.ok(row.recent.R > row.recent.L);
  near(row.seasonal.A, row.recent.L); near(row.seasonal.S, 1);
  near(row.base_volume, 0.25 * row.recent.R + 0.75 * row.recent.L);
  assert.notEqual(row.base_volume, row.recent.R);
  assert.equal(row.seasonal.benchmark.used, true);
});

test('LY usability requires the configured number of eligible nights', () => {
  const data = context(420, { minimum_ly_weekday_nights: 5 });
  const end = shiftProjectionDate(ASOF, -371);
  const keep = new Set([0, 7, 14, 21].map(n => shiftProjectionDate(end, -n)));
  data.history = data.history.filter(n => n.business_date > end || keep.has(n.business_date));
  let row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.seasonal.own_ly_available, false); assert.equal(row.seasonal.L_LY, null);
  data.history.push(fact(shiftProjectionDate(end, -28)));
  row = projectRestaurantVolume(data).nights[0];
  assert.equal(row.seasonal.own_ly_available, true); near(row.seasonal.L_LY, 100);
});

test('snapshot maturity uses the last complete POS-covered date, not the clock or latest failed sync', () => {
  const data = context(28);
  data.history.at(-1).complete = false;
  let row = projectRestaurantVolume(data).nights[0];
  near(row.history.weeks, 27 / 7); assert.equal(row.history.tier, 'limited_history');
  data.history.at(-2).source_covered = false;
  row = projectRestaurantVolume(data).nights[0];
  near(row.history.weeks, 26 / 7);
});

test('limited-history workbook component golden preserves cached values and discloses its Census proxy', () => {
  const fixture = volumeV4Limited;
  const data = context(14);
  data.firstDataDate = fixture.first_data_date;
  data.history = fixture.history.map(([date, units, status]) => fact(date, units, { outlier_status: status }));
  data.calendar = data.calendar.map((row, i) => ({ ...row,
    closed: fixture.expected[i].factor === 0, default_factor: fixture.expected[i].factor,
    holiday_keys: i === 6 ? ['thanksgiving_eve'] : i === 7 ? ['thanksgiving_day'] : [] }));
  const result = projectRestaurantVolume(data);
  result.nights.forEach((row, i) => {
    const cached = fixture.expected[i];
    near(row.history.weeks, fixture.history_weeks);
    assert.equal(row.window.eligible.length, cached.eligible_nights);
    assert.equal(row.history.tier, 'limited_history');
    if (cached.eligible_nights >= data.resolvedSettings.settings.minimum_weekday_nights) {
      near(row.recent.L, cached.L); near(row.recent.R, cached.R); near(row.recent.raw_slope, cached.raw_slope);
      near(row.recent.h, cached.h);
      near(row.base_volume, cached.L);
      near(row.adjusted_volume, cached.L * cached.factor);
      assert.notEqual(cached.S, row.seasonal.S); // Cached case uses Census proxy inputs; Step 4 uses neutral.
    } else {
      assert.equal(row.status, row.calendar.closed ? 'closed' : 'needs_baseline');
      assert.equal(row.base_volume, null);
    }
  });
});

test('the default slope threshold is checked immediately below, at and above four points', () => {
  for (const count of [3, 4, 5]) {
    const data = context(70);
    data.history = Array.from({ length: count }, (_, i) => fact(shiftProjectionDate(ASOF, -7 * (i + 1)), 140 - i * 10));
    const row = projectRestaurantVolume(data).nights[0];
    assert.equal(row.recent.method, count < 4 ? 'weighted_mean' : 'weighted_fit');
    near(row.recent.raw_slope, count < 4 ? 0 : 10);
  }
});

test('the default LY threshold is checked immediately below, at and above four nights', () => {
  for (const count of [3, 4, 5]) {
    const data = context(420);
    const end = shiftProjectionDate(ASOF, -371);
    const keep = new Set(Array.from({ length: count }, (_, i) => shiftProjectionDate(end, -7 * i)));
    data.history = data.history.filter(n => n.business_date > end || keep.has(n.business_date));
    const row = projectRestaurantVolume(data).nights[0];
    assert.equal(row.seasonal.base_window.eligible.length, count);
    assert.equal(row.seasonal.own_ly_available, count >= 4);
    assert.equal(row.seasonal.benchmark.used, count < 4);
  }
});