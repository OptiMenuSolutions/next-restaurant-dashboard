import { projectionInstant, shiftProjectionDate } from './businessTime.js';
import { PROJECTION_UUID, projectionVolumeEligibility } from './eligibility.js';
import { projectRestaurantVolume } from './volume.js';
import { holidayInstant } from './holidayFactors.js';
import { projectionAvailability, availableOn } from './availability.js';
import { projectionCanonicalJSON, projectionVolumeDigest } from './volumeProvenance.js';

export function shareError(message, code = 'PROJECTION_SHARE_INVALID') {
  const error = new TypeError(message); error.code = code; throw error;
}
const date = value => { shiftProjectionDate(value, 0); return value; };
const number = (value, nonnegative = true) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonnegative && value < 0)) {
    shareError('Share inputs require finite numeric values.');
  }
  return value;
};
export const shareClose = (a, b, count = 1) =>
  Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * Math.max(1, count);

export function prepareShareSnapshot(input = {}) {
  const { restaurantId, asOf, snapshotAt, resolvedSettings, volume, history,
    styleCategories, dishes, dishFacts, launchHistory } = input;
  if (!PROJECTION_UUID.test(restaurantId || '')) shareError('Restaurant context is required.');
  date(asOf); const captured = projectionInstant(snapshotAt);
  for (const rows of [history, styleCategories, dishes, dishFacts, launchHistory]) {
    if (!Array.isArray(rows)) shareError('Complete share input arrays are required.');
  }
  const styles = [...styleCategories].sort();
  if (styles.length !== 3 || new Set(styles).size !== 3 || styles.some(s => typeof s !== 'string' || !s.trim())) {
    shareError('The snapshot must name the three configured style categories.');
  }
  if (!volume?.provenance || !Array.isArray(volume.nights)) shareError('Step 4 output is required.');
  if (volume.provenance.holiday_snapshot !== undefined &&
    holidayInstant(volume.provenance.holiday_snapshot.inputs.snapshotAt) !== holidayInstant(snapshotAt)) {
    shareError('Holiday and share snapshots must use the same capture time.');
  }
  const checked = projectRestaurantVolume({ restaurantId, asOf,
    firstDataDate: volume.provenance.first_data_date, resolvedSettings,
    modelVersion: volume.provenance.model_version, history,
    calendar: volume.nights.map(row => row.calendar),
    ...(volume.provenance.source_through === undefined ? {} : { sourceThrough: volume.provenance.source_through }),
    ...(volume.provenance.holiday_snapshot === undefined ? {} : { holidaySnapshot: volume.provenance.holiday_snapshot }),
    ...(volume.provenance.benchmark_snapshot === undefined ? {} : { benchmarkSnapshot: volume.provenance.benchmark_snapshot }) });
  if (projectionCanonicalJSON(checked) !== projectionCanonicalJSON(volume)) {
    shareError('Volume output does not match this history, settings and calendar snapshot.');
  }
  const owned = row => {
    if (!row || row.restaurant_id !== restaurantId) shareError('Share snapshot crosses restaurants.');
    return row;
  };
  const menu = new Map();
  for (const raw of dishes) {
    owned(raw);
    if (!PROJECTION_UUID.test(raw.id || '') || menu.has(raw.id)) shareError('Invalid or duplicate dish ID.');
    for (const key of ['forecastable', 'is_new', 'is_returning']) {
      if (typeof raw[key] !== 'boolean') shareError(`Missing dish flag: ${key}`);
    }
    if (raw.forecastable && !styles.includes(raw.style_category)) {
      shareError('Every forecastable dish needs an explicit configured style_category.');
    }
    if (raw.lifecycle_unavailable !== undefined && typeof raw.lifecycle_unavailable !== 'boolean') shareError('Invalid lifecycle availability flag.');
    if (raw.lifecycle_unavailable && (typeof raw.lifecycle_reason !== 'string' || !raw.lifecycle_reason)) shareError('Missing lifecycle availability reason.');
    const launch = raw.launch_date == null ? null : date(raw.launch_date);
    const removed = raw.removed_date == null ? null : date(raw.removed_date);
    const last = raw.last_season_removed_date == null ? null : date(raw.last_season_removed_date);
    if ((raw.forecastable && !launch) || (removed && launch && removed < launch) || (last && launch && last >= launch)) {
      shareError('Invalid dish launch or removal dates.');
    }
    const count = raw.last_season_category_count ?? null;
    if (count !== null && (!Number.isSafeInteger(count) || count < 0)) shareError('Invalid last-season category count.');
    menu.set(raw.id, { id: raw.id, restaurant_id: restaurantId, style_category: raw.style_category ?? null,
      forecastable: raw.forecastable, is_new: raw.is_new, is_returning: raw.is_returning,
      ...(raw.lifecycle_unavailable ? { lifecycle_unavailable: true, lifecycle_reason: raw.lifecycle_reason } : {}),
      launch_date: launch, removed_date: removed, last_season_removed_date: last,
      last_season_category_count: count, owner_prior_weight: number(raw.owner_prior_weight ?? 0),
      share_trend_per_week: number(raw.share_trend_per_week ?? 0, false) });
  }
  const unavailableStyles = new Set([...menu.values()].filter(d => d.forecastable && d.lifecycle_unavailable).map(d => d.style_category));
  const availability = input.availability === undefined ? null :
    projectionAvailability(input.availability, restaurantId, new Set(menu.keys()));
  if (availability !== null && [...menu.values()].some(dish => dish.forecastable && !dish.lifecycle_unavailable &&
    !availability.some(row => row.dish_id === dish.id))) shareError('Missing dish availability history.');
  const isAvailable = (dish, day) => availability === null
    ? dish.launch_date <= day && (!dish.removed_date || day < dish.removed_date)
    : availability.some(row => row.dish_id === dish.id && availableOn(row, day));
  const source = new Map(history.filter(row => row.business_date < asOf).map(row => [row.business_date, row]));
  const facts = new Map();
  for (const raw of dishFacts) {
    owned(raw); date(raw.business_date);
    if (raw.business_date >= asOf) continue;
    const dish = menu.get(raw.dish_id), night = source.get(raw.business_date);
    if (!dish?.forecastable || !night) shareError('Dish facts require a forecastable dish and a source night.');
    for (const key of ['recommended', 'sold_out']) {
      if (raw[key] !== null && typeof raw[key] !== 'boolean') shareError(`Missing or invalid fact flag: ${key}`);
    }
    if (typeof raw.source_revision !== 'string' || !raw.source_revision ||
      (night.complete && !unavailableStyles.has(dish.style_category) && raw.source_revision !== night.source_revision)) shareError('Dish/source revision mismatch.');
    if (availability !== null && !unavailableStyles.has(dish.style_category) && !isAvailable(dish, raw.business_date) && raw.units !== 0) {
      shareError('Positive dish units fall outside explicit availability.');
    }
    const key = `${raw.business_date}:${raw.dish_id}`;
    if (facts.has(key)) shareError('Duplicate dish fact.');
    facts.set(key, { restaurant_id: restaurantId, business_date: raw.business_date, dish_id: raw.dish_id,
      units: number(raw.units), recommended: raw.recommended, sold_out: raw.sold_out,
      source_revision: raw.source_revision });
  }
  const orderedDishes = [...menu.values()].sort((a, b) => a.id.localeCompare(b.id));
  const orderedFacts = [...facts.values()].sort((a, b) => a.business_date.localeCompare(b.business_date) || a.dish_id.localeCompare(b.dish_id));
  const byNight = new Map();
  for (const fact of orderedFacts) {
    if (!byNight.has(fact.business_date)) byNight.set(fact.business_date, []);
    byNight.get(fact.business_date).push(fact);
  }
  const nights = [...source.values()].sort((a, b) => a.business_date.localeCompare(b.business_date)).map(night => {
    const rows = byNight.get(night.business_date) || [];
    let eligible = night.business_date >= volume.provenance.first_data_date &&
      projectionVolumeEligibility(night, { restaurantId, asOf }).eligible;
    let lifecycleMismatch = false;
    if (eligible) {
      const total = rows.reduce((sum, row) => sum + row.units, 0);
      const mismatched = !shareClose(total, night.total_units, rows.length) ||
        rows.some(row => unavailableStyles.has(menu.get(row.dish_id).style_category) && row.source_revision !== night.source_revision);
      if (mismatched && !unavailableStyles.size) shareError('Dish facts do not reconcile to source volume.');
      if (mismatched) { eligible = false; lifecycleMismatch = true; }
      for (const dish of orderedDishes) {
        if (dish.forecastable && !unavailableStyles.has(dish.style_category) && isAvailable(dish, night.business_date) &&
          !facts.has(`${night.business_date}:${dish.id}`)) shareError('Missing dish fact, including an explicit zero.');
      }
    }
    return { ...night, eligible, ...(lifecycleMismatch
      ? { share_exclusion_reason: 'lifecycle_facts_incomplete' } : {}) };
  });
  const launches = new Map();
  for (const raw of launchHistory) {
    owned(raw);
    if (projectionInstant(raw.created_at) > captured || date(raw.observed_through) >= asOf) continue;
    if (!PROJECTION_UUID.test(raw.id || '') || launches.has(raw.id) || !menu.has(raw.dish_id) ||
      !styles.includes(raw.style_category) || date(raw.launch_date) > raw.observed_through) shareError('Invalid launch history.');
    launches.set(raw.id, { id: raw.id, restaurant_id: restaurantId, dish_id: raw.dish_id,
      style_category: raw.style_category, launch_date: raw.launch_date, observed_through: raw.observed_through,
      launch_index: number(raw.launch_index), created_at: raw.created_at, supersedes_id: raw.supersedes_id ?? null });
  }
  const superseded = new Set();
  for (const row of launches.values()) {
    if (!row.supersedes_id) continue;
    const parent = launches.get(row.supersedes_id);
    if (!parent || parent.id === row.id || parent.dish_id !== row.dish_id || parent.launch_date !== row.launch_date ||
      projectionInstant(parent.created_at) > projectionInstant(row.created_at) || superseded.has(parent.id)) {
      shareError('Launch history must contain complete, unbranched supersession chains.');
    }
    superseded.add(parent.id);
  }
  for (const row of launches.values()) {
    const seen = new Set(); let cursor = row;
    while (cursor) {
      if (seen.has(cursor.id)) shareError('Cyclic launch history.');
      seen.add(cursor.id); cursor = launches.get(cursor.supersedes_id);
    }
  }
  const orderedLaunches = [...launches.values()].sort((a, b) => a.id.localeCompare(b.id));
  const provenance = { ...checked.provenance, snapshot_at: snapshotAt,
    volume_context_digest: checked.provenance.context_digest };
  provenance.context_digest = projectionVolumeDigest({ ...provenance, style_categories: styles,
    dishes: orderedDishes, dish_facts: orderedFacts, launch_history: orderedLaunches,
    ...(availability === null ? {} : { availability }) });
  return { restaurantId, asOf, styles, menu: orderedDishes, facts: availability === null ? orderedFacts :
    orderedFacts.filter(row => unavailableStyles.has(menu.get(row.dish_id).style_category) ||
      isAvailable(menu.get(row.dish_id), row.business_date)), nights,
    launches: orderedLaunches.filter(row => !superseded.has(row.id)), volume: checked, provenance,
    settings: resolvedSettings.settings,
    through: volume.nights[0].history.last_complete_date ?? shiftProjectionDate(asOf, -1) };
}