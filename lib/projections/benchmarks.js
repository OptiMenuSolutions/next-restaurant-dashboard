import { projectionInstant, shiftProjectionDate as shift } from './businessTime.js';
import { interpolateCpiMonths } from './cpiGap.js';
import {
  projectionDayNumber as day,
  projectionISOWeekday as weekday,
  projectionVolumeEligibility,
} from './eligibility.js';
import {
  projectionVolumeDigest as digest,
  projectionDeepFreeze,
} from './volumeProvenance.js';

export const BENCHMARK_DICTIONARY = projectionDeepFreeze({
  version: 1,
  effective_from: '2026-11-22',
  geography: 'US-state',
  filters: {
    category: 0,
    property: 'web',
    frequency: 'weekly',
    language: 'en',
  },
  categories: {
    'Comfort/Heavy': ['soup', 'beef stew', 'pot roast', 'mac and cheese'],
    'Light/Fresh': ['salad', 'grain bowl', 'grilled vegetables', 'grilled fish'],
    Neutral: [],
  },
});

export const benchmarkError = message => Object.assign(new Error(message), {
  code: 'PROJECTION_BENCHMARK_INVALID',
});

const check = (ok, message) => {
  if (!ok) throw benchmarkError(message);
};

const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const sum = rows => rows.reduce((n, x) => n + x, 0);
const mean = rows => sum(rows) / rows.length;

export const benchmarkWeek = date => shift(date, 1 - weekday(date));

export function censusCurve({ sales, cpi, weekdayLevels, closedWeekdays, cpi_gap_policy = null }) {
  check(
    Array.isArray(sales) && Array.isArray(cpi),
    'Monthly observations are required.'
  );
  check(
    Array.isArray(closedWeekdays) &&
      closedWeekdays.every(n => Number.isInteger(n) && n >= 1 && n <= 7),
    'Invalid closed weekdays.'
  );

  const open = [1, 2, 3, 4, 5, 6, 7].filter(n => !closedWeekdays.includes(n));

  check(
    open.length &&
      open.every(n => Number.isFinite(weekdayLevels[n]) && weekdayLevels[n] >= 0) &&
      open.some(n => positive(weekdayLevels[n])),
    'Open weekdays need positive fitted levels.'
  );

  const average = mean(open.map(n => weekdayLevels[n]));
  const weights = Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7].map(n => [
      n,
      closedWeekdays.includes(n) ? 0 : weekdayLevels[n] / average,
    ])
  );

  const observations = rows => {
    const values = new Map();

    for (const row of rows) {
      shift(row.date, 0);
      check(
        row.date.endsWith('-01') && !values.has(row.date),
        'Duplicate or non-monthly FRED observation.'
      );
      if (row.value !== null) {
        check(positive(row.value), 'Invalid FRED observation.');
      }
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
      denominator += weights[weekday(d)];
    }

    return [{
      date,
      midpoint: (day(date) + day(until) - 1) / 2,
      value: nominal.get(date) / (prices.get(date) / 100) / denominator,
    }];
  });

  const daily = date => {
    const x = day(date);
    const i = points.findIndex(p => p.midpoint >= x);

    if (i < 0 || (i === 0 && points[0].midpoint !== x)) return null;
    if (points[i].midpoint === x) return points[i].value;

    const a = points[i - 1];
    const b = points[i];

    // Missing months are unavailable evidence, not interpolation bridges.
    if (day(b.date) - day(a.date) > 31) return null;

    return a.value +
      (b.value - a.value) * (x - a.midpoint) / (b.midpoint - a.midpoint);
  };

  return {
    weights,
    cpi_gap_policy,
    cpi_interpolated: preparedCpi.interpolated,
    weekly(date) {
      const monday = benchmarkWeek(date);
      const values = Array.from(
        { length: 7 },
        (_, i) => daily(shift(monday, i))
      );
      return values.every(positive) ? mean(values) : null;
    },
  };
}

