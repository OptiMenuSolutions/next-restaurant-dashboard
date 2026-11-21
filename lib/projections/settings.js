import { createHash } from 'node:crypto';

// Only a seed for a reviewed global settings version. Runtime resolution
// requires a complete stored version; it never silently installs defaults.
export const PROJECTION_DEFAULTS = Object.freeze({
  enabled: false,
  horizon_days: 8,
  business_day_cutoff_minutes: 240,
  sync_buffer_minutes: 60,
  base_window_weeks: 8,
  volume_half_life_weeks: 4,
  share_half_life_weeks: 4,
  volume_recent_weight: 0.5,
  category_base_weight: 0.5,
  trend_damping: 0.8,
  weekly_slope_cap: 0.05,
  minimum_trend_weeks: 4,
  minimum_history_weeks: 2,
  cold_start_weeks: 8,
  own_seasonality_weeks: 52,
  year_alignment_days: 364,
  seasonal_smoothing_weeks: 3,
  seasonal_ratio_min: 0.75,
  seasonal_ratio_max: 1.33,
  minimum_ly_weekday_nights: 4,
  minimum_weekday_nights: 2,
  maximum_volume_lookback_weeks: 16,
  census_strength: 0.5,
  google_trends_strength: 0.25,
  share_trend_enabled: false,
  weekday_mix_enabled: false,
  weekday_mix_prior_nights: 8,
  recommendation_treatment: 'exclude',
  assumed_recommendation_lift: 0.25,
  minimum_clean_dish_nights: 10,
  maximum_dish_lookback_weeks: 16,
  new_dish_prior_nights: 7,
  new_dish_weeks: 8,
  minimum_return_gap_days: 28,
  maximum_new_dish_share: 0.5,
  launch_index_min: 0.5,
  launch_index_max: 2,
  default_launch_index: 1,
  early_close_factor: 0.6,
  outlier_ratio_min: 0.65,
  outlier_ratio_max: 1.35,
  shift_run_nights: 3,
  post_run_nights: 3,
  comparison_decimal_places: 12,
  range_coverage: 0.8,
  range_z_override: null,
  volume_half_width_near: 0.15,
  volume_half_width_far: 0.25,
  cold_start_range_multiplier: 1.5,
  empirical_lookback_weeks: 12,
  minimum_empirical_weeks: 8,
  maximum_new_dish_range_multiplier: 2,
  bias_threshold: 0.1,
  bias_consecutive_weeks: 4,
  owner_estimates_enabled: false,
  public_benchmarks_enabled: true,
  pooled_benchmarks_enabled: false,
  minimum_pooled_restaurants: 5,
});

const KEYS = Object.freeze(Object.keys(PROJECTION_DEFAULTS).sort());

const INTEGER_KEYS = new Set([
  'horizon_days', 'business_day_cutoff_minutes', 'sync_buffer_minutes',
  'base_window_weeks', 'year_alignment_days', 'seasonal_smoothing_weeks',
  'minimum_ly_weekday_nights', 'minimum_weekday_nights',
  'maximum_volume_lookback_weeks', 'minimum_clean_dish_nights',
  'maximum_dish_lookback_weeks', 'shift_run_nights', 'post_run_nights',
  'comparison_decimal_places', 'bias_consecutive_weeks',
  'minimum_pooled_restaurants', 'minimum_return_gap_days',
]);

const UNIT_INTERVAL_KEYS = new Set([
  'volume_recent_weight', 'category_base_weight', 'trend_damping',
  'maximum_new_dish_share', 'census_strength', 'google_trends_strength',
]);

