import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECTION_DEFAULTS as D,
  validateProjectionSettings,
  resolveProjectionSettings,
  projectionCalibrationKey,
  projectionSettingsDigest,
  assertProjectionModelRevision,
  canUseProjectionPooledBenchmarks,
} from '../lib/projections/settings.js';

const REST = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const VERSION = '20000000-0000-4000-8000-000000000001';
const OVERRIDE = '20000000-0000-4000-8000-000000000002';
const AT = '2026-11-19T10:00:00Z';

const globalVersion = () => ({
  id: VERSION,
  model_major: 4,
  effective_at: AT,
  settings: { ...D },
});

const restaurantVersion = settings => ({
  id: OVERRIDE,
  restaurant_id: REST,
  model_major: 4,
  effective_at: AT,
  settings,
});

const resolve = extra => resolveProjectionSettings({
  restaurantId: REST,
  at: AT,
  globalVersion: globalVersion(),
  ...extra,
});

test('approved defaults retain the v4 calibration identity and safe rollout switches', () => {
  assert.equal(
    projectionCalibrationKey(4, D),
    '4|a=0.5|b=0.5|phi=0.8|vh=4|sh=4'
  );
  assert.equal(D.enabled, false);
  assert.equal(D.pooled_benchmarks_enabled, false);
  assert.equal(D.horizon_days, 8);
  assert.equal(D.post_run_nights, 3);
  assert.equal(D.business_day_cutoff_minutes, 240);
});

test('a complete stored version is required, without silent default substitution', () => {
  assert.throws(() => resolve({ globalVersion: null }), /object/);

  const g = globalVersion();
  delete g.settings.volume_half_life_weeks;

  assert.throws(
    () => resolve({ globalVersion: g }),
    /Missing setting/
  );
});

test('same-tenant overrides merge without mutating either input', () => {
  const g = globalVersion();
  const o = restaurantVersion({ volume_recent_weight: 0.6 });
  const result = resolve({ globalVersion: g, restaurantVersion: o });

  assert.equal(result.settings.volume_recent_weight, 0.6);
  assert.equal(result.settings.base_window_weeks, 8);
  assert.equal(g.settings.volume_recent_weight, 0.5);
  assert.deepEqual(o.settings, { volume_recent_weight: 0.6 });
  assert.equal(result.restaurant_version_id, OVERRIDE);
});

test('foreign-tenant overrides and missing restaurant context are rejected', () => {
  assert.throws(() => resolve({
    restaurantVersion: {
      ...restaurantVersion({}),
      restaurant_id: OTHER,
    },
  }), /another tenant/);

  assert.throws(
    () => resolve({ restaurantId: null }),
    /restaurant ID/
  );
});

test('future versions are rejected while an exactly effective version is accepted', () => {
  assert.equal(resolve().global_version_id, VERSION);

  assert.throws(() => resolve({
    globalVersion: {
      ...globalVersion(),
      effective_at: '2026-11-20T00:00:00Z',
    },
  }), /not effective/);

  assert.throws(() => resolve({
    restaurantVersion: {
      ...restaurantVersion({}),
      effective_at: '2026-11-20T00:00:00Z',
    },
  }), /not effective/);
});

test('an override cannot cross major model versions', () => {
  assert.throws(() => resolve({
    restaurantVersion: {
      ...restaurantVersion({}),
      model_major: 3,
    },
  }), /another major/);
});

test('a restaurant version cannot be substituted for the global version', () => {
  assert.throws(() => resolve({
    globalVersion: {
      ...globalVersion(),
      restaurant_id: REST,
    },
  }), /must not belong/);
});

test('version and resolution timestamps require explicit offsets, not date literals', () => {
  for (const at of [
    null,
    '2026-11-19',
    '2026-11-19T10:00:00',
    'invalid',
  ]) {
    assert.throws(() => resolve({ at }), /timestamp/);
  }

  assert.equal(
    resolve({ at: '2026-11-19T05:00:00-05:00' }).global_version_id,
    VERSION
  );
});

test('unknown settings cannot silently change a configuration', () => {
  assert.throws(() => validateProjectionSettings({
    ...D,
    browser_timezone: 'UTC',
  }), /Unknown setting/);

  assert.throws(() => resolve({
    restaurantVersion: restaurantVersion({ base_window_week: 9 }),
  }), /Unknown setting/);
});

test('invalid scalar types and non-finite values are rejected', () => {
  for (const value of [null, NaN, Infinity, '4']) {
    assert.throws(() => validateProjectionSettings({
      ...D,
      volume_half_life_weeks: value,
    }));
  }

  assert.throws(() => validateProjectionSettings({
    ...D,
    pooled_benchmarks_enabled: 'false',
  }), /boolean/);

  assert.throws(() => validateProjectionSettings({
    ...D,
    post_run_nights: 2.5,
  }), /integer/);
});

test('calendar smoothing, bounds and coupled windows are validated after merging', () => {
  for (const settings of [
    { seasonal_smoothing_weeks: 2 },
    { outlier_ratio_min: 1 },
    { outlier_ratio_max: 0.9 },
    { seasonal_ratio_min: 1.1 },
    { launch_index_min: 1.2 },
    { range_coverage: 1 },
    { base_window_weeks: 17 },
    { empirical_lookback_weeks: 4 },
    { minimum_history_weeks: 5 },
    { volume_half_width_far: 0.1 },
  ]) {
    assert.throws(() => resolve({
      restaurantVersion: restaurantVersion(settings),
    }));
  }
});

