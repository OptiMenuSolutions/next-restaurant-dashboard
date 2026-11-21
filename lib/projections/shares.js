import { shiftProjectionDate } from './businessTime.js';
import { projectionDayNumber, projectionISOWeekday } from './eligibility.js';
import { projectionDeepFreeze } from './volumeProvenance.js';
import { prepareShareSnapshot, shareClose, shareError } from './shareSnapshot.js';

const days = (a, b) => projectionDayNumber(a) - projectionDayNumber(b);
const sum = (rows, fn) => rows.reduce((value, row) => value + fn(row), 0);
const between = (row, from, until) => row.business_date >= from && row.business_date <= until;
const clean = row => row.recommended !== true && row.sold_out !== true;
const divide = (n, d) => d > 0 ? n / d : 0;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function baseline(dish, rows, ctx) {
  const { settings: s, through } = ctx;
  const window = weeks => rows.filter(row => row.business_date >= dish.launch_date &&
    between(row, shiftProjectionDate(through, 1 - 7 * weeks), through));
  const cleanBase = window(s.base_window_weeks).filter(clean).length;
  let weeks = s.base_window_weeks;
  while (weeks < s.maximum_dish_lookback_weeks && window(weeks).filter(clean).length < s.minimum_clean_dish_nights) weeks++;
  const selected = window(weeks), count = selected.filter(clean).length;
  const method = s.recommendation_treatment === 'adjust' ? 'ADJUST ASSUMED LIFT' :
    count >= s.minimum_clean_dish_nights ? 'CLEAN ONLY' : 'BASELINE INCLUDES RECOMMENDATION NIGHTS';
  const included = selected.filter(row => row.sold_out !== true && (method !== 'CLEAN ONLY' || row.recommended !== true));
  const adjustedUnits = row => row.units / (s.recommendation_treatment === 'adjust' && row.recommended === true
    ? 1 + s.assumed_recommendation_lift : 1);
  let raw = divide(sum(included, row => row.weight * adjustedUnits(row)), sum(included, row => row.weight * row.category_units));
  const owner = ctx.volume.nights[0].history.weeks < s.minimum_history_weeks && s.owner_estimates_enabled;
  if (owner) raw = divide(dish.owner_prior_weight,
    sum(ctx.menu.filter(d => d.forecastable && d.style_category === dish.style_category), d => d.owner_prior_weight));
  const sinceLaunch = rows.filter(row => row.business_date >= dish.launch_date && clean(row));
  const observed = divide(sum(sinceLaunch, row => row.weight * row.units), sum(sinceLaunch, row => row.weight * row.category_units));
  const n = sinceLaunch.length;
  const last = dish.last_season_removed_date;
  const returningRows = dish.is_returning && last && last < ctx.asOf
    ? rows.filter(row => between(row, shiftProjectionDate(last, -27), last)) : [];
  const returningDenominator = sum(returningRows, row => row.category_units);
  const bounded = value => clamp(value, s.launch_index_min, s.launch_index_max);
  const returning = returningDenominator > 0 && dish.last_season_category_count !== null
    ? bounded(sum(returningRows, row => row.units) / returningDenominator * dish.last_season_category_count) : null;
  const own = ctx.launches.filter(row => row.style_category === dish.style_category);
  const ownIndex = own.length ? bounded(sum(own, row => row.launch_index) / own.length) : null;
  const index = returning ?? ownIndex ?? bounded(s.default_launch_index);
  return { dish_id: dish.id, clean_nights_base: cleanBase, lookback_weeks: weeks, clean_nights: count,
    method, raw_share: raw, n, O: observed, lambda: n / (n + s.new_dish_prior_nights),
    returning_index: returning, own_launch_index: ownIndex, pooled_launch_index: null,
    prior_source: returning !== null ? 'RETURNING SEASON' : ownIndex !== null ? 'OWN LAUNCHES' : 'EVEN SPLIT',
    launch_index: index, owner_prior_used: owner,
    trace: { selected_from: dish.launch_date > shiftProjectionDate(through, 1 - 7 * weeks)
      ? dish.launch_date : shiftProjectionDate(through, 1 - 7 * weeks), selected_until: through,
      included_dates: included.map(row => row.business_date),
      excluded: selected.filter(row => !included.includes(row)).map(row => ({ business_date: row.business_date,
        reason: row.sold_out === true ? 'sold_out' : 'recommended' })),
      unknown_flags: rows.filter(row => row.recommended === null || row.sold_out === null).map(row => ({
        business_date: row.business_date, recommended: row.recommended === null, sold_out: row.sold_out === null })),
      returning_dates: returningRows.map(row => row.business_date), own_launch_ids: own.map(row => row.id),
      pooled_status: 'not_available', share_trend_per_week: dish.share_trend_per_week } };
}