export function alignedBenchmarkRatio(weekly, target, base, alignment = 364) {
  check(
    Array.isArray(base) && base.every(r => positive(r.weight)),
    'Invalid weighted base.'
  );

  const numerator = weekly(shift(target, -alignment));
  const values = base.map(r => ({
    value: weekly(shift(r.business_date, -alignment)),
    weight: r.weight,
  }));

  if (
    !positive(numerator) ||
    !values.length ||
    values.some(r => !positive(r.value))
  ) {
    return { ratio: null, reason: 'missing_or_nonpositive_week' };
  }

  const denominator =
    sum(values.map(r => r.value * r.weight)) /
    sum(values.map(r => r.weight));

  return { ratio: numerator / denominator, numerator, denominator };
}

// The injected transport receives exactly one phrase per request.
export async function readTrendsTerms({
  provider,
  approved,
  state,
  from,
  until,
  fetchTerm,
}) {
  check(
    approved === true &&
      ['official', 'serpapi', 'dataforseo'].includes(provider),
    'An approved Trends provider is required.'
  );
  check(/^US-[A-Z]{2}$/.test(state), 'A U.S. state is required.');

  shift(from, 0);
  shift(until, 0);
  check(from <= until, 'Invalid Trends window.');

  const phrases = Object.values(BENCHMARK_DICTIONARY.categories).flat();
  const pulls = [];

  for (const phrase of phrases) {
    const query = {
      phrase,
      state,
      from,
      until,
      ...BENCHMARK_DICTIONARY.filters,
    };
    const payload = await fetchTerm(query);

    check(Array.isArray(payload), 'Invalid Trends response.');

    const seen = new Set();

    for (const row of payload) {
      check(
        benchmarkWeek(row.week_start) === row.week_start &&
          !seen.has(row.week_start) &&
          typeof row.value === 'number' &&
          Number.isFinite(row.value) &&
          row.value >= 0,
        'Invalid Trends week.'
      );
      seen.add(row.week_start);
    }

    pulls.push({
      query,
      provider,
      dictionary_version: 1,
      payload,
      digest: digest(payload),
    });
  }

  return projectionDeepFreeze(pulls);
}

export function trendsRatio({
  style,
  state,
  target,
  base,
  pulls = [],
  minimumTerms,
  alignment = 364,
  targetDates = [target],
}) {
  check(
    Object.hasOwn(BENCHMARK_DICTIONARY.categories, style),
    'Unknown style category.'
  );
  check(
    Number.isInteger(minimumTerms) && minimumTerms >= 2,
    'At least two usable terms are required.'
  );

  if (style === 'Neutral') {
    return {
      ratio: 1,
      reason: 'deliberate_neutral_category',
      terms: [],
    };
  }

  check(
    Array.isArray(targetDates) &&
      targetDates.length > 0 &&
      targetDates.includes(target),
    'The target window is required.'
  );

  const terms = BENCHMARK_DICTIONARY.categories[style].map(phrase => {
    const matches = pulls.filter(
      p => p.query.phrase === phrase && p.query.state === state
    );

    check(matches.length <= 1, 'Multiple pulls for one term and state.');

    const pull = matches[0];
    if (!pull) {
      return { phrase, ratio: null, reason: 'provider_not_available' };
    }

    check(
      pull.dictionary_version === 1 &&
        digest(pull.payload) === pull.digest &&
        Object.entries(BENCHMARK_DICTIONARY.filters).every(
          ([key, value]) => pull.query[key] === value
        ),
      'Trends pull identity changed.'
    );
    check(
      new Set(pull.payload.map(row => row.week_start)).size ===
        pull.payload.length,
      'Duplicate Trends weeks.'
    );

    const weeks = new Map(
      pull.payload.map(row => [row.week_start, row.value])
    );
    const targetWeeks = [
      ...new Set(
        targetDates.map(date => benchmarkWeek(shift(date, -alignment)))
      ),
    ].map(date => weeks.get(date));

    const result = alignedBenchmarkRatio(
      date => weeks.get(benchmarkWeek(date)),
      target,
      base,
      alignment
    );

    if (targetWeeks.some(value => !positive(value))) {
      return {
        phrase,
        ratio: null,
        reason: 'missing_or_nonpositive_target_week',
      };
    }

    if (result.ratio !== null) {
      result.numerator = mean(targetWeeks);
      result.ratio = result.numerator / result.denominator;
    }

    return { phrase, ...result, pull_digest: pull.digest };
  });

  const usable = terms.filter(term => positive(term.ratio));

  return {
    ratio: usable.length >= minimumTerms
      ? Math.exp(mean(usable.map(term => Math.log(term.ratio))))
      : 1,
    reason: usable.length >= minimumTerms
      ? 'usable_terms'
      : 'insufficient_usable_terms',
    terms,
  };
}

