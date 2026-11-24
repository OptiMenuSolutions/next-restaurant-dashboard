import { shiftProjectionDate as shift } from './businessTime.js';
import { projectionVolumeEligibility } from './eligibility.js';
import { mondayOf } from './rangeMath.js';

const check = (condition, message) => {
  if (!condition) throw Object.assign(new Error(message), { code: 'PROJECTION_MONITOR_INVALID' });
};
const number = n => typeof n === 'number' && Number.isFinite(n);

export function monitorMetrics(group) {
  for (const key of ['observations', 'scored', 'zero_actual', 'mape_count', 'ape_sum',
    'absolute_error', 'actual_units', 'coverage_count', 'covered', 'partial_scope_count']) {
    check(number(group[key]) && group[key] >= 0, `Invalid monitor metric: ${key}`);
  }
  check(group.scored <= group.observations && group.mape_count + group.zero_actual === group.scored &&
    group.covered <= group.coverage_count, 'Inconsistent monitor counts.');
  return {
    ...group,
    mape: group.mape_count ? group.ape_sum / group.mape_count : null,
    wape: group.actual_units ? group.absolute_error / group.actual_units : null,
    mae: group.scored ? group.absolute_error / group.scored : null,
    coverage: group.coverage_count ? group.covered / group.coverage_count : null,
    excluded: group.observations - group.scored,
  };
}

export function monitorComparison(row) {
  const available = row.reason === null && number(row.expected) && number(row.actual);
  return {
    ...row,
    expected: row.dish_id ? (available ? row.expected : null) : row.raw_expected,
    difference: available ? row.actual - row.expected : null,
    ape: available && row.actual > 0 ? Math.abs(row.actual - row.expected) / row.actual : null,
    actual_share: row.dish_id && row.scope_actual > 0 && number(row.actual)
      ? row.actual / row.scope_actual : null,
    projected_share: row.dish_id && row.scope_share > 0 && number(row.archived_share)
      ? row.archived_share / row.scope_share : null,
    range_hit: row.quantity_reason === null && number(row.actual) && number(row.low) && number(row.high)
      ? row.actual >= row.low && row.actual <= row.high : null,
  };
}

export function monitorState(row) {
  if (!row.enabled) return { label: 'Disabled', stale: !!row.latest_run };
  if (row.backfill?.setup_error) return { label: 'Setup required', stale: !!row.latest_run };
  if (row.backfill?.backfill_complete !== true) return { label: 'Backfilling', stale: false };
  if (['pending', 'running', 'waiting'].includes(row.job?.status)) return { label: 'Pending', stale: false };
  if (['failed', 'missed'].includes(row.job?.status) && row.latest_run?.run_date === row.job?.business_date) {
    return { label: `Published; latest attempt ${row.job.status}`, stale: false };
  }
  if (['failed', 'missed', 'disabled'].includes(row.job?.status)) {
    return { label: row.job.status, stale: !!row.latest_run };
  }
  if (!row.latest_run) return { label: 'No published forecast', stale: false };
  return {
    label: row.latest_run.source_through < shift(row.latest_run.run_date, -1)
      ? 'Published using older history' : 'Published',
    stale: false,
  };
}

export function prepareMonitor(result, view) {
  check(result && typeof result === 'object' && !Array.isArray(result), 'Missing monitor response.');
  if (view === 'overview') {
    check(Array.isArray(result.restaurants), 'Missing restaurant overview.');
    return { ...result, restaurants: result.restaurants.map(row => ({ ...row, state: monitorState(row) })) };
  }
  check(['service', 'accuracy'].includes(view), 'Unknown monitor view.');
  return decodeMonitor(result, view);
}

