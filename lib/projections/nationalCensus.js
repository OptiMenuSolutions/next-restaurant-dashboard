import { shiftProjectionDate as shift } from './businessTime.js';
import { projectionDayNumber as day, projectionISOWeekday as weekday } from './eligibility.js';
import { projectionDeepFreeze, projectionVolumeDigest as digest } from './volumeProvenance.js';
import { interpolateCpiMonths } from './cpiGap.js';

export const CENSUS_BENCHMARK_SETTINGS = projectionDeepFreeze({
  version: 1,
  curve_method: 'national-weekday-v1',
  census_weekday_weights: [1, 1, 1, 1, 1, 1, 1],
});

const positive = n => Number.isFinite(n) && n > 0;
const check = (ok, message) => {
  if (!ok) throw Object.assign(new Error(message), { code: 'PROJECTION_BENCHMARK_INVALID' });
};

export function validateCensusSettings(settings) {
  check(settings && Number.isSafeInteger(settings.version) && settings.version > 0 &&
    settings.curve_method === 'national-weekday-v1' &&
    Object.keys(settings).sort().join(',') === 'census_weekday_weights,curve_method,version' &&
    Array.isArray(settings.census_weekday_weights) &&
    settings.census_weekday_weights.length === 7 &&
    settings.census_weekday_weights.every(positive), 'Invalid national Census settings.');
  check(settings.version !== 1 || settings.census_weekday_weights.every(n => n === 1),
    'National Census settings v1 requires equal weights.');
  return settings;
}

export function readCensusCurve(snapshot, expectedDigest) {
  check(snapshot && expectedDigest === digest(snapshot), 'Pinned Census curve digest changed.');
  validateCensusSettings(snapshot.benchmark_settings);
  check(Array.isArray(snapshot.points) && snapshot.points.every((p, i, rows) =>
    /^\d{4}-(0[1-9]|1[0-2])-01$/.test(p.date) && Number.isFinite(p.midpoint) &&
    positive(p.value) && positive(p.denominator) &&
    (!i || (p.date > rows[i - 1].date && p.midpoint > rows[i - 1].midpoint))),
  'Invalid pinned Census points.');
  const pinned = projectionDeepFreeze(structuredClone(snapshot));
  const points = pinned.points;
  const daily = date => {
    const x = day(date);
    const i = points.findIndex(p => p.midpoint >= x);
    if (i < 0 || (i === 0 && points[0].midpoint !== x)) return null;
    if (points[i].midpoint === x) return points[i].value;
    const a = points[i - 1], b = points[i];
    if (day(b.date) - day(a.date) > 31) return null;
    return a.value + (b.value - a.value) * (x - a.midpoint) / (b.midpoint - a.midpoint);
  };
  return {
    snapshot: pinned,
    digest: expectedDigest,
    benchmark_settings: pinned.benchmark_settings,
    cpi_gap_policy: pinned.cpi_gap_policy,
    cpi_interpolated: pinned.cpi_interpolated,
    weekly(date) {
      const monday = shift(date, 1 - weekday(date));
      const values = Array.from({ length: 7 }, (_, i) => daily(shift(monday, i)));
      return values.every(positive) ? values.reduce((a, b) => a + b, 0) / 7 : null;
    },
  };
}

// Called once when a benchmark version is built, before any restaurant inputs.
export function censusCurve({
  sales, cpi, benchmark_settings = CENSUS_BENCHMARK_SETTINGS, cpi_gap_policy = null,
}) {
  validateCensusSettings(benchmark_settings);
  check(Array.isArray(sales) && Array.isArray(cpi), 'Monthly observations are required.');
  const observations = rows => {
    const values = new Map();
    for (const row of rows) {
      shift(row.date, 0);
      check(row.date.endsWith('-01') && !values.has(row.date),
        'Duplicate or non-monthly FRED observation.');
      check(row.value === null || positive(row.value), 'Invalid FRED observation.');
      values.set(row.date, row.value);
    }
    return values;
  };
  const nominal = observations(sales);
  const preparedCpi = interpolateCpiMonths(cpi, cpi_gap_policy);
  const prices = observations(preparedCpi.months);
  const points = [...nominal.keys()].sort().flatMap(date => {
    if (!positive(nominal.get(date)) || !positive(prices.get(date))) return [];
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const until = next.toISOString().slice(0, 10);
    let denominator = 0;
    for (let d = date; d < until; d = shift(d, 1)) {
      denominator += benchmark_settings.census_weekday_weights[weekday(d) - 1];
    }
    const value = nominal.get(date) / (prices.get(date) / 100) / denominator;
    check(positive(denominator) && positive(value), 'Invalid Census monthly equivalent.');
    return [{ date, midpoint: (day(date) + day(until) - 1) / 2, denominator, value }];
  });
  const snapshot = {
    benchmark_settings, points, cpi_gap_policy,
    cpi_interpolated: preparedCpi.interpolated,
  };
  return readCensusCurve(snapshot, digest(snapshot));
}