export function selectBenchmarkSource({
  own,
  pooled,
  proxy,
  publicEnabled,
  strength,
  min,
  max,
}) {
  const source = own !== null
    ? 'own_ly'
    : positive(pooled?.ratio)
      ? 'pooled'
      : !publicEnabled
        ? 'recent_only'
        : positive(proxy?.ratio)
          ? 'public_proxy'
          : proxy?.reason === 'no_approved_version'
            ? 'neutral_benchmark'
            : 'recent_only';

  const raw = source === 'own_ly'
    ? own
    : source === 'pooled'
      ? pooled.ratio
      : source === 'public_proxy'
        ? 1 + strength * (proxy.ratio - 1)
        : source === 'neutral_benchmark' ? 1 : null;

  return {
    source,
    raw_ratio: raw,
    S: raw === null ? null : Math.max(min, Math.min(max, raw)),
    evidence: source === 'pooled'
      ? pooled
      : source === 'public_proxy' ? proxy : null,
  };
}

// Forecast traces contain aggregate ratios, never participant identities.
export function buildBenchmarkSnapshot({
  context,
  volume,
  shares,
  settings,
  asOf,
  restaurantId,
  snapshotAt,
}) {
  check(
    context.restaurant_id === restaurantId && context.as_of === asOf,
    'Benchmark context crosses restaurants or dates.'
  );

  const released = context.release;

  if (released) {
    check(
      projectionInstant(released.published_at) <= projectionInstant(snapshotAt) &&
        projectionInstant(released.created_at) <= projectionInstant(snapshotAt) &&
        released.dictionary_digest === digest(BENCHMARK_DICTIONARY),
      'Benchmark release is unavailable at the snapshot.'
    );
  }

  const levels = Object.fromEntries(
    volume.nights
      .filter(n => n.recent)
      .map(n => [weekday(n.business_date), n.recent.L])
  );

  let curve = null;
  let reason = released ? null : 'no_approved_version';

  if (released) {
    try {
      curve = censusCurve({
        ...released.census,
        weekdayLevels: levels,
        closedWeekdays: context.closed_weekdays,
      });
    } catch (error) {
      if (error.code !== 'PROJECTION_BENCHMARK_INVALID') throw error;
      reason = error.message === 'Open weekdays need positive fitted levels.'
        ? 'weekday_levels_unavailable'
        : 'invalid_census_observations';
    }
  }

  const values = volume.nights.map((night, i) => {
    const base = night.recent?.nights ?? [];
    const census = curve
      ? alignedBenchmarkRatio(
          curve.weekly,
          night.business_date,
          base,
          settings.year_alignment_days
        )
      : { ratio: null, reason };

    const categories = shares.nights[i].categories.map(category => {
      const weighted = category.trace.base_dates.map(date => ({
        business_date: date,
        weight: 0.5 ** (
          (day(category.trace.base_until) - day(date)) /
          (7 * settings.share_half_life_weeks)
        ),
      }));

      return {
        style: category.style_category,
        trends: trendsRatio({
          style: category.style_category,
          state: context.state,
          target: night.business_date,
          base: weighted,
          pulls: [],
          minimumTerms: settings.minimum_trends_terms,
        }),
        pooled: context.pooled?.find(
          p => p.target_date === night.business_date &&
            p.metric === `category:${category.style_category}`
        ) ?? null,
      };
    });

    return {
      target_date: night.business_date,
      census,
      base_digest: digest(base.map(row => [row.business_date, row.weight])),
      categories,
      pooled: context.pooled?.find(
        p => p.target_date === night.business_date && p.metric === 'volume'
      ) ?? null,
    };
  });

  const result = {
    restaurant_id: restaurantId,
    as_of: asOf,
    settings_digest: volume.provenance.settings_digest,
    release_id: released?.id ?? null,
    state: context.state,
    closed_weekdays: context.closed_weekdays,
    status: context.status,
    weekday_weights: curve?.weights ?? null,
    ...(released?.census?.cpi_gap_policy ? {
      cpi_gap_policy: released.census.cpi_gap_policy,
      cpi_interpolated: curve?.cpi_interpolated ?? released.census.cpi_interpolated ?? [],
    } : {}),
    values,
    launch: context.pooled?.filter(p => p.metric.startsWith('launch:')) ?? [],
  };

  return projectionDeepFreeze({ ...result, digest: digest(result) });
}

