import { shiftProjectionDate } from './businessTime.js';
import { PROJECTION_UUID } from './eligibility.js';
import { holidayInstant } from './holidayFactors.js';
import { validateProjectionSettings, projectionSettingsDigest, projectionCalibrationKey } from './settings.js';
import { checkedProjectionForecasts } from './checkedForecasts.js';
import { rangeError as fail, rangeNumber, rangeStatistics, projectionBias, volumeRange, dishRange } from './rangeMath.js';
import { projectionVolumeDigest, projectionDeepFreeze, projectionCanonicalJSON } from './volumeProvenance.js';

// Pure Step 9: consume the supplied point forecasts, never refit their history
// or change a point estimate. No database, scheduling or product integration.
export function projectProjectionRanges({ restaurantId, asOf, snapshotAt, lastCompleteDate,
  resolvedSettings: r, volume, shares, history, dishFacts, archives } = {}) {
  if (!PROJECTION_UUID.test(restaurantId || '')) fail('Restaurant context is required.');
  shiftProjectionDate(asOf, 0);
  const s = validateProjectionSettings(r?.settings);
  if (r.restaurant_id !== restaurantId || r.model_major !== 4 || !PROJECTION_UUID.test(r.global_version_id || '') ||
    (r.restaurant_version_id !== null && !PROJECTION_UUID.test(r.restaurant_version_id || '')) ||
    r.settings_digest !== projectionSettingsDigest(s) || r.calibration_key !== projectionCalibrationKey(4, s)) fail('Verified v4 settings are required.');
  const vp = volume?.provenance, sp = shares?.provenance;
  if (vp?.model_version?.model_major !== 4 || vp.model_version.logic_revision !== 'approved-workbook-v4' ||
    !/^[a-f0-9]{64}$/.test(vp.model_version.reference_sha256 || '') ||
    holidayInstant(vp.model_version.released_at) > holidayInstant(snapshotAt)) fail('Registered v4 model context is required.');
  for (const p of [vp, sp]) {
    if (!p || p.restaurant_id !== restaurantId || p.as_of !== asOf || p.model_major !== 4 ||
      p.logic_revision !== 'approved-workbook-v4' || p.settings_digest !== r.settings_digest ||
      p.calibration_key !== r.calibration_key || p.global_version_id !== r.global_version_id ||
      p.restaurant_version_id !== r.restaurant_version_id || !/^[a-f0-9]{64}$/.test(p.context_digest || '')) fail('Point forecast provenance does not match.');
  }
  if (sp.volume_context_digest !== vp.context_digest || sp.snapshot_at !== snapshotAt ||
    projectionCanonicalJSON(vp.model_version) !== projectionCanonicalJSON(sp.model_version)) fail('Point forecasts come from different snapshots.');
  if (!Array.isArray(volume.nights) || !Array.isArray(shares.nights) || volume.nights.length !== 8 || shares.nights.length !== 8) fail('Eight point-forecast nights are required.');
  const checked = checkedProjectionForecasts({ restaurantId, asOf, snapshotAt, lastCompleteDate,
    settings: s, calibrationKey: r.calibration_key, history, dishFacts, archives });
  const series = (daysAhead, dishId) => checked.observations.filter(row => row.days_ahead === daysAhead && row.dish_id === dishId);
  const index = rows => {
    const map = new Map();
    for (const row of rows) { if (map.has(row.business_date)) fail('Duplicate target date.'); map.set(row.business_date, row); }
    return map;
  };
  const volumes = index(volume.nights), dishes = index(shares.nights);
  const nights = Array.from({ length: 8 }, (_, i) => {
    const date = shiftProjectionDate(asOf, i), v = volumes.get(date), d = dishes.get(date), daysAhead = i + 1;
    if (!v || !d || !['ok', 'closed', 'needs_baseline'].includes(v.status) || d.adjusted_volume !== v.adjusted_volume ||
      d.volume_status !== v.status || !Array.isArray(d.dishes)) fail('Target point forecasts disagree.');
    if (v.history.last_complete_date !== lastCompleteDate || typeof v.history.tier !== 'string') fail('History cutoff and confidence are required from Step 4.');
    if ((v.status === 'needs_baseline') !== (v.adjusted_volume === null) ||
      (v.status === 'closed' && v.adjusted_volume !== 0)) fail('Invalid point forecast availability.');
    const stats = rangeStatistics(series(daysAhead, null), s, lastCompleteDate);
    const vr = volumeRange({ expected: v.adjusted_volume, daysAhead, historyWeeks: v.history.weeks, statistics: stats, settings: s });
    const ids = new Set();
    const rows = [...d.dishes].sort((a, b) => a.dish_id.localeCompare(b.dish_id)).map(dish => {
      if (!PROJECTION_UUID.test(dish.dish_id || '') || ids.has(dish.dish_id)) fail('Invalid or duplicate target dish.'); ids.add(dish.dish_id);
      if (dish.expected_units !== null) rangeNumber(dish.expected_units);
      if ((dish.status === 'needs_baseline' && dish.expected_units !== null) ||
        (['closed', 'inactive'].includes(dish.status) && dish.expected_units !== 0) ||
        !['ok', 'closed', 'inactive', 'needs_baseline'].includes(dish.status)) fail('Invalid dish forecast availability.');
      const observations = series(daysAhead, dish.dish_id), statistics = rangeStatistics(observations, s, lastCompleteDate);
      return { dish_id: dish.dish_id, status: dish.status,
        ...dishRange({ expected: dish.expected_units, e: vr.e, isNew: dish.is_new, lambda: dish.lambda, statistics, settings: s }),
        statistics, bias: projectionBias(observations, lastCompleteDate, s) };
    });
    return { business_date: date, days_ahead: daysAhead, status: v.status, confidence: v.history.tier,
      volume: { ...vr, statistics: stats, bias: projectionBias(series(daysAhead, null), lastCompleteDate, s) }, dishes: rows };
  });
  const provenance = { ...structuredClone(sp), last_complete_date: lastCompleteDate, volume_context_digest: vp.context_digest,
    share_context_digest: sp.context_digest, settings_snapshot: { ...s } };
  const orderedVolume = { ...volume, nights: [...volume.nights].sort((a, b) => a.business_date.localeCompare(b.business_date)) };
  const orderedShares = { ...shares, nights: [...shares.nights].sort((a, b) => a.business_date.localeCompare(b.business_date))
    .map(n => ({ ...n, dishes: [...n.dishes].sort((a, b) => a.dish_id.localeCompare(b.dish_id)) })) };
  provenance.context_digest = projectionVolumeDigest({ provenance, checked, volume: orderedVolume, shares: orderedShares });
  const result = { provenance, checked, nights };
  const finite = value => {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('Range calculation overflow.');
    if (value && typeof value === 'object') Object.values(value).forEach(finite);
  };
  finite(result);
  return projectionDeepFreeze(result);
}