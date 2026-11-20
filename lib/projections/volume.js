import { shiftProjectionDate } from './businessTime.js';
import { canonicalProjectionHolidayKeys } from './holidayKeys.js';
import { validateProjectionSettings, projectionSettingsDigest, projectionCalibrationKey } from './settings.js';
import { PROJECTION_UUID, projectionDayNumber, projectionISOWeekday,
  projectionVolumeEligibility, projectionVolumeError as fail } from './eligibility.js';
import { VOLUME_MODEL_MAJOR, VOLUME_LOGIC_REVISION, validateProjectionVolumePolicy,
  projectionVolumeDigest, projectionDeepFreeze } from './volumePolicy.js';

function requireFiniteTree(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) fail('Volume calculation overflow.');
  if (value && typeof value === 'object') Object.values(value).forEach(requireFiniteTree);
}

function fit(nights, anchor, settings, policy) {
  const latest = nights.at(-1).business_date;
  const rows = nights.map(night => ({ ...night,
    age_weeks: (projectionDayNumber(anchor) - projectionDayNumber(night.business_date)) / 7,
    time_weeks: (projectionDayNumber(night.business_date) - projectionDayNumber(latest)) / 7,
    weight: 0.5 ** ((projectionDayNumber(anchor) - projectionDayNumber(night.business_date)) /
      (7 * settings.volume_half_life_weeks)),
  }));
  const sum = rows.reduce((n, row) => n + row.weight, 0);
  const x = rows.reduce((n, row) => n + row.weight * row.time_weeks, 0) / sum;
  const y = rows.reduce((n, row) => n + row.weight * row.total_units, 0) / sum;
  const variance = rows.reduce((n, row) => n + row.weight * (row.time_weeks - x) ** 2, 0);
  const rawSlope = rows.length < policy.minimum_fit_points || variance === 0 ? 0 :
    rows.reduce((n, row) => n + row.weight * (row.time_weeks - x) * (row.total_units - y), 0) / variance;
  const rawLevel = y - rawSlope * x;
  const level = Math.max(0, rawLevel);
  const limit = settings.weekly_slope_cap * level;
  return { method: rows.length < policy.minimum_fit_points ? 'weighted_mean' : 'weighted_fit',
    latest_date: latest, weighted_mean: y, raw_level: rawLevel, L: level,
    raw_slope: rawSlope, capped_slope: Math.max(-limit, Math.min(limit, rawSlope)), nights: rows };
}

function selectWindow(history, restaurantId, asOf, firstDataDate, from, until, weekday) {
  const eligible = [], excluded = [];
  let day = from;
  while (projectionISOWeekday(day) !== weekday) day = shiftProjectionDate(day, 1);
  for (; day <= until; day = shiftProjectionDate(day, 7)) {
    const row = history.get(day);
    const reasons = day < firstDataDate ? ['before_first_data'] : !row ? ['missing_night'] :
      [...projectionVolumeEligibility(row, { restaurantId, asOf }).reasons];
    if (reasons.length) excluded.push({ business_date: day, reasons, ...(row ? { night: row } : {}) });
    else eligible.push(row);
  }
  return { from, until, eligible, excluded };
}

function seasonal(history, context, current, window, target) {
  const { restaurantId, asOf, firstDataDate, settings: s, policy: p } = context;
  const alignment = s.year_alignment_days;
  const anchor = shiftProjectionDate(asOf, -1 - alignment);
  const until = shiftProjectionDate(current.latest_date, -alignment);
  const from = shiftProjectionDate(window.from, -alignment);
  const base = selectWindow(history, restaurantId, asOf, firstDataDate, from, until, target.weekday);
  const centre = shiftProjectionDate(target.business_date, -alignment);
  const radius = 7 * Math.floor(s.seasonal_smoothing_weeks / 2);
  const targetWindow = selectWindow(history, restaurantId, asOf, firstDataDate,
    shiftProjectionDate(centre, -radius), shiftProjectionDate(centre, radius), target.weekday);
  const level = base.eligible.length >= p.minimum_ly_base_points ? fit(base.eligible, anchor, s, p) : null;
  const reasons = [];
  if (!level) reasons.push('insufficient_ly_base');
  if (targetWindow.eligible.length < p.minimum_ly_target_points) reasons.push('insufficient_ly_target');
  const available = reasons.length === 0;
  const mean = targetWindow.eligible.length ? targetWindow.eligible.reduce((n, row) => n + row.total_units, 0) /
    targetWindow.eligible.length : null;
  const neutral = available && level.L === 0;
  const rawRatio = available ? (neutral ? 1 : mean / level.L) : null;
  const S = available ? Math.max(s.seasonal_ratio_min, Math.min(s.seasonal_ratio_max, rawRatio)) : null;
  return { available, reasons, source: available ? 'own_ly' : 'recent_only',
    benchmark: { status: available ? 'not_required' : s.public_benchmarks_enabled ? 'not_connected' : 'disabled',
      ratio: available || !s.public_benchmarks_enabled ? null : 1, used: false },
    zero_denominator_neutral: neutral, raw_ratio: rawRatio, S,
    L_LY: level?.L ?? null, fit: level, target_mean: mean,
    base_window: base, target_window: targetWindow,
    A: available ? Math.max(0, current.L * S) : null };
}