export function verifyBenchmarkSnapshot(
  snapshot,
  restaurantId,
  asOf,
  settingsDigest
) {
  const { digest: hash, ...body } = snapshot;

  check(
    snapshot.restaurant_id === restaurantId &&
      snapshot.as_of === asOf &&
      snapshot.settings_digest === settingsDigest &&
      hash === digest(body),
    'Invalid benchmark snapshot.'
  );

  return snapshot;
}

// Each monthly contribution is one restaurant's ratio, not its sales level.
export function benchmarkContributions(raw, plan, start, count = 63) {
  const settings = plan.settings_snapshot;
  const restaurantId = raw.restaurant_id;

  const eligible = raw.lifecycle.history.filter(n =>
    projectionVolumeEligibility(n, {
      restaurantId,
      asOf: raw.as_of,
    }).eligible
  );

  const byDate = new Map(eligible.map(n => [n.business_date, n]));
  const facts = raw.lifecycle.dish_facts;
  const styleByDish = new Map(
    raw.lifecycle.dishes.map(d => [d.id, d.style_category])
  );
  const output = [];

  for (let i = 0; i < count; i++) {
    const target = shift(start, i);
    const reference = plan.nights.find(
      n => weekday(n.business_date) === weekday(target)
    );
    const base = reference.trace.volume.recent?.nights ?? [];

    const lyBase = base.map(n => ({
      night: byDate.get(
        shift(n.business_date, -settings.year_alignment_days)
      ),
      weight: n.weight,
    }));

    const targetRows = [-7, 0, 7]
      .map(offset =>
        byDate.get(shift(target, offset - settings.year_alignment_days))
      )
      .filter(Boolean);

    const denominator = lyBase.length && lyBase.every(row => row.night)
      ? sum(lyBase.map(row => row.night.total_units * row.weight)) /
        sum(lyBase.map(row => row.weight))
      : 0;

    if (denominator > 0 && targetRows.length) {
      output.push({
        target_date: target,
        metric: 'volume',
        ratio: mean(targetRows.map(n => n.total_units)) / denominator,
      });
    }

    const monday = benchmarkWeek(
      shift(target, -settings.year_alignment_days)
    );
    const categoryNights = eligible.filter(
      n => n.business_date >= shift(monday, -7) &&
        n.business_date <= shift(monday, 13)
    );

    for (const category of reference.trace.categories) {
      if (category.status !== 'ok') continue;

      const dates = new Set(categoryNights.map(n => n.business_date));
      const total = sum(categoryNights.map(n => n.total_units));
      const units = sum(
        facts
          .filter(
            fact => dates.has(fact.business_date) &&
              styleByDish.get(fact.dish_id) === category.style_category
          )
          .map(fact => fact.units)
      );

      if (category.ly_base_share > 0 && total > 0 && units >= 0) {
        output.push({
          target_date: target,
          metric: `category:${category.style_category}`,
          ratio: units / total / category.ly_base_share,
        });
      }
    }

    for (const style of Object.keys(BENCHMARK_DICTIONARY.categories)) {
      const ids = new Set(
        reference.dishes.find(d => d.trace.style_category === style)
          ?.trace.baseline?.trace.own_launch_ids ?? []
      );
      const launches = raw.lifecycle.launch_history.filter(
        launch => ids.has(launch.id)
      );

      if (launches.length) {
        output.push({
          target_date: target,
          metric: `launch:${style}`,
          ratio: mean(launches.map(launch => launch.launch_index)),
        });
      }
    }
  }

  return output;
}