const MAJOR_DEFAULT_KEYS = Object.freeze([
  'volume_recent_weight', 'category_base_weight', 'trend_damping',
  'volume_half_life_weeks', 'share_half_life_weeks',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message) {
  const error = new TypeError(message);
  error.code = 'PROJECTION_SETTINGS_INVALID';
  throw error;
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object.`);
  }
}

export function validateProjectionSettings(value, { partial = false } = {}) {
  object(value, 'Settings');

  if (partial && Object.hasOwn(value, 'pooled_benchmarks_enabled')) {
    fail('pooled_benchmarks_enabled is a global-only setting.');
  }

  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(PROJECTION_DEFAULTS, key)) {
      fail(`Unknown setting: ${key}`);
    }
  }

  if (!partial) {
    for (const key of KEYS) {
      if (key !== 'minimum_return_gap_days' && !Object.hasOwn(value, key)) {
        fail(`Missing setting: ${key}`);
      }
    }
  }

  for (const [key, item] of Object.entries(value)) {
    const seed = PROJECTION_DEFAULTS[key];

    if (typeof seed === 'boolean') {
      if (typeof item !== 'boolean') {
        fail(`${key} must be boolean.`);
      }
      continue;
    }

    if (key === 'recommendation_treatment') {
      if (!['exclude', 'adjust'].includes(item)) {
        fail('Invalid recommendation treatment.');
      }
      continue;
    }

    if (key === 'range_z_override' && item === null) continue;

    if (typeof item !== 'number' || !Number.isFinite(item)) {
      fail(`${key} must be a finite number.`);
    }

    if (INTEGER_KEYS.has(key) && !Number.isSafeInteger(item)) {
      fail(`${key} must be a safe integer.`);
    }

    if (UNIT_INTERVAL_KEYS.has(key)) {
      if (item < 0 || item > 1) {
        fail(`${key} must be between 0 and 1.`);
      }
    } else if (
      ['weekly_slope_cap', 'assumed_recommendation_lift', 'bias_threshold'].includes(key)
    ) {
      if (item < 0) fail(`${key} must not be negative.`);
    } else if (key === 'business_day_cutoff_minutes') {
      if (item < 0 || item >= 24 * 60) {
        fail('Cutoff must be a local minute within one day.');
      }
    } else if (key === 'sync_buffer_minutes') {
      if (item < 0) fail('Sync buffer must not be negative.');
    } else if (key === 'comparison_decimal_places') {
      if (item < 0 || item > 15) {
        fail('Comparison precision must be between 0 and 15.');
      }
    } else if (item <= 0) {
      fail(`${key} must be positive.`);
    }
  }

  if (partial) return Object.freeze({ ...value });

  if (value.seasonal_smoothing_weeks % 2 !== 1) {
    fail('Smoothing must use an odd number of weeks.');
  }

  if (!(value.seasonal_ratio_min <= 1 && value.seasonal_ratio_max >= 1)) {
    fail('Seasonal bounds must contain the neutral ratio 1.');
  }

  if (!(value.outlier_ratio_min < 1 && value.outlier_ratio_max > 1)) {
    fail('The outlier band must contain 1 in its interior.');
  }

  if (!(
    value.launch_index_min <= value.default_launch_index &&
    value.default_launch_index <= value.launch_index_max
  )) {
    fail('Default launch index must lie within its bounds.');
  }

  if (value.range_coverage >= 1) {
    fail('Range coverage must be below 1.');
  }

  if (value.volume_half_width_near > value.volume_half_width_far) {
    fail('Far ranges must not be narrower.');
  }

  if (
    value.maximum_volume_lookback_weeks < value.base_window_weeks ||
    value.maximum_dish_lookback_weeks < value.base_window_weeks
  ) {
    fail('Extended lookbacks must cover the base window.');
  }

  if (value.empirical_lookback_weeks < value.minimum_empirical_weeks) {
    fail('Empirical lookback must cover the minimum checked history.');
  }

  if (
    value.minimum_history_weeks > value.minimum_trend_weeks ||
    value.minimum_trend_weeks > value.cold_start_weeks ||
    value.cold_start_weeks > value.own_seasonality_weeks
  ) {
    fail('History tiers must be ordered.');
  }

  if (
    value.cold_start_range_multiplier < 1 ||
    value.maximum_new_dish_range_multiplier < 1
  ) {
    fail('Widening multipliers must be at least 1.');
  }

  // The handover privacy floor cannot be lowered by an override.
  if (value.minimum_pooled_restaurants < 5) {
    fail('Pooled groups require at least 5 restaurants.');
  }

  return Object.freeze(
    Object.fromEntries(KEYS.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))
  );
}

export function projectionCalibrationKey(major, settings) {
  if (!Number.isSafeInteger(major) || major < 1) {
    fail('A positive major version is required.');
  }

  const s = validateProjectionSettings(settings);

  return `${major}|a=${s.volume_recent_weight}|b=${s.category_base_weight}` +
    `|phi=${s.trend_damping}|vh=${s.volume_half_life_weeks}|sh=${s.share_half_life_weeks}`;
}

export function projectionSettingsDigest(settings) {
  return createHash('sha256')
    .update(JSON.stringify(validateProjectionSettings(settings)))
    .digest('hex');
}

function instant(value, name) {
  if (
    typeof value !== 'string' ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    fail(`${name} must be an explicit timestamp with an offset.`);
  }

  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    fail(`${name} is invalid.`);
  }

  return parsed;
}

function active(record, at, name) {
  object(record, name);

  if (!UUID.test(record.id || '')) {
    fail(`${name} needs a version ID.`);
  }

  if (instant(record.effective_at, `${name} effective_at`) > at) {
    fail(`${name} is not effective yet.`);
  }
}

export function resolveProjectionSettings({
  restaurantId,
  at,
  globalVersion,
  restaurantVersion = null,
}) {
  if (!UUID.test(restaurantId || '')) {
    fail('A restaurant ID is required.');
  }

  const when = instant(at, 'Resolution time');

  active(globalVersion, when, 'Global settings');

  if (globalVersion.restaurant_id != null) {
    fail('Global settings must not belong to a restaurant.');
  }

  const base = validateProjectionSettings(globalVersion.settings);

  if (
    !Number.isSafeInteger(globalVersion.model_major) ||
    globalVersion.model_major < 1
  ) {
    fail('Global settings require a major model version.');
  }

  let settings = base;

  if (restaurantVersion !== null) {
    active(restaurantVersion, when, 'Restaurant settings');

    if (restaurantVersion.restaurant_id !== restaurantId) {
      fail('Restaurant settings belong to another tenant.');
    }

    if (restaurantVersion.model_major !== globalVersion.model_major) {
      fail('Restaurant settings use another major version.');
    }

    const overrides = validateProjectionSettings(
      restaurantVersion.settings,
      { partial: true }
    );

    settings = validateProjectionSettings({ ...base, ...overrides });
  }

  return Object.freeze({
    restaurant_id: restaurantId,
    global_version_id: globalVersion.id,
    restaurant_version_id: restaurantVersion?.id ?? null,
    model_major: globalVersion.model_major,
    calibration_key: projectionCalibrationKey(
      globalVersion.model_major,
      settings
    ),
    settings_digest: projectionSettingsDigest(settings),
    settings,
  });
}

export function canUseProjectionPooledBenchmarks({
  restaurantId,
  settings,
  poolPermission = null,
}) {
  if (!UUID.test(restaurantId || '')) fail('A restaurant ID is required.');

  const resolved = validateProjectionSettings(settings);

  if (poolPermission === null) return false;

  object(poolPermission, 'Pool permission');

  if (poolPermission.restaurant_id !== restaurantId) {
    fail('Pool permission belongs to another tenant.');
  }

  return resolved.pooled_benchmarks_enabled === true &&
    poolPermission.enabled === true &&
    poolPermission.agreement_permits === true &&
    typeof poolPermission.agreement_version === 'string' &&
    poolPermission.agreement_version.trim().length > 0;
}

export function assertProjectionModelRevision(previous, next) {
  object(previous, 'Previous model');
  object(next, 'Next model');

  const before = validateProjectionSettings(previous.settings);
  const after = validateProjectionSettings(next.settings);

  for (const version of [previous.model_major, next.model_major]) {
    if (!Number.isSafeInteger(version) || version < 1) {
      fail('Invalid major version.');
    }
  }

  if (
    [previous.logic_revision, next.logic_revision].some(value =>
      typeof value !== 'string' || !value.trim()
    )
  ) {
    fail('Logic revision is required.');
  }

  if (next.model_major < previous.model_major) {
    fail('Major version cannot go backwards.');
  }

  const changed =
    previous.logic_revision !== next.logic_revision ||
    MAJOR_DEFAULT_KEYS.some(key => before[key] !== after[key]);

  if (changed && next.model_major <= previous.model_major) {
    fail('Changed formula logic or major defaults require a new major version.');
  }

  return true;
}