// Inputs are already-snapshotted restaurant business dates and flags. This
// module does no fetching, clock reading, SQL, scheduling or archive writes.
export function projectRestaurantVolume({ restaurantId, asOf, firstDataDate,
  resolvedSettings, policyVersion, history, calendar } = {}) {
  if (!PROJECTION_UUID.test(restaurantId || '')) fail('Restaurant context is required.');
  shiftProjectionDate(asOf, 0); shiftProjectionDate(firstDataDate, 0);
  if (firstDataDate > asOf) fail('First data date cannot be in the future.');
  const r = resolvedSettings;
  if (!r || r.restaurant_id !== restaurantId || r.model_major !== VOLUME_MODEL_MAJOR ||
    !PROJECTION_UUID.test(r.global_version_id || '') ||
    (r.restaurant_version_id !== null && !PROJECTION_UUID.test(r.restaurant_version_id || ''))) {
    fail('Supported resolved settings and version identities are required.');
  }
  const s = validateProjectionSettings(r.settings);
  if (r.settings_digest !== projectionSettingsDigest(s) || r.calibration_key !== projectionCalibrationKey(r.model_major, s)) {
    fail('Settings provenance does not match the snapshot.');
  }
  for (const key of ['base_window_weeks', 'maximum_volume_lookback_weeks']) {
    if (!Number.isSafeInteger(s[key])) fail('Volume windows must use whole weeks.');
  }
  if (s.year_alignment_days % 7 || s.minimum_weekday_nights < 2) fail('Invalid weekday alignment or baseline threshold.');
  const policy = validateProjectionVolumePolicy(policyVersion, { restaurantId, asOf, settings: s });
  const p = policy.parameters;
  if (!Array.isArray(history) || !Array.isArray(calendar) || calendar.length !== s.horizon_days) {
    fail('Complete history and calendar snapshots are required.');
  }
  const facts = new Map();
  for (const row of history) {
    if (!row || row.restaurant_id !== restaurantId) fail('History belongs to another restaurant.');
    shiftProjectionDate(row.business_date, 0);
    if (row.business_date >= asOf) continue;
    if (facts.has(row.business_date)) fail('Duplicate history date.');
    projectionVolumeEligibility(row, { restaurantId, asOf });
    facts.set(row.business_date, { restaurant_id: restaurantId, business_date: row.business_date,
      complete: row.complete, source_covered: row.source_covered, closed: row.closed, early_close: row.early_close,
      holiday_keys: [...canonicalProjectionHolidayKeys(row.holiday_keys)], total_units: row.total_units ?? null,
      outlier_status: row.outlier_status, source_revision: row.source_revision ?? null });
  }
  const dates = new Map();
  for (const row of calendar) {
    if (!row || row.restaurant_id !== restaurantId) fail('Calendar belongs to another restaurant.');
    shiftProjectionDate(row.business_date, 0);
    const offset = projectionDayNumber(row.business_date) - projectionDayNumber(asOf);
    if (offset < 0 || offset >= s.horizon_days || dates.has(row.business_date) ||
      typeof row.closed !== 'boolean' || typeof row.early_close !== 'boolean' ||
      !Number.isFinite(row.default_factor) || row.default_factor < 0 ||
      !Number.isSafeInteger(row.configuration_revision) || row.configuration_revision < 0 ||
      !/^[a-f0-9]{64}$/.test(row.context_digest || '')) fail('Invalid calendar snapshot.');
    const keys = [...canonicalProjectionHolidayKeys(row.holiday_keys)];
    if ((row.closed && (row.default_factor !== 0 || row.early_close)) ||
      (!row.closed && !row.early_close && !keys.length && row.default_factor !== 1)) fail('Inconsistent calendar factor.');
    dates.set(row.business_date, { restaurant_id: restaurantId, business_date: row.business_date,
      weekday: projectionISOWeekday(row.business_date), closed: row.closed, early_close: row.early_close,
      holiday_keys: keys, default_factor: row.default_factor, configuration_revision: row.configuration_revision,
      context_digest: row.context_digest });
  }
  const orderedHistory = [...facts.values()].sort((a, b) => a.business_date.localeCompare(b.business_date));
  const orderedCalendar = [...dates.values()].sort((a, b) => a.business_date.localeCompare(b.business_date));
  const provenance = { restaurant_id: restaurantId, as_of: asOf, first_data_date: firstDataDate,
    model_major: r.model_major, logic_revision: VOLUME_LOGIC_REVISION, calibration_key: r.calibration_key,
    global_version_id: r.global_version_id, restaurant_version_id: r.restaurant_version_id,
    settings_digest: r.settings_digest, volume_policy_version: policy,
    policy_digest: projectionVolumeDigest(policy), settings_snapshot: { ...s } };
  provenance.context_digest = projectionVolumeDigest({ ...provenance, history: orderedHistory, calendar: orderedCalendar });
  const context = { restaurantId, asOf, firstDataDate, settings: s, policy: p };
  const nights = orderedCalendar.map(target => {
    let weeks = s.base_window_weeks;
    let window;
    do {
      window = selectWindow(facts, restaurantId, asOf, firstDataDate,
        shiftProjectionDate(asOf, -7 * weeks), shiftProjectionDate(asOf, -1), target.weekday);
      if (window.eligible.length >= s.minimum_weekday_nights || weeks === s.maximum_volume_lookback_weeks) break;
      weeks++;
    } while (weeks <= s.maximum_volume_lookback_weeks);
    const current = window.eligible.length >= s.minimum_weekday_nights ? fit(window.eligible, window.until, s, p) : null;
    const h = current ? (projectionDayNumber(target.business_date) - projectionDayNumber(current.latest_date)) / 7 : null;
    const damping = h === null ? null : s.trend_damping === 1 ? h :
      s.trend_damping === 0 ? 0 :
      s.trend_damping * -Math.expm1(h * Math.log(s.trend_damping)) / (1 - s.trend_damping);
    const R = current ? Math.max(0, current.L + current.capped_slope * damping) : null;
    const annual = current ? seasonal(facts, context, current, window, target) : null;
    const weights = { configured_recent: s.volume_recent_weight, configured_seasonal: 1 - s.volume_recent_weight,
      recent: current ? annual.available ? s.volume_recent_weight : 1 : null,
      seasonal: current ? annual.available ? 1 - s.volume_recent_weight : 0 : null };
    const base = current ? Math.max(0, weights.recent * R + weights.seasonal * (annual.A ?? 0)) : null;
    const adjusted = target.closed ? 0 : base === null ? null : Math.max(0, base * target.default_factor);
    const output = { business_date: target.business_date, status: target.closed ? 'closed' : base === null ? 'needs_baseline' : 'ok',
      base_volume: base, factor: target.default_factor, adjusted_volume: adjusted, calendar: target,
      recent: current ? { ...current, h, damping_sum: damping, R } : null,
      seasonal: annual, blend: weights,
      window: { ...window, weeks, extended: weeks > s.base_window_weeks },
      provenance: { context_digest: provenance.context_digest, model_major: r.model_major,
        logic_revision: VOLUME_LOGIC_REVISION, global_version_id: r.global_version_id,
        restaurant_version_id: r.restaurant_version_id, policy_version_id: policy.id } };
    return output;
  });
  const output = { provenance, nights };
  requireFiniteTree(output);
  return projectionDeepFreeze(output);
}