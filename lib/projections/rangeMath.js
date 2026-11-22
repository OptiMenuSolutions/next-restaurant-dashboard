import { projectionDayNumber, projectionISOWeekday } from './eligibility.js';
import { shiftProjectionDate } from './businessTime.js';

export function rangeError(message) {
  const error = new TypeError(message); error.code = 'PROJECTION_RANGE_INVALID'; throw error;
}
export function rangeNumber(value, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) rangeError('Invalid range number.');
  return value;
}
export function percentileInc(values, probability) {
  if (!Array.isArray(values) || !values.length || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    rangeError('Percentiles need observations and a probability.');
  }
  const sorted = values.map(v => rangeNumber(v)).sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability, lo = Math.floor(index), fraction = index - lo;
  return sorted[lo] * (1 - fraction) + sorted[Math.min(lo + 1, sorted.length - 1)] * fraction;
}

// Acklam inverse-normal approximation, refined in the central region using
// the convergent normal integral series. No platform-dependent statistics API.
export function inverseStandardNormal(p) {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) rangeError('Normal probability must be inside (0, 1).');
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const polynomial = (coefficients, x) => coefficients.reduce((sum, coefficient) => sum * x + coefficient, 0);
  let x;
  if (p < 0.02425 || p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p));
    x = polynomial(c, q) / polynomial([...d, 1], q); if (p > 0.5) x = -x;
  } else {
    const q = p - 0.5, r = q * q;
    x = polynomial(a, r) * q / polynomial([...b, 1], r);
  }
  if (Math.abs(x) < 5) {
    let term = x, sum = x;
    for (let divisor = 3; divisor < 201; divisor += 2) {
      term *= x * x / divisor; sum += term;
      if (Math.abs(term) < Math.abs(sum) * Number.EPSILON) break;
    }
    const density = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
    x -= (0.5 + sum * density - p) / density;
  }
  return x;
}
export const mondayOf = date => shiftProjectionDate(date, 1 - projectionISOWeekday(date));

export function rangeStatistics(observations, settings) {
  const rows = [...observations].sort((a, b) => a.target_date.localeCompare(b.target_date));
  const count = rows.length, pLow = (1 - settings.range_coverage) / 2, pHigh = (1 + settings.range_coverage) / 2;
  const weeks = [...new Set(rows.map(row => mondayOf(row.target_date)))].sort();
  const span = count > 1 ? (projectionDayNumber(rows.at(-1).target_date) - projectionDayNumber(rows[0].target_date) + 1) / 7 : 0;
  const ratios = rows.map(row => row.ratio);
  const low = count > 1 ? percentileInc(ratios, pLow) : 0;
  const high = count > 1 ? percentileInc(ratios, pHigh) : 0;
  const median = count > 1 ? percentileInc(ratios, 0.5) : 0;
  const reasons = [];
  if (count < 2) reasons.push('fewer_than_two_checked_nights');
  if (span < settings.minimum_empirical_weeks) reasons.push('checked_span_too_short');
  if (weeks.length < settings.minimum_empirical_weeks) reasons.push('too_few_distinct_checked_weeks');
  if (median <= 0) reasons.push('nonpositive_median');
  return { count, span_weeks: span, distinct_weeks: weeks.length, week_starts: weeks,
    p_low: pLow, p_high: pHigh, low_quantile: low, high_quantile: high, median,
    empirical_available: reasons.length === 0, reasons, observations: rows };
}

export function projectionBias(observations, lastCompleteDate, settings) {
  if (lastCompleteDate === null) return { status: 'INSUFFICIENT HISTORY', qualifying_weeks: 0, weeks: [] };
  // v4 deliberately skips the containing week, even when the cutoff is Sunday.
  const end = shiftProjectionDate(mondayOf(lastCompleteDate), -1);
  const weeks = Array.from({ length: Math.max(Math.ceil(settings.empirical_lookback_weeks), settings.bias_consecutive_weeks) }, (_, i) => {
    const until = shiftProjectionDate(end, -7 * i), from = shiftProjectionDate(until, -6);
    const rows = observations.filter(row => row.target_date >= from && row.target_date <= until);
    const median = rows.length ? percentileInc(rows.map(row => row.ratio), 0.5) : null;
    return { from, until, count: rows.length, median, biased: median === null ? null : Math.abs(median - 1) > settings.bias_threshold };
  });
  const recent = weeks.slice(0, settings.bias_consecutive_weeks);
  const complete = recent.every(row => row.median !== null);
  const count = complete ? recent.filter(row => row.biased).length : 0;
  return { status: !complete ? 'INSUFFICIENT HISTORY' : count === settings.bias_consecutive_weeks
    ? 'consistent forecast bias' : 'NO PERSISTENT BIAS', qualifying_weeks: count, weeks };
}

export function volumeRange({ expected, daysAhead, historyWeeks, statistics, settings }) {
  if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 8) rangeError('Days ahead must be 1 through 8.');
  rangeNumber(historyWeeks);
  const cold = historyWeeks < settings.cold_start_weeks;
  const width = (settings.volume_half_width_near + (settings.volume_half_width_far - settings.volume_half_width_near) *
    (daysAhead - 1) / 7) * (cold ? settings.cold_start_range_multiplier : 1);
  const empirical = statistics.empirical_available;
  const lowerRatio = empirical ? Math.max(0, Math.min(1, statistics.low_quantile / statistics.median)) : Math.max(0, 1 - width);
  const upperRatio = empirical ? Math.max(1, statistics.high_quantile / statistics.median) : 1 + width;
  const e = (upperRatio - lowerRatio) / 2;
  if (expected !== null) rangeNumber(expected);
  return { expected, lower: expected === null ? null : expected * lowerRatio,
    upper: expected === null ? null : expected * upperRatio, lower_ratio: lowerRatio, upper_ratio: upperRatio, e,
    source: empirical ? 'MEDIAN-CENTRED EMPIRICAL' : 'DEFAULT / COLD START',
    default_half_width: width, cold_start: cold, cold_start_multiplier: cold ? settings.cold_start_range_multiplier : 1 };
}

export function dishRange({ expected, e, isNew, lambda, statistics, settings }) {
  if (typeof isNew !== 'boolean') rangeError('Dish new status is required.');
  rangeNumber(e);
  if (isNew && (!Number.isFinite(lambda) || lambda < 0 || lambda > 1)) rangeError('New dishes need lambda in [0, 1].');
  if (expected !== null) rangeNumber(expected);
  const z = settings.range_z_override ?? inverseStandardNormal((1 + settings.range_coverage) / 2);
  const factor = isNew ? 1 + (settings.maximum_new_dish_range_multiplier - 1) * (1 - lambda) : 1;
  const random = expected === null ? null : z * Math.sqrt(expected);
  const half = expected === null ? null : z * Math.hypot(Math.sqrt(expected), expected * e) * factor;
  const empirical = !isNew && statistics.empirical_available;
  const lower = expected === null ? null : empirical
    ? Math.max(0, Math.min(expected, expected * statistics.low_quantile / statistics.median, expected - random))
    : Math.max(0, Math.min(expected, expected - half, expected - random));
  const upper = expected === null ? null : empirical
    ? Math.max(expected, expected * statistics.high_quantile / statistics.median, expected + random)
    : Math.max(expected, expected + half, expected + random);
  return { expected, lower, upper, e, z, new_factor: factor, random_half_width: random, fallback_half_width: half,
    source: empirical ? 'MEDIAN-CENTRED + RANDOM FLOOR' : isNew ? 'POISSON + VOLUME; NEW WIDENING' : 'POISSON + VOLUME' };
}