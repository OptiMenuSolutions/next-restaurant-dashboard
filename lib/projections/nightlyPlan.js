import { resolveProjectionSettings } from './settings.js';
import { shiftProjectionDate } from './businessTime.js';
import { projectionDayNumber } from './eligibility.js';
import { selectProjectionCalendarVersion } from './calendarStore.js';
import { classifyProjectionCalendarNight } from './calendar.js';
import { buildHolidayFactors } from './holidayFactors.js';
import { buildHolidayLearning } from './holidayLearning.js';
import { buildProjectionLifecycle } from './lifecycle.js';
import { projectRestaurantVolume } from './volume.js';
import { projectDishShares } from './shares.js';
import { projectProjectionRanges } from './ranges.js';
import { projectionJobError } from './nightlySource.js';

export const projectionConserves = (a, b) =>
  Number.isFinite(a) && Number.isFinite(b) &&
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

const fail = message => {
  throw projectionJobError('PROJECTION_PLAN_INVALID', message);
};

const range = row => row.expected === null
  ? row.low === null && row.high === null
  : [row.expected, row.low, row.high].every(Number.isFinite) &&
    0 <= row.low && row.low <= row.expected && row.expected <= row.high;

export function validateProjectionPlan(plan) {
  if (!Array.isArray(plan?.nights) || plan.nights.length !== 8) {
    fail('Eight forecast nights are required.');
  }

  plan.nights.forEach((n, i) => {
    if (
      n.business_date !== shiftProjectionDate(plan.run_date, i) ||
      n.days_ahead !== i + 1 ||
      !range(n) ||
      !['available', 'needs_baseline', 'closed'].includes(n.availability) ||
      !Array.isArray(n.dishes)
    ) fail('Invalid forecast night.');

    if (
      (n.availability === 'needs_baseline') !== (n.expected === null) ||
      (n.availability === 'closed' &&
        [n.expected, n.low, n.high].some(v => v !== 0))
    ) fail('Invalid night availability.');

    if (
      !n.trace ||
      !['ok', 'closed', 'needs_baseline'].includes(n.trace.share_status) ||
      !Array.isArray(n.trace.categories)
    ) fail('Missing allocation trace.');

    if (
      n.availability === 'available' &&
      n.trace.share_status === 'needs_baseline' &&
      (
        !Array.isArray(n.trace.partial_categories) ||
        !n.trace.partial_categories.length ||
        !n.confidence?.includes('partial categories')
      )
    ) fail('Partial category availability must be disclosed.');

    const ids = new Set();

    for (const d of n.dishes) {
      if (
        ids.has(d.dish_id) ||
        !range(d) ||
        (d.share !== null &&
          (!Number.isFinite(d.share) || d.share < 0 || d.share > 1))
      ) fail('Invalid dish forecast.');

      ids.add(d.dish_id);

      if (
        n.availability === 'closed' &&
        [d.expected, d.low, d.high].some(v => v !== 0)
      ) fail('Closed dish must be zero.');

      if (
        d.trace.active &&
        d.trace.is_new &&
        d.trace.cap_applied &&
        d.trace.capped_new_total >
          plan.settings_snapshot.maximum_new_dish_share + 1e-9
      ) fail('New-dish cap exceeded.');
    }

    if (n.trace.share_status === 'ok') {
      if (
        n.dishes.some(d => d.expected === null || d.share === null) ||
        !projectionConserves(
          n.dishes.reduce((s, d) => s + d.expected, 0),
          n.expected
        ) ||
        !projectionConserves(
          n.dishes.reduce((s, d) => s + d.share, 0),
          1
        )
      ) fail('Forecast does not conserve demand.');

      if (!n.trace.categories.every(c =>
        c.status === 'inactive' || projectionConserves(
          n.dishes
            .filter(d => d.trace.style_category === c.style_category)
            .reduce((s, d) => s + d.trace.within_category_share, 0),
          1
        )
      )) fail('Category allocation failed.');
    }
  });

  return plan;
}