// Packed arrays avoid repeating UUIDs and source facts for every forecast vintage.
export function decodeMonitor(result, view) {
  check(result?.format === 1 && result.restaurant?.id && result.snapshot_at &&
    ['catalog', 'categories', 'actuals', 'facts', 'nights', 'bias', 'revisions'].every(k => Array.isArray(result[k])),
  'Missing monitor snapshot.');
  const catalog = result.catalog;
  const dates = new Map();
  const asOf = shift(result.until, 1);
  for (const f of result.actuals) {
    check(!dates.has(f.business_date), 'Duplicate source night.');
    dates.set(f.business_date, { ...f, rows: [], sum: 0, factsValid: true });
  }
  for (const f of result.facts) {
    check(Array.isArray(f) && f.length === 6 && Number.isInteger(f[1]) && catalog[f[1]] && number(f[2]),
      'Invalid dish fact.');
    let date = dates.get(f[0]);
    if (!date) { date = { business_date: f[0], rows: [], sum: 0, factsValid: false }; dates.set(f[0], date); }
    check(date.rows[f[1]] === undefined, 'Duplicate actual dish.');
    date.rows[f[1]] = f; date.sum += f[2]; date.factsValid &&= f[5] === true && f[2] >= 0;
  }
  for (const date of dates.values()) {
    date.issue = !date.complete ? 'incomplete_actual' : !date.source_revision ? 'missing_source_revision' :
      !date.source_covered ? 'not_pos_covered' : date.source_issue ||
      (!date.factsValid || !number(date.total_units) || Math.abs(date.sum - date.total_units) > 1e-9 * Math.max(1, Math.abs(date.total_units))
        ? 'actual_facts_require_reingestion' : null);
    date.regular = !date.issue && !date.calendar_pending && projectionVolumeEligibility({ ...date,
      restaurant_id: result.restaurant.id }, { restaurantId: result.restaurant.id, asOf }).eligible;
  }
  const observations = [], groups = new Map(), seriesGroups = new Map(), weeks = new Map();
  const names = Object.fromEntries(catalog.map(row => [row[0], row[1]]));
  function group(key, header) {
    if (!groups.has(key)) groups.set(key, { ...header, observations: 0, scored: 0, zero_actual: 0,
      mape_count: 0, ape_sum: 0, absolute_error: 0, actual_units: 0,
      coverage_count: 0, covered: 0, partial_scope_count: 0 });
    return groups.get(key);
  }
  function add(g, expected, actual, reason, quantityReason, low, high, regular, partial) {
    g.observations++;
    if (result.regular_only && !regular) return;
    if (reason === null) {
      const error = Math.abs(actual - expected);
      g.scored++; g.absolute_error += error; g.actual_units += actual;
      if (actual > 0) { g.mape_count++; g.ape_sum += error / actual; } else g.zero_actual++;
      if (partial) g.partial_scope_count++;
    }
    if (quantityReason === null && number(low) && number(high)) {
      g.coverage_count++; if (actual >= low && actual <= high) g.covered++;
    }
  }
  for (const n of result.nights) {
    check(Array.isArray(n) && n.length === 15 && Number.isInteger(n[3]) && n[3] >= 1 && n[3] <= 8 &&
      Array.isArray(n[13]) && Array.isArray(n[14]), 'Invalid archived night.');
    const [run, runDate, date, lead, major, calibration, issuedAt, sourceThrough, expected, low, high, coverage, availability, categories, columns] = n;
    const actual = dates.get(date);
    const issue = (actual ? actual.issue : 'missing_actual') || (availability !== 'available' ? `forecast_${availability}` : null);
    const regular = actual?.regular === true;
    const available = new Set(categories);
    let scopeShare = 0, scopeActual = 0, knownActual = 0, scopeFacts = true, previous = -1;
    check(columns.length === 7, 'Missing archive columns.');
    const [indices, ...values] = columns.map(column => column ?? []);
    check(Array.isArray(indices), 'Invalid archive indices.');
    const [cat, shares, raw, lows, highs, status] = values.map(column => {
      check(Array.isArray(column) && (column.length === indices.length ||
        (indices.length > 0 && column.length === 1)), 'Archive columns have different lengths.');
      return column.length === 1 && indices.length > 1
        ? Array(indices.length).fill(column[0]) : column;
    });
    const category = i => typeof cat[i] === 'number' ? result.categories[cat[i]] : cat[i];
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      check(Number.isInteger(index) && catalog[index] && index > previous, 'Invalid or duplicate archived dish.');
      previous = index;
      const f = actual?.rows[index];
      knownActual += f?.[2] ?? 0;
      if (available.has(category(i))) {
        scopeShare += shares[i] ?? 0; scopeActual += f?.[2] ?? 0; scopeFacts &&= f?.[5] === true;
      }
    }
    const scopeIssue = !scopeFacts ? 'missing_available_category_actual' :
      Math.abs(knownActual - (actual?.total_units ?? 0)) > 1e-9 * Math.max(1, actual?.total_units ?? 0)
        ? 'actual_category_scope_unknown' : scopeShare <= 0 ? 'nonpositive_available_share' :
          scopeActual === 0 ? 'zero_available_category_actual' : null;
    const base = { run_id: run, run_date: runDate, target_date: date, days_ahead: lead,
      model_major: major, calibration_key: calibration, coverage_target: coverage,
      issued_at: issuedAt, source_through: sourceThrough, source_revision: actual?.source_revision ?? null, regular };
    const series = `${major}|${calibration}|${coverage}|${lead}`;
    if (view === 'accuracy' && !weeks.has(date)) weeks.set(date, mondayOf(date));
    const week = view === 'accuracy' ? weeks.get(date) : null;
    const header = { days_ahead: lead, model_major: major, calibration_key: calibration, coverage_target: coverage };
    if (view === 'service') observations.push(monitorComparison({ ...base, dish_id: null, category: null,
      expected, raw_expected: expected, actual: actual?.total_units ?? null, low, high, reason: issue, quantity_reason: issue }));
    else add(group(`w|${week}|${series}|v`, { ...header, bucket: 'week', week, kind: 'volume', dish: null }),
      expected, actual?.total_units ?? null, issue, issue, low, high, regular, false);
    if (!seriesGroups.has(series)) seriesGroups.set(series, []);
    const byDish = seriesGroups.get(series);
    const weekly = view === 'accuracy' ? group(`w|${week}|${series}|d`,
      { ...header, bucket: 'week', week, kind: 'dishes', dish: null }) : null;
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i], id = catalog[index][0], f = actual?.rows[index];
      const reason = issue || (!available.has(category(i)) ? 'category_unavailable' : status[i] !== 1 ? 'dish_forecast_unavailable' :
        f?.[5] !== true ? 'missing_or_stale_dish_actual' : scopeIssue);
      const quantityReason = issue || (raw[i] === null || status[i] !== 1 ? 'dish_forecast_unavailable' : f?.[5] !== true ? 'missing_or_stale_dish_actual' : null);
      const adjusted = scopeShare > 0 ? scopeActual * shares[i] / scopeShare : null;
      if (view === 'service') observations.push(monitorComparison({ ...base, dish_id: id, category: category(i),
        expected: adjusted, raw_expected: raw[i], actual: f?.[2] ?? null, low: lows[i], high: highs[i], archived_share: shares[i],
        scope_actual: scopeActual, scope_share: scopeShare, reason, quantity_reason: quantityReason,
        recommended: f?.[3] ?? null, sold_out: f?.[4] ?? null }));
      else if (!result.selected_dish || result.selected_dish === id) {
        const partial = scopeShare < 1 - 1e-9;
        add(weekly, adjusted, f?.[2] ?? null, reason, quantityReason, lows[i], highs[i], regular, partial);
        byDish[index] ||= group(`d|${series}|${id}`, { ...header, bucket: 'dish', week: null, kind: 'dishes', dish: id });
        add(byDish[index], adjusted, f?.[2] ?? null, reason, quantityReason, lows[i], highs[i], regular, partial);
      }
    }
  }
  const { format, catalog: ignoredCatalog, categories: ignoredCategories, facts, nights, actuals, ...metadata } = result;
  const restaurant = { ...result.restaurant, dish_names: names };
  if (view === 'service') return { ...metadata, restaurant, observations,
    actual_flags: result.actuals.find(f => f.business_date === result.until) ?? null };
  return { ...metadata, restaurant, groups: [...groups.values()].map(monitorMetrics).sort((a, b) =>
    (a.week || '').localeCompare(b.week || '') || a.days_ahead - b.days_ahead ||
    a.model_major - b.model_major || a.calibration_key.localeCompare(b.calibration_key) || (a.dish || '').localeCompare(b.dish || '')) };
}