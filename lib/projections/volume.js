import { projectionInstant, shiftProjectionDate } from './businessTime.js';
import { canonicalProjectionHolidayKeys } from './holidayKeys.js';
import { validateProjectionSettings, projectionSettingsDigest, projectionCalibrationKey } from './settings.js';
import { PROJECTION_UUID, projectionDayNumber, projectionISOWeekday,
  projectionVolumeEligibility, projectionVolumeError as fail } from './eligibility.js';
import { projectionVolumeDigest, projectionDeepFreeze } from './volumeProvenance.js';
import { verifyHolidayFactors } from './holidayFactors.js';

function requireFiniteTree(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) fail('Volume calculation overflow.');
  if (value && typeof value === 'object') Object.values(value).forEach(requireFiniteTree);
}

function fit(nights, anchor, settings, trendAllowed = true) {
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
  const rawSlope = !trendAllowed || rows.length < 2 || variance === 0 ? 0 :
    rows.reduce((n, row) => n + row.weight * (row.time_weeks - x) * (row.total_units - y), 0) / variance;
  const rawLevel = y - rawSlope * x;
  const level = Math.max(0, rawLevel);
  const limit = settings.weekly_slope_cap * level;
  return { method: !trendAllowed || rows.length < 2 ? 'weighted_mean' : 'weighted_fit',
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

function volumeHistoryTier(history, firstDataDate, settings) {
  const complete = history.filter(row => row.business_date >= firstDataDate && row.complete && row.source_covered);
  const first = complete[0]?.business_date ?? null;
  const last = complete.at(-1)?.business_date ?? null;
  const weeks = first ? (projectionDayNumber(last) - projectionDayNumber(first) + 1) / 7 : 0;
  const needsBaseline = weeks < settings.minimum_history_weeks;
  const trendAllowed = weeks >= settings.minimum_trend_weeks;
  const ownSeasonality = weeks >= settings.own_seasonality_weeks;
  return { weeks, first_data_date: firstDataDate, first_complete_date: first, last_complete_date: last,
    tier: needsBaseline ? 'needs_baseline' : !trendAllowed ? 'limited_history' :
      weeks < settings.cold_start_weeks ? 'cold_start' : !ownSeasonality ? 'benchmark_seasonality' : 'own_seasonality',
    needs_baseline: needsBaseline, trend_allowed: trendAllowed,
    cold_start: weeks < settings.cold_start_weeks, own_seasonality_tier: ownSeasonality };
}

function seasonal(history, context, current, window, target) {
  const { restaurantId, asOf, firstDataDate, sourceThrough, settings: s } = context;
  const alignment = s.year_alignment_days;
  const anchor = shiftProjectionDate(sourceThrough, -alignment);
  const until = shiftProjectionDate(current.latest_date, -alignment);
  const from = shiftProjectionDate(window.from, -alignment);
  const base = selectWindow(history, restaurantId, asOf, firstDataDate, from, until, target.weekday);
  const centre = shiftProjectionDate(target.business_date, -alignment);
  const radius = 7 * Math.floor(s.seasonal_smoothing_weeks / 2);
  const targetWindow = selectWindow(history, restaurantId, asOf, firstDataDate,
    shiftProjectionDate(centre, -radius), shiftProjectionDate(centre, radius), target.weekday);
  const level = base.eligible.length ? fit(base.eligible, anchor, s,
    base.eligible.length >= s.minimum_ly_weekday_nights) : null;
  const levelMethod = !level ? null : base.eligible.length < s.minimum_ly_weekday_nights
    ? 'LY level from average' : 'LY fitted endpoint';
  const reasons = [];
  if (!level) reasons.push('insufficient_ly_base');
  else if (level.L <= 0) reasons.push('nonpositive_ly_level');
  if (!targetWindow.eligible.length) reasons.push('insufficient_ly_target');
  const ownLY = reasons.length === 0;
  const mean = targetWindow.eligible.length ? targetWindow.eligible.reduce((n, row) => n + row.total_units, 0) /
    targetWindow.eligible.length : null;
  // No pooled data is supplied in Step 4. A switch alone does not make it available.
  const useBenchmark = !ownLY && s.public_benchmarks_enabled;
  const available = ownLY || useBenchmark;
  const benchmarkRatio = 1;
  const rawRatio = ownLY ? mean / level.L : useBenchmark ? 1 + s.census_strength * (benchmarkRatio - 1) : null;
  const S = available ? Math.max(s.seasonal_ratio_min, Math.min(s.seasonal_ratio_max, rawRatio)) : null;
  return { available, own_ly_available: ownLY, reasons,
    source: ownLY ? 'own_ly' : useBenchmark ? 'neutral_benchmark' : 'recent_only',
    benchmark: { status: ownLY ? 'not_required' : useBenchmark ? 'neutral_placeholder' : 'disabled',
      ratio: useBenchmark ? benchmarkRatio : null, strength: s.census_strength,
      public_enabled: s.public_benchmarks_enabled, used: useBenchmark },
    raw_ratio: rawRatio, S, level_method: levelMethod,
    L_LY: level?.L ?? null, fit: level, target_mean: mean,
    base_window: base, target_window: targetWindow,
    A: available ? Math.max(0, current.L * S) : null };
}

// Inputs are already-snapshotted restaurant business dates and flags. This
// module does no fetching, clock reading, SQL, scheduling or archive writes.
export function projectRestaurantVolume({ restaurantId, asOf, firstDataDate,
  resolvedSettings, modelVersion, history, calendar, holidaySnapshot, sourceThrough = shiftProjectionDate(asOf, -1) } = {}) {
  if (!PROJECTION_UUID.test(restaurantId || '')) fail('Restaurant context is required.');
  shiftProjectionDate(asOf, 0); shiftProjectionDate(firstDataDate, 0);
  if (firstDataDate > asOf) fail('First data date cannot be in the future.');
  shiftProjectionDate(sourceThrough, 0);
  if (sourceThrough >= asOf) fail('Source cutoff must precede the target date.');
  const r = resolvedSettings;
  if (!r || r.restaurant_id !== restaurantId || r.model_major !== 4 ||
    !PROJECTION_UUID.test(r.global_version_id || '') ||
    (r.restaurant_version_id !== null && !PROJECTION_UUID.test(r.restaurant_version_id || ''))) {
    fail('Supported resolved settings and version identities are required.');
  }
  if (!modelVersion || Array.isArray(modelVersion) || modelVersion.model_major !== r.model_major ||
    modelVersion.logic_revision !== 'approved-workbook-v4' ||
    !/^[a-f0-9]{64}$/.test(modelVersion.reference_sha256 || '')) fail('The registered v4 model version is required.');
  projectionInstant(modelVersion.released_at);
  const model = { model_major: modelVersion.model_major, logic_revision: modelVersion.logic_revision,
    reference_sha256: modelVersion.reference_sha256, released_at: modelVersion.released_at };
  const s = validateProjectionSettings(r.settings);
  if (r.settings_digest !== projectionSettingsDigest(s) || r.calibration_key !== projectionCalibrationKey(r.model_major, s)) {
    fail('Settings provenance does not match the snapshot.');
  }
  for (const key of ['base_window_weeks', 'maximum_volume_lookback_weeks']) {
    if (!Number.isSafeInteger(s[key])) fail('Volume windows must use whole weeks.');
  }
  if (s.year_alignment_days % 7) fail('Invalid weekday alignment.');
  if (!Array.isArray(history) || !Array.isArray(calendar) || calendar.length !== s.horizon_days) {
    fail('Complete history and calendar snapshots are required.');
  }
  const facts = new Map();
  for (const row of history) {
    if (!row || row.restaurant_id !== restaurantId) fail('History belongs to another restaurant.');
    shiftProjectionDate(row.business_date, 0);
    if (row.business_date >= asOf || row.business_date > sourceThrough) continue;
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
  const holiday = holidaySnapshot === undefined ? null : verifyHolidayFactors(holidaySnapshot,
    { restaurantId, asOf, resolvedSettings, calendar: orderedCalendar });
  const historyTier = volumeHistoryTier(orderedHistory, firstDataDate, s);
  const provenance = { restaurant_id: restaurantId, as_of: asOf, first_data_date: firstDataDate,
    model_major: r.model_major, logic_revision: model.logic_revision, model_version: model, calibration_key: r.calibration_key,
    global_version_id: r.global_version_id, restaurant_version_id: r.restaurant_version_id,
    settings_digest: r.settings_digest, settings_snapshot: { ...s } };
  if (sourceThrough !== shiftProjectionDate(asOf, -1)) provenance.source_through = sourceThrough;
  if (holiday !== null) provenance.holiday_snapshot = holiday;
  provenance.context_digest = projectionVolumeDigest({ ...provenance, history: orderedHistory, calendar: orderedCalendar });
  const context = { restaurantId, asOf, firstDataDate, sourceThrough, settings: s };
  const nights = orderedCalendar.map(target => {
    let weeks = s.base_window_weeks;
    let window;
    do {
      window = selectWindow(facts, restaurantId, asOf, firstDataDate,
        shiftProjectionDate(sourceThrough, 1 - 7 * weeks), sourceThrough, target.weekday);
      if (window.eligible.length >= s.minimum_weekday_nights || weeks === s.maximum_volume_lookback_weeks) break;
      weeks++;
    } while (weeks <= s.maximum_volume_lookback_weeks);
    const current = !historyTier.needs_baseline && window.eligible.length > 0
      ? fit(window.eligible, window.until, s, historyTier.trend_allowed) : null;
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
    const selected = holiday?.nights.find(row => row.business_date === target.business_date);
    const factor = selected?.factor ?? target.default_factor;
    const adjusted = target.closed ? 0 : base === null ? null : Math.max(0, base * factor);
    const output = { business_date: target.business_date, status: target.closed ? 'closed' : base === null ? 'needs_baseline' : 'ok',
      base_volume: base, factor, adjusted_volume: adjusted, calendar: target,
      ...(selected ? { calendar_default_factor: target.default_factor, selected_factor: factor, holiday: selected } : {}),
      recent: current ? { ...current, h, damping_sum: damping, R } : null,
      seasonal: annual, blend: weights, history: historyTier,
      window: { ...window, weeks, extended: weeks > s.base_window_weeks },
      provenance: { context_digest: provenance.context_digest, model_major: r.model_major,
        logic_revision: model.logic_revision, global_version_id: r.global_version_id,
        restaurant_version_id: r.restaurant_version_id } };
    return output;
  });
  const output = { provenance, nights };
  requireFiniteTree(output);
  return projectionDeepFreeze(output);
}