import { shiftProjectionDate } from './businessTime.js';
import { PROJECTION_UUID, projectionDayNumber, projectionVolumeEligibility } from './eligibility.js';
import { holidayInstant } from './holidayFactors.js';
import { rangeError as fail, rangeNumber } from './rangeMath.js';

// Archive adapter contract: immutable run rows with nested forecast nights and
// dishes. Step 10 will assemble these from the existing three archive tables.
// An entire visible run revision wins; no mixing dishes from older revisions.
export function checkedProjectionForecasts({ restaurantId, asOf, snapshotAt, lastCompleteDate,
  settings, calibrationKey, history, dishFacts, archives }) {
  if (!PROJECTION_UUID.test(restaurantId || '')) fail('Restaurant context is required.');
  shiftProjectionDate(asOf, 0);
  if (lastCompleteDate !== null) shiftProjectionDate(lastCompleteDate, 0);
  if (lastCompleteDate !== null && lastCompleteDate >= asOf) fail('The complete-service cutoff must precede the forecast.');
  const captured = holidayInstant(snapshotAt);
  if (![history, dishFacts, archives].every(Array.isArray)) fail('Complete source and archive arrays are required.');
  const owned = row => { if (row?.restaurant_id !== restaurantId) fail('Calibration input crosses restaurants.'); };
  const nights = new Map(), facts = new Map(), versions = new Map(), parents = new Set(), originals = new Set();
  for (const row of history) {
    owned(row); shiftProjectionDate(row.business_date, 0);
    if (row.business_date >= asOf || (lastCompleteDate !== null && row.business_date > lastCompleteDate)) continue;
    if (nights.has(row.business_date)) fail('Duplicate calibration source night.');
    projectionVolumeEligibility(row, { restaurantId, asOf }); nights.set(row.business_date, structuredClone(row));
  }
  const last = [...nights.values()].filter(row => row.complete && row.source_covered).map(row => row.business_date).sort().at(-1);
  if ((last ?? null) !== lastCompleteDate) fail('Last complete service date is not supported by the source snapshot.');
  for (const row of dishFacts) {
    owned(row); shiftProjectionDate(row.business_date, 0);
    if (row.business_date >= asOf || lastCompleteDate === null || row.business_date > lastCompleteDate) continue;
    if (!PROJECTION_UUID.test(row.dish_id || '')) fail('Invalid actual dish ID.');
    const key = `${row.business_date}:${row.dish_id}`;
    if (facts.has(key)) fail('Duplicate actual dish fact.');
    rangeNumber(row.units); facts.set(key, structuredClone(row));
  }
  for (const row of archives) {
    owned(row); shiftProjectionDate(row.run_date, 0);
    if (row.run_date >= asOf || holidayInstant(row.issued_at) > captured) continue;
    if (!PROJECTION_UUID.test(row.id || '') || versions.has(row.id) || !Number.isSafeInteger(row.model_major) || row.model_major < 1 ||
      typeof row.calibration_key !== 'string' || !row.calibration_key || !Array.isArray(row.nights)) fail('Invalid forecast run.');
    shiftProjectionDate(row.source_through, 0);
    if (row.source_through >= row.run_date) fail('Stored forecast contains future source data.');
    const dates = new Set();
    for (const night of row.nights) {
      shiftProjectionDate(night.target_date, 0);
      const lead = projectionDayNumber(night.target_date) - projectionDayNumber(row.run_date) + 1;
      if (night.days_ahead !== lead || lead < 1 || lead > 8 || dates.has(night.target_date) ||
        !['available', 'needs_baseline', 'closed'].includes(night.availability) || !Array.isArray(night.dishes)) fail('Invalid stored forecast night.');
      dates.add(night.target_date);
      if (night.expected !== null) rangeNumber(night.expected);
      if ((night.availability === 'needs_baseline') !== (night.expected === null) ||
        (night.availability === 'closed' && night.expected !== 0)) fail('Stored availability does not match its forecast.');
      const dishes = new Set();
      for (const dish of night.dishes) {
        if (!PROJECTION_UUID.test(dish.dish_id || '') || dishes.has(dish.dish_id)) fail('Invalid or duplicate archived dish.');
        dishes.add(dish.dish_id); if (dish.expected !== null) rangeNumber(dish.expected);
      }
    }
    versions.set(row.id, structuredClone(row));
  }
  for (const row of versions.values()) {
    const key = `${row.model_major}:${row.run_date}`;
    if (row.supersedes_id == null) {
      if (originals.has(key)) fail('Duplicate original forecast run.'); originals.add(key);
    } else {
      const parent = versions.get(row.supersedes_id);
      if (!parent || parent.model_major !== row.model_major || parent.run_date !== row.run_date || parents.has(parent.id) ||
        holidayInstant(parent.issued_at) > holidayInstant(row.issued_at)) fail('Incomplete or branching archive history.');
      parents.add(parent.id);
    }
    const seen = new Set(); let cursor = row;
    while (cursor) { if (seen.has(cursor.id)) fail('Cyclic archive history.'); seen.add(cursor.id); cursor = versions.get(cursor.supersedes_id); }
  }
  const from = lastCompleteDate === null ? null : shiftProjectionDate(lastCompleteDate, 1 - settings.empirical_lookback_weeks * 7);
  const observations = [], excluded = [];
  const add = (run, night, dishId, expected, actual, reasons) => {
    const base = { archive_id: run.id, target_date: night.target_date, days_ahead: night.days_ahead, dish_id: dishId,
      expected, actual, source_revision: nights.get(night.target_date)?.source_revision ?? null };
    if (!reasons.length) {
      const ratio = actual / expected; rangeNumber(ratio); observations.push({ ...base, ratio });
    } else excluded.push({ ...base, reasons });
  };
  for (const run of [...versions.values()].filter(row => !parents.has(row.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const night of [...run.nights].sort((a, b) => a.target_date.localeCompare(b.target_date))) {
      const source = nights.get(night.target_date), reasons = [];
      if (lastCompleteDate === null) reasons.push('no_complete_service_cutoff');
      else if (night.target_date < from || night.target_date > lastCompleteDate) reasons.push('outside_checked_window');
      if (run.model_major !== 4) reasons.push('model_major_mismatch');
      if (run.calibration_key !== calibrationKey) reasons.push('calibration_key_mismatch');
      if (!source) reasons.push('missing_source_night');
      else reasons.push(...projectionVolumeEligibility(source, { restaurantId, asOf }).reasons);
      if (night.availability !== 'available') reasons.push('forecast_unavailable');
      if (!(night.expected > 0)) reasons.push('nonpositive_forecast');
      add(run, night, null, night.expected, source?.total_units ?? null, reasons);
      for (const dish of [...night.dishes].sort((a, b) => a.dish_id.localeCompare(b.dish_id))) {
        const fact = facts.get(`${night.target_date}:${dish.dish_id}`), dishReasons = [...reasons];
        if (!(dish.expected > 0)) dishReasons.push('nonpositive_dish_forecast');
        if (!fact) dishReasons.push('missing_dish_actual');
        else if (fact.source_revision !== source?.source_revision) dishReasons.push('dish_source_revision_mismatch');
        // recommended and sold_out deliberately do not enter range calibration.
        add(run, night, dish.dish_id, dish.expected, fact?.units ?? null, dishReasons);
      }
    }
  }
  const sort = (a, b) => a.target_date.localeCompare(b.target_date) || a.days_ahead - b.days_ahead ||
    (a.dish_id ?? '').localeCompare(b.dish_id ?? '') || a.archive_id.localeCompare(b.archive_id);
  return { from, through: lastCompleteDate, observations: observations.sort(sort), excluded: excluded.sort(sort) };
}