function categories(target, ctx, activity, unitsByNight) {
  const { settings: s, through } = ctx;
  const from = shiftProjectionDate(through, 1 - 7 * s.base_window_weeks);
  const monday = shiftProjectionDate(target.business_date, 1 - projectionISOWeekday(target.business_date));
  const lyFrom = shiftProjectionDate(monday, -s.year_alignment_days - 7 * Math.floor(s.seasonal_smoothing_weeks / 2));
  const lyUntil = shiftProjectionDate(lyFrom, 7 * s.seasonal_smoothing_weeks - 1);
  const lyAnchor = shiftProjectionDate(through, -s.year_alignment_days);
  const weight = (date, anchor) => 0.5 ** (days(anchor, date) / (7 * s.share_half_life_weeks));
  const eligible = ctx.nights.filter(row => row.eligible);
  const current = eligible.filter(row => between(row, from, through));
  const lyBase = eligible.filter(row => between(row, shiftProjectionDate(from, -s.year_alignment_days), lyAnchor));
  const lyTarget = eligible.filter(row => between(row, lyFrom, lyUntil));
  const total = sum(current, row => row.total_units * weight(row.business_date, through));
  const lyTotal = sum(lyBase, row => row.total_units * weight(row.business_date, lyAnchor));
  const lyTargetTotal = sum(lyTarget, row => row.total_units);
  const ownerWeights = sum(ctx.menu.filter(d => d.forecastable), d => d.owner_prior_weight);
  const owner = ctx.volume.nights[0].history.weeks < s.minimum_history_weeks && s.owner_estimates_enabled && ownerWeights > 0;
  const rows = ctx.styles.map(style => {
    const units = night => unitsByNight.get(night.business_date)?.get(style) ?? 0;
    const weighted = sum(current, row => units(row) * weight(row.business_date, through));
    const base = owner ? sum(ctx.menu.filter(d => d.forecastable && d.style_category === style), d => d.owner_prior_weight) / ownerWeights
      : divide(weighted, total);
    const lyBaseShare = lyTotal > 0 ? sum(lyBase, row => units(row) * weight(row.business_date, lyAnchor)) / lyTotal : null;
    const lyTargetShare = lyTargetTotal > 0 ? sum(lyTarget, units) / lyTargetTotal : null;
    const ownRatio = lyBaseShare > 0 && lyTargetShare !== null ? lyTargetShare / lyBaseShare : null;
    const proxy = ownRatio === null && s.public_benchmarks_enabled;
    const rawRatio = ownRatio ?? (proxy ? 1 + s.google_trends_strength * (1 - 1) : 1);
    const ratio = clamp(rawRatio, s.seasonal_ratio_min, s.seasonal_ratio_max);
    const active = activity.filter(row => row.active && row.dish.style_category === style).length;
    return { style_category: style, weighted_category_units: weighted, weighted_total_units: total,
      base_share: base, ly_target_from: lyFrom, ly_target_until: lyUntil,
      ly_target_share: lyTargetShare, ly_base_share: lyBaseShare, own_ratio: ownRatio,
      ratio_source: ownRatio !== null ? 'OWN LY' : proxy ? 'GOOGLE SEARCH PROXY' : 'NEUTRAL: NO SEASONAL DATA',
      raw_ratio: rawRatio, capped_ratio: ratio,
      raw_share: active ? s.category_base_weight * base + (1 - s.category_base_weight) * base * ratio : 0,
      active_dish_count: active, share: 0,
      trace: { base_from: from, base_until: through, owner_prior_used: owner,
        proxy_status: proxy ? 'neutral_placeholder' : 'not_used', proxy_ratio: proxy ? 1 : null,
        pooled_status: 'not_available', base_dates: current.map(row => row.business_date),
        ly_base_dates: lyBase.map(row => row.business_date), ly_target_dates: lyTarget.map(row => row.business_date) } };
  });
  const denominator = sum(rows, row => row.raw_share);
  for (const row of rows) row.share = denominator > 0 ? row.raw_share / denominator : row.active_dish_count ? null : 0;
  return rows;
}