// All source arrays come from one database snapshot. No live read occurs here.
export function buildProjectionRun(raw) {
  const restaurantId = raw.restaurant_id;
  const asOf = raw.as_of;
  const snapshotAt = raw.snapshot_at;

  if (
    raw.lifecycle?.restaurant_id !== restaurantId ||
    raw.holiday?.restaurant_id !== restaurantId
  ) fail('Snapshot crosses restaurants.');

  const l = raw.lifecycle;
  const h = raw.holiday;

  const resolvedSettings = resolveProjectionSettings({
    restaurantId,
    at: snapshotAt,
    globalVersion: h.global_version,
    restaurantVersion: h.restaurant_version,
  });

  const s = resolvedSettings.settings;

  if (!Object.hasOwn(s, 'publish_deadline_minutes') || s.horizon_days !== 8) {
    fail('Approved publication settings are required.');
  }

  const life = buildProjectionLifecycle({
    restaurantId,
    asOf,
    snapshotAt,
    resolvedSettings,
    restaurant: l.restaurant,
    dishes: l.dishes,
    availability: l.availability,
    history: l.history,
    dishFacts: l.dish_facts,
    priorSales: l.prior_sales,
    launchHistory: l.launch_history,
    menuRepairs: l.menu_repairs,
    context_digest: l.context_digest,
  });

  const ctx = h.calendar_context;

  const calendar = Array.from({ length: 8 }, (_, i) => {
    const day = shiftProjectionDate(asOf, i);
    const configuration = selectProjectionCalendarVersion(
      ctx.versions, restaurantId, day
    );

    return {
      ...classifyProjectionCalendarNight({
        restaurantId,
        date: day,
        configuration,
        holidays: ctx.holidays,
        rules: ctx.rules,
        asOf: snapshotAt,
        today: asOf,
        history: ctx.history,
        holidayAnswers: ctx.holiday_answers,
        earlyCloseFactor: s.early_close_factor,
        thresholdUnits: ctx.closure_conflict_threshold_units,
      }),
      restaurant_id: restaurantId,
      configuration_revision: configuration.revision,
      context_digest: h.context_digest,
    };
  });

  const learning = buildHolidayLearning({
    restaurantId,
    asOf,
    snapshotAt,
    resolvedSettings,
    modelVersion: h.model_version,
    firstDataDate: h.first_data_date,
    history: h.history,
    holidays: ctx.holidays,
    holidayAnswers: ctx.holiday_answers,
    archives: h.archives,
    closureThresholdUnits: ctx.closure_conflict_threshold_units,
    context_digest: h.context_digest,
  });

  const usable = new Set(
    learning.observations.map(row => row.business_date)
  );

  const excludedDates = [...new Set(h.observations
    .filter(row => row.business_date < asOf && !usable.has(row.business_date))
    .map(row => row.business_date))];

  const holidaySnapshot = buildHolidayFactors({
    restaurantId,
    asOf,
    snapshotAt,
    resolvedSettings,
    calendar,
    rules: ctx.rules,
    observations: h.observations,
    excludedDates,
  });

  const lastCompleteDate = l.history
    .filter(n => n.complete && n.source_covered)
    .map(n => n.business_date)
    .sort()
    .at(-1) ?? null;

  const sourceThrough = lastCompleteDate ?? shiftProjectionDate(asOf, -1);

  const volume = projectRestaurantVolume({
    restaurantId,
    asOf,
    resolvedSettings,
    modelVersion: h.model_version,
    firstDataDate: h.first_data_date,
    sourceThrough,
    history: l.history,
    calendar,
    holidaySnapshot,
  });

  const shares = projectDishShares({
    restaurantId,
    asOf,
    snapshotAt,
    resolvedSettings,
    volume,
    history: l.history,
    styleCategories: raw.style_categories,
    dishes: life.dishes,
    availability: life.availability,
    dishFacts: l.dish_facts,
    launchHistory: life.launch_history,
  });

  const ranges = projectProjectionRanges({
    restaurantId,
    asOf,
    snapshotAt,
    lastCompleteDate,
    resolvedSettings,
    volume,
    shares,
    history: l.history,
    dishFacts: l.dish_facts,
    archives: raw.archives,
  });

  const plan = {
    restaurant_id: restaurantId,
    run_date: asOf,
    model_major: 4,
    source_through: sourceThrough,
    settings_snapshot: { ...s },
    settings_digest: resolvedSettings.settings_digest,
    calibration_key: resolvedSettings.calibration_key,
    trace: {
      provenance: ranges.provenance,
      last_complete_date: lastCompleteDate,
      lifecycle_pending: life.pending,
      source_exclusions: raw.source_exclusions ?? [],
      source_cutoff_status: lastCompleteDate === null
        ? 'no_complete_night'
        : lastCompleteDate < shiftProjectionDate(asOf, -1)
          ? 'older_complete_history'
          : 'latest_complete_history',
    },
    nights: volume.nights.map((v, i) => {
      const share = shares.nights[i];
      const r = ranges.nights[i];
      const partial = v.status === 'ok' && share.status === 'needs_baseline';

      return {
        business_date: v.business_date,
        days_ahead: i + 1,
        availability: v.status === 'ok' ? 'available' : v.status,
        expected: r.volume.expected,
        low: r.volume.lower,
        high: r.volume.upper,
        confidence: `${v.history.tier}${partial ? '; partial categories' : ''}`,
        trace: {
          volume: v,
          range: r.volume,
          share_status: share.status,
          categories: share.categories,
          partial_categories: share.categories.filter(
            c => c.status === 'needs_baseline'
          ),
          checks: share.checks,
        },
        dishes: share.dishes.map(d => {
          const dr = r.dishes.find(x => x.dish_id === d.dish_id);
          return {
            dish_id: d.dish_id,
            share: d.overall_share,
            confidence: `${d.status}; ${dr.source}; ${d.clean_nights} clean nights${d.is_new ? '; new dish' : ''}`,
            expected: dr.expected,
            low: dr.lower,
            high: dr.upper,
            trace: { ...d, range: dr },
          };
        }),
      };
    }),
  };

  if (projectionDayNumber(sourceThrough) >= projectionDayNumber(asOf)) {
    fail('Forecast leaks future source data.');
  }

  return validateProjectionPlan(plan);
}