test('pooled privacy floor cannot be lowered by a restaurant', () => {
  assert.throws(() => resolve({
    restaurantVersion: restaurantVersion({
      minimum_pooled_restaurants: 4,
    }),
  }), /at least 5/);

  assert.equal(resolve({
    restaurantVersion: restaurantVersion({
      minimum_pooled_restaurants: 8,
    }),
  }).settings.minimum_pooled_restaurants, 8);
});

test('wall-clock cutoffs and sync buffers accept their valid boundaries', () => {
  for (const n of [0, 1439]) {
    assert.equal(resolve({
      restaurantVersion: restaurantVersion({
        business_day_cutoff_minutes: n,
      }),
    }).settings.business_day_cutoff_minutes, n);
  }

  for (const n of [-1, 1440]) {
    assert.throws(() => resolve({
      restaurantVersion: restaurantVersion({
        business_day_cutoff_minutes: n,
      }),
    }));
  }

  assert.throws(() => resolve({
    restaurantVersion: restaurantVersion({
      sync_buffer_minutes: -1,
    }),
  }));
});

test('nullable z override is deliberate, other optional numeric nulls are invalid', () => {
  assert.equal(resolve().settings.range_z_override, null);

  assert.equal(resolve({
    restaurantVersion: restaurantVersion({
      range_z_override: 1.64,
    }),
  }).settings.range_z_override, 1.64);

  assert.throws(() => resolve({
    restaurantVersion: restaurantVersion({
      volume_recent_weight: null,
    }),
  }));
});

test('snapshots are immutable and deterministic regardless of input key order', () => {
  const reversed = Object.fromEntries(Object.entries(D).reverse());

  assert.equal(
    projectionSettingsDigest(D),
    projectionSettingsDigest(reversed)
  );
  assert.deepEqual(resolve(), resolve());

  const result = resolve();

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.settings), true);

  assert.equal(
    Reflect.set(result.settings, 'base_window_weeks', 20),
    false
  );
  assert.equal(
    Reflect.set(result, 'model_major', 99),
    false
  );

  assert.equal(result.settings.base_window_weeks, 8);
  assert.equal(result.model_major, 4);

  assert.match(result.settings_digest, /^[0-9a-f]{64}$/);
});

test('all settings changes are traceable, including those outside the five-key calibration label', () => {
  const next = { ...D, base_window_weeks: 9 };

  assert.notEqual(
    projectionSettingsDigest(D),
    projectionSettingsDigest(next)
  );
});

for (const key of [
  'volume_recent_weight',
  'category_base_weight',
  'trend_damping',
  'volume_half_life_weeks',
  'share_half_life_weeks',
]) {
  test(`global ${key} changes require a new major version`, () => {
    const previous = {
      model_major: 4,
      logic_revision: 'v4',
      settings: D,
    };

    const settings = {
      ...D,
      [key]: key.includes('half_life') ? 5 : 0.7,
    };

    assert.throws(() => assertProjectionModelRevision(
      previous,
      { ...previous, settings }
    ), /new major/);

    assert.equal(assertProjectionModelRevision(
      previous,
      { ...previous, model_major: 5, settings }
    ), true);
  });
}

test('formula revisions require a new major and model versions cannot go backwards', () => {
  const previous = {
    model_major: 4,
    logic_revision: 'v4',
    settings: D,
  };

  assert.throws(() => assertProjectionModelRevision(
    previous,
    { ...previous, logic_revision: 'v5' }
  ), /new major/);

  assert.throws(() => assertProjectionModelRevision(
    previous,
    { ...previous, model_major: 3 }
  ), /backwards/);

  assert.equal(assertProjectionModelRevision(
    previous,
    { ...previous, model_major: 5, logic_revision: 'v5' }
  ), true);
});

test('pool participation cannot be enabled or disabled through a restaurant override', () => {
  for (const value of [true, false]) {
    assert.throws(() => validateProjectionSettings(
      { pooled_benchmarks_enabled: value },
      { partial: true }
    ), /global-only/);

    assert.throws(() => resolve({
      restaurantVersion: restaurantVersion({
        pooled_benchmarks_enabled: value,
      }),
    }), /global-only/);
  }
});

const poolPermission = () => ({
  restaurant_id: REST,
  enabled: true,
  agreement_permits: true,
  agreement_version: 'reviewed-v1',
});

const pooled = extra => canUseProjectionPooledBenchmarks({
  restaurantId: REST,
  settings: { ...D, pooled_benchmarks_enabled: true },
  poolPermission: poolPermission(),
  ...extra,
});

test('the global pool switch and agreement permission are both required', () => {
  assert.equal(pooled(), true);
  assert.equal(pooled({ settings: D }), false);
  assert.equal(pooled({ poolPermission: null }), false);
});

test('revoked, disabled or undocumented pool permission remains unusable', () => {
  for (const change of [
    { enabled: false },
    { agreement_permits: false },
    { agreement_version: '' },
  ]) {
    assert.equal(pooled({
      poolPermission: {
        ...poolPermission(),
        ...change,
      },
    }), false);
  }
});

test('pool permission cannot be borrowed from another restaurant', () => {
  assert.throws(() => pooled({
    poolPermission: {
      ...poolPermission(),
      restaurant_id: OTHER,
    },
  }), /another tenant/);

  assert.throws(
    () => pooled({ restaurantId: null }),
    /restaurant ID/
  );
});