// Standalone Step 5: deterministic snapshots in, immutable calculations out.
export function projectDishShares(input) {
  const ctx = prepareShareSnapshot(input), s = ctx.settings;
  const unitsByNight = new Map(), nightByDate = new Map(ctx.nights.map(row => [row.business_date, row]));
  const menuById = new Map(ctx.menu.map(dish => [dish.id, dish]));
  for (const fact of ctx.facts) {
    if (!unitsByNight.has(fact.business_date)) unitsByNight.set(fact.business_date, new Map());
    const category = menuById.get(fact.dish_id).style_category;
    const totals = unitsByNight.get(fact.business_date);
    totals.set(category, (totals.get(category) ?? 0) + fact.units);
  }
  const rowsByDish = new Map(ctx.menu.map(dish => [dish.id, []]));
  for (const row of ctx.facts) {
    if (!nightByDate.get(row.business_date).eligible) continue;
    const category = menuById.get(row.dish_id).style_category;
    rowsByDish.get(row.dish_id).push({ ...row, category_units: unitsByNight.get(row.business_date).get(category),
      weight: 0.5 ** (days(ctx.through, row.business_date) / (7 * s.share_half_life_weeks)) });
  }
  const baselines = ctx.menu.filter(d => d.forecastable).map(dish => baseline(dish, rowsByDish.get(dish.id), ctx));
  const baselineByDish = new Map(baselines.map(row => [row.dish_id, row]));
  const nights = ctx.volume.nights.map(target => {
    const activity = ctx.menu.filter(d => d.forecastable).map(dish => {
      const active = dish.lifecycle_unavailable === true ||
        dish.launch_date <= target.business_date && (!dish.removed_date || target.business_date < dish.removed_date);
      const isNew = active && (dish.is_new || dish.is_returning) && days(target.business_date, dish.launch_date) < 7 * s.new_dish_weeks;
      return { dish, active, isNew };
    });
    const categoryRows = categories(target, ctx, activity, unitsByNight);
    const dishRows = activity.map(({ dish, active, isNew }) => {
      const base = baselineByDish.get(dish.id);
      const existing = activity.filter(row => row.active && !row.isNew && row.dish.style_category === dish.style_category).length;
      const P = base.launch_index / (existing + 1);
      const raw = active && !isNew ? base.raw_share : 0;
      const weekday = rowsByDish.get(dish.id).filter(row => clean(row) && row.business_date >= dish.launch_date &&
        between(row, base.trace.selected_from, ctx.through) && projectionISOWeekday(row.business_date) === projectionISOWeekday(target.business_date));
      const weekdayDenominator = sum(weekday, row => row.weight * row.category_units);
      const weekdayShare = weekdayDenominator > 0 ? sum(weekday, row => row.weight * row.units) / weekdayDenominator : raw;
      const shrink = weekday.length / (weekday.length + s.weekday_mix_prior_nights);
      const trend = s.share_trend_enabled ? Math.max(0, 1 + dish.share_trend_per_week * days(target.business_date, ctx.through) / 7) : 1;
      return { dish_id: dish.id, style_category: dish.style_category, active, is_new: isNew,
        n: base.n, lambda: base.lambda, O: base.O, P, prior_source: base.prior_source,
        proposed_share: isNew ? (1 - base.lambda) * P + base.lambda * base.O : 0,
        baseline_share: raw, weekday_clean_nights: weekday.length, weekday_clean_share: weekdayShare,
        raw_existing_share: active && !isNew ? (s.weekday_mix_enabled ? shrink * weekdayShare + (1 - shrink) * raw : raw) * trend : 0,
        normalized_existing_share: 0, proposed_new_total: 0, capped_new_total: 0, cap_applied: false,
        within_category_share: 0, category_share: null, overall_share: null, expected_units: null,
        baseline_method: base.method, lookback_weeks: base.lookback_weeks, clean_nights: base.clean_nights,
        baseline: base, category: categoryRows.find(row => row.style_category === dish.style_category) };
    });
    const categoryChecks = [];
    for (const category of categoryRows) {
      const group = dishRows.filter(row => row.style_category === category.style_category);
      const existingTotal = sum(group, row => row.raw_existing_share);
      const proposed = sum(group, row => row.proposed_share);
      const skipCap = category.active_dish_count > 0 && existingTotal === 0;
      const capped = skipCap ? 1 : Math.min(s.maximum_new_dish_share, proposed);
      category.trace.cap_skipped_no_existing = skipCap;
      for (const row of group) {
        row.normalized_existing_share = divide(row.raw_existing_share, existingTotal);
        row.proposed_new_total = proposed; row.capped_new_total = capped;
        row.cap_applied = !skipCap && proposed > capped;
        row.within_category_share = !row.active ? 0 : row.is_new ? divide(row.proposed_share * capped, proposed) : row.normalized_existing_share * (1 - capped);
        row.category_share = category.share;
      }
      const lifecycleBlocked = ctx.menu.filter(d => d.forecastable && d.lifecycle_unavailable && d.style_category === category.style_category);
      if (lifecycleBlocked.length) category.trace.lifecycle_unavailable_dish_ids = lifecycleBlocked.map(d => d.id);
      const total = sum(group, row => row.within_category_share);
      const withinPassed = lifecycleBlocked.length ? false : category.active_dish_count ? shareClose(total, 1, group.length) : total === 0;
      const reason = lifecycleBlocked.length ? 'lifecycle_unavailable' : !category.active_dish_count ? null : category.share === null ? 'category_share_unavailable' :
        withinPassed ? null : total === 0 ? 'no_positive_dish_share' : 'within_category_shares_not_conserved';
      category.status = reason ? 'needs_baseline' : category.active_dish_count ? 'ok' : 'inactive';
      category.reason = reason;
      for (const row of group) {
        if (lifecycleBlocked.length && row.active) row.within_category_share = null;
        row.status = !row.active ? 'inactive' : target.status === 'closed' ? 'closed' :
          reason || target.status === 'needs_baseline' ? 'needs_baseline' : 'ok';
        row.reason = row.status === 'needs_baseline' ? reason ?? 'volume_needs_baseline' : null;
        row.overall_share = !row.active ? 0 : reason || category.share === null ? null : row.within_category_share * category.share;
        row.expected_units = !row.active || target.status === 'closed' ? 0 : target.status === 'needs_baseline' || row.overall_share === null
          ? null : target.adjusted_volume * row.overall_share;
      }
      categoryChecks.push({ style_category: category.style_category, active_dishes: category.active_dish_count,
        sum: lifecycleBlocked.length ? null : total, passed: withinPassed, status: category.status, reason });
    }
    const categorySum = sum(categoryRows, row => row.share ?? 0);
    const categoryPassed = shareClose(categorySum, 1, categoryRows.length);
    const passed = categoryPassed && categoryChecks.every(row => row.passed);
    const reasons = [
      ...(target.status === 'needs_baseline' ? [{ code: 'volume_needs_baseline' }] : []),
      ...(!categoryPassed ? [{ code: 'category_shares_not_conserved' }] : []),
      ...categoryRows.filter(row => row.status === 'needs_baseline')
        .map(row => ({ code: row.reason, style_category: row.style_category })),
    ];
    const status = target.status === 'closed' ? 'closed' :
      target.status === 'needs_baseline' || !passed ? 'needs_baseline' : 'ok';
    return { business_date: target.business_date, status, volume_status: target.status, reasons,
      adjusted_volume: target.adjusted_volume, categories: categoryRows, dishes: dishRows,
      checks: { available: passed, conserved: passed, category_sum: categorySum, within_categories: categoryChecks } };
  });
  const result = { provenance: ctx.provenance, baselines, nights };
  const finite = value => {
    if (typeof value === 'number' && !Number.isFinite(value)) shareError('Share calculation overflow.');
    if (value && typeof value === 'object') Object.values(value).forEach(finite);
  };
  finite(result);
  return projectionDeepFreeze(result);
}