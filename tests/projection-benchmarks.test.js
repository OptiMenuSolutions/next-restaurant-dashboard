import test from 'node:test';
import assert from 'node:assert/strict';
import {
  censusCurve,
  alignedBenchmarkRatio,
  trendsRatio,
  readTrendsTerms,
  selectBenchmarkSource,
  BENCHMARK_DICTIONARY,
  buildBenchmarkSnapshot,
  verifyBenchmarkSnapshot,
  benchmarkContributions,
} from '../lib/projections/benchmarks.js';
import { fetchFredBenchmark } from '../lib/projections/fredBenchmarks.js';
import {
  PROJECTION_DEFAULTS,
  validateProjectionSettings,
  resolveProjectionSettings,
} from '../lib/projections/settings.js';
import { projectionVolumeDigest as digest } from '../lib/projections/volumeProvenance.js';
import { shiftProjectionDate as shift } from '../lib/projections/businessTime.js';
import { projectRestaurantVolume } from '../lib/projections/volume.js';
import { projectDishShares } from '../lib/projections/shares.js';
import { classifyProjectionOutliers } from '../lib/projections/outliers.js';

const near = (a, b) =>
  assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

const months = [1, 2, 3, 4].map(
  n => `2025-${String(n).padStart(2, '0')}-01`
);
const monthly = value => months.map(date => ({ date, value }));
const levels = { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100 };

const curve = extra => censusCurve({
  sales: monthly(3100),
  cpi: monthly(100),
  weekdayLevels: levels,
  closedWeekdays: [],
  ...extra,
});

const base = [
  { business_date: '2026-01-26', weight: 1 },
  { business_date: '2026-02-02', weight: 2 },
];
const target = '2026-02-16';
const rows = [-7, 0, 7].map(n => ({
  week_start: shift('2025-02-17', n),
  value: 20,
}));

const termPull = (phrase, values = rows) => ({
  query: {
    phrase,
    state: 'US-NJ',
    from: '2024-12-01',
    until: '2025-03-01',
    ...BENCHMARK_DICTIONARY.filters,
  },
  dictionary_version: 1,
  payload: values,
  digest: digest(values),
});

const trendInput = () => ({
  style: 'Comfort/Heavy',
  state: 'US-NJ',
  target,
  base: [{ business_date: '2026-02-09', weight: 1 }],
  minimumTerms: 2,
  pulls: ['soup', 'beef stew'].map(phrase => termPull(
    phrase,
    rows.map(row => ({
      ...row,
      value: row.week_start === '2025-02-10' ? 10 : row.value,
    }))
  )),
});

test('approved dictionary is immutable and Neutral contains no search terms', () => {
  assert.deepEqual(BENCHMARK_DICTIONARY.categories.Neutral, []);
  assert.throws(
    () => BENCHMARK_DICTIONARY.categories['Comfort/Heavy'].push('pizza'),
    TypeError
  );
});

test('real monthly sales remove CPI inflation and use the calendar day denominator', () => {
  const c = curve({ sales: monthly(6200), cpi: monthly(200) });
  const expected = Array.from(
    { length: 7 },
    (_, i) => 100 + (3100 / 28 - 100) * (18 + i) / 29.5
  ).reduce((a, b) => a + b) / 7;
  near(c.weekly('2025-02-05'), expected);
});

test('weekday levels normalize over open weekdays; closed days contribute zero', () => {
  const c = curve({
    weekdayLevels: { ...levels, 5: 200, 6: 300, 7: 9999 },
    closedWeekdays: [7],
  });
  near(Object.values(c.weights).reduce((a, b) => a + b) / 6, 1);
  assert.equal(c.weights[7], 0);
  near(c.weights[6] / c.weights[1], 3);
});

test('missing open-weekday levels and all-closed calendars fail visibly', () => {
  assert.throws(() => curve({ weekdayLevels: { 1: 100 } }), /fitted levels/);
  assert.throws(
    () => curve({ closedWeekdays: [1, 2, 3, 4, 5, 6, 7] }),
    /fitted levels/
  );
});

test('missing months are not silently bridged or extrapolated', () => {
  assert.equal(curve({
    cpi: monthly(100).filter(row => row.date !== '2025-02-01'),
  }).weekly('2025-02-17'), null);
  assert.equal(curve().weekly('2024-12-30'), null);
});

test('duplicate monthly observations are rejected', () => {
  assert.throws(
    () => curve({ sales: [...monthly(3100), monthly(3100)[0]] }),
    /Duplicate/
  );
});

test('aligned ratio uses Monday weeks, 364-day alignment and exact baseline weights', () => {
  const values = new Map([
    ['2025-01-27', 10],
    ['2025-02-03', 20],
    ['2025-02-17', 30],
  ]);
  near(
    alignedBenchmarkRatio(date => values.get(date), target, base).ratio,
    30 / (50 / 3)
  );
});

test('a missing or zero base week is unavailable', () => {
  assert.equal(alignedBenchmarkRatio(() => 0, target, base).ratio, null);
  assert.equal(alignedBenchmarkRatio(() => null, target, base).ratio, null);
});

test('pool ratios are not damped; public proxies are damped; each is clamped', () => {
  const input = {
    own: null,
    pooled: { ratio: 1.2 },
    proxy: { ratio: 1.3 },
    publicEnabled: true,
    strength: 0.5,
    min: 0.75,
    max: 1.33,
  };
  assert.equal(selectBenchmarkSource(input).S, 1.2);
  near(selectBenchmarkSource({ ...input, pooled: null }).S, 1.15);
  assert.equal(
    selectBenchmarkSource({ ...input, pooled: { ratio: 2 } }).S,
    1.33
  );
  assert.equal(selectBenchmarkSource({ ...input, own: 0 }).S, 0.75);
});

test('own LY wins, and disabled public proxies use recent only without a pool', () => {
  assert.equal(selectBenchmarkSource({
    own: 0.9,
    pooled: { ratio: 1.2 },
    publicEnabled: true,
    min: 0.75,
    max: 1.33,
  }).source, 'own_ly');

  assert.equal(selectBenchmarkSource({
    own: null,
    pooled: null,
    publicEnabled: false,
    min: 0.75,
    max: 1.33,
  }).S, null);
});

test('Trends makes one separate request for every phrase with identical geography and filters', async () => {
  const queries = [];
  const pulls = await readTrendsTerms({
    provider: 'official',
    approved: true,
    state: 'US-NJ',
    from: '2024-12-01',
    until: '2025-03-01',
    fetchTerm: async query => {
      queries.push(query);
      return rows;
    },
  });
  assert.equal(queries.length, 8);
  assert.equal(new Set(queries.map(query => query.phrase)).size, 8);
  assert.ok(queries.every(
    query => query.state === 'US-NJ' &&
      typeof query.phrase === 'string' &&
      !query.terms
  ));
  assert.equal(pulls.length, 8);
});

test('unapproved providers and duplicate response weeks are rejected', async () => {
  await assert.rejects(
    readTrendsTerms({ provider: 'scraper', approved: true }),
    /approved/
  );
  await assert.rejects(readTrendsTerms({
    provider: 'official',
    approved: true,
    state: 'US-NJ',
    from: '2025-01-01',
    until: '2025-03-01',
    fetchTerm: async () => [rows[0], rows[0]],
  }), /Invalid Trends week/);
});

test('two usable Trends terms combine geometrically', () => {
  const input = trendInput();
  input.pulls[1] = termPull('beef stew', input.pulls[1].payload.map(row => ({
    ...row,
    value: row.week_start === '2025-02-10' ? 10 : 45,
  })));
  near(trendsRatio(input).ratio, Math.sqrt(2 * 4.5));
});

test('any zero in a term target window disqualifies that term', () => {
  const input = trendInput();
  input.pulls[0] = termPull('soup', input.pulls[0].payload.map(row => ({
    ...row,
    value: row.week_start === '2025-02-17' ? 0 : row.value,
  })));
  const output = trendsRatio(input);
  assert.equal(output.ratio, 1);
  assert.equal(output.reason, 'insufficient_usable_terms');
  assert.ok(output.terms[0].reason.includes('nonpositive'));
});

test('a missing base week disqualifies the term and cannot be omitted from the denominator', () => {
  const input = trendInput();
  input.base.push({ business_date: '2026-02-02', weight: 0.5 });
  const output = trendsRatio(input);
  assert.equal(output.ratio, 1);
  assert.equal(output.reason, 'insufficient_usable_terms');
});

test('Neutral is a deliberate traced 1.0, even without a provider', () => {
  assert.deepEqual(
    trendsRatio({ ...trendInput(), style: 'Neutral', pulls: [] }),
    { ratio: 1, reason: 'deliberate_neutral_category', terms: [] }
  );
});

test('dictionary or filter changes invalidate a pinned pull', () => {
  const input = trendInput();
  input.pulls[0].query.property = 'youtube';
  assert.throws(() => trendsRatio(input), /identity changed/);
});

test('new settings are versioned, bounded, and optional in historical versions', () => {
  const old = { ...PROJECTION_DEFAULTS };
  delete old.minimum_benchmark_history_weeks;
  delete old.minimum_trends_terms;
  assert.equal(validateProjectionSettings(old).minimum_trends_terms, undefined);
  assert.throws(() => validateProjectionSettings({
    ...PROJECTION_DEFAULTS, minimum_trends_terms: 1,
  }));
  assert.throws(() => validateProjectionSettings({
    ...PROJECTION_DEFAULTS, minimum_benchmark_history_weeks: 7,
  }));
});

const fredBody = (offset, count, values) => ({
  ok: true,
  json: async () => ({
    offset,
    count,
    observations: values.map(([date, value]) => ({
      date,
      value,
      realtime_start: '2026-11-22',
      realtime_end: '2026-11-22',
    })),
  }),
});

test('FRED reads short pages completely, pins vintage, and never stores the API key', async () => {
  const urls = [];
  const result = await fetchFredBenchmark('MRTSSM722USN', {
    apiKey: 'never-store-me',
    snapshotAt: '2026-11-22T12:00:00Z',
    fetchImpl: async url => {
      urls.push(url);
      const offset = Number(url.searchParams.get('offset'));
      return fredBody(offset, 2, [[`2025-0${offset + 1}-01`, '100']]);
    },
  });
  assert.equal(urls.length, 2);
  assert.equal(result.normalized.length, 2);
  assert.equal(result.query_metadata.realtime_start, '2026-11-22');
  assert.ok(!JSON.stringify(result).includes('never-store-me'));
});

test('FRED empty later pages, invalid responses, changed totals and future vintages fail', async () => {
  for (const mode of ['empty', 'invalid', 'changed', 'future']) {
    let calls = 0;
    await assert.rejects(fetchFredBenchmark('CUUR0000SEFV', {
      apiKey: 'secret',
      snapshotAt: '2026-11-22T12:00:00Z',
      fetchImpl: async () => {
        calls++;
        if (mode === 'future') return {
          ok: true,
          json: async () => ({
            offset: 0,
            count: 1,
            observations: [{
              date: '2025-01-01',
              value: '100',
              realtime_start: '2026-11-23',
              realtime_end: '2026-11-23',
            }],
          }),
        };
        if (mode === 'invalid') return { ok: true, json: async () => ({}) };
        return calls === 1
          ? fredBody(0, 2, [['2025-01-01', '100']])
          : fredBody(1, mode === 'changed' ? 3 : 2, []);
      },
    }));
  }
});

test('provider failures never expose request URLs or keys in errors', async () => {
  await assert.rejects(fetchFredBenchmark('MRTSSM722USN', {
    apiKey: 'secret',
    snapshotAt: '2026-11-22T12:00:00Z',
    fetchImpl: async () => {
      throw Error('https://example?api_key=secret');
    },
  }), error => !error.message.includes('secret'));
});

test('benchmark snapshots reject wrong tenants, future publications and modified evidence', () => {
  const input = {
    context: {
      restaurant_id: 'a',
      as_of: target,
      release: {
        created_at: '2026-02-01T00:00:00Z',
        published_at: '2026-02-20T00:00:00Z',
        dictionary_digest: digest(BENCHMARK_DICTIONARY),
      },
    },
    restaurantId: 'b',
    asOf: target,
    snapshotAt: '2026-02-16T00:00:00Z',
  };
  assert.throws(() => buildBenchmarkSnapshot(input), /crosses/);
  assert.throws(
    () => buildBenchmarkSnapshot({ ...input, restaurantId: 'a' }),
    /unavailable/
  );
  assert.throws(() => verifyBenchmarkSnapshot({
    restaurant_id: 'a', as_of: target, settings_digest: 's', digest: 'bad',
  }, 'a', target, 's'), /Invalid/);
});

const rid = '10000000-0000-4000-8000-000000000001';
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function integrationInput(overrides = {}) {
  const asOf = '2026-02-16';
  const snapshotAt = '2026-02-16T06:00:00Z';
  const resolvedSettings = resolveProjectionSettings({
    restaurantId: rid,
    at: snapshotAt,
    globalVersion: {
      id: uuid(99),
      restaurant_id: null,
      model_major: 4,
      effective_at: '2020-01-01T00:00:00Z',
      settings: { ...PROJECTION_DEFAULTS, ...overrides },
    },
  });
  const styles = Object.keys(BENCHMARK_DICTIONARY.categories);
  const history = Array.from({ length: 70 }, (_, i) => ({
    restaurant_id: rid,
    business_date: shift(asOf, i - 70),
    total_units: 100,
    complete: true,
    source_covered: true,
    closed: false,
    early_close: false,
    holiday_keys: [],
    outlier_status: 'kept',
    source_revision: `r${i}`,
  }));
  const calendar = Array.from({ length: 8 }, (_, i) => ({
    restaurant_id: rid,
    business_date: shift(asOf, i),
    closed: false,
    early_close: false,
    holiday_keys: [],
    default_factor: 1,
    configuration_revision: 1,
    context_digest: 'a'.repeat(64),
  }));
  const dishes = styles.map((style, i) => ({
    id: uuid(i + 10),
    restaurant_id: rid,
    style_category: style,
    forecastable: true,
    is_new: false,
    is_returning: false,
    launch_date: '2020-01-01',
  }));
  const dishFacts = history.flatMap(n => dishes.map((dish, i) => ({
    restaurant_id: rid,
    dish_id: dish.id,
    business_date: n.business_date,
    units: i === 0 ? 40 : 30,
    recommended: false,
    sold_out: false,
    source_revision: n.source_revision,
  })));
  return {
    restaurantId: rid, asOf, snapshotAt,
    firstDataDate: history[0].business_date,
    resolvedSettings, history, calendar, dishes, dishFacts,
    modelVersion: {
      model_major: 4,
      logic_revision: 'approved-workbook-v4',
      reference_sha256: 'a'.repeat(64),
      released_at: '2020-01-01T00:00:00Z',
    },
    styleCategories: styles,
    launchHistory: [],
  };
}

function integrationSnapshot(input, contextExtra = {}) {
  const volume = projectRestaurantVolume(input);
  const shares = projectDishShares({ ...input, volume });
  const sales = Array.from({ length: 10 }, (_, i) => {
    const date = new Date(Date.UTC(2024, 9 + i, 1));
    const end = new Date(Date.UTC(2024, 10 + i, 1));
    return {
      date: date.toISOString().slice(0, 10),
      value: (end - date) / 86400000 * (100 + i * 5),
    };
  });
  const context = {
    restaurant_id: rid,
    as_of: input.asOf,
    state: 'US-NJ',
    closed_weekdays: [],
    pooled: [],
    status: 'current',
    release: {
      id: uuid(88),
      created_at: '2026-02-01T00:00:00Z',
      published_at: '2026-02-02T00:00:00Z',
      dictionary_digest: digest(BENCHMARK_DICTIONARY),
      census: {
        sales,
        cpi: sales.map(row => ({ ...row, value: 100 })),
      },
    },
    ...contextExtra,
  };
  return buildBenchmarkSnapshot({
    context, volume, shares,
    settings: input.resolvedSettings.settings,
    asOf: input.asOf,
    restaurantId: rid,
    snapshotAt: input.snapshotAt,
  });
}

test('Census snapshot is reused by volume and share verification and changes A, not R', () => {
  const input = integrationInput();
  const before = projectRestaurantVolume(input);
  const snapshot = integrationSnapshot(input);
  const volume = projectRestaurantVolume({
    ...input, benchmarkSnapshot: snapshot,
  });
  const shares = projectDishShares({ ...input, volume });
  assert.equal(volume.nights[0].recent.R, before.nights[0].recent.R);
  assert.equal(volume.nights[0].seasonal.source, 'public_proxy');
  near(
    volume.nights[0].seasonal.A,
    100 * (1 + 0.5 * (snapshot.values[0].census.ratio - 1))
  );
  near(
    shares.nights[0].dishes.reduce((n, dish) => n + dish.expected_units, 0),
    volume.nights[0].adjusted_volume
  );
  assert.ok(Object.isFrozen(snapshot.weekday_weights));
});

test('pooling wins over Census and takes full strength in volume and category allocation', () => {
  const input = integrationInput({ pooled_benchmarks_enabled: true });
  const pooled = Array.from({ length: 8 }, (_, i) => [
    {
      target_date: shift(input.asOf, i), metric: 'volume',
      ratio: 1.2, contributors: 5, cohort_level: 'state',
    },
    {
      target_date: shift(input.asOf, i), metric: 'category:Comfort/Heavy',
      ratio: 1.3, contributors: 5, cohort_level: 'national',
    },
  ]).flat();
  const volume = projectRestaurantVolume({
    ...input,
    benchmarkSnapshot: integrationSnapshot(input, { pooled }),
  });
  assert.equal(volume.nights[0].seasonal.S, 1.2);
  const shares = projectDishShares({ ...input, volume });
  assert.equal(
    shares.nights[0].categories.find(
      category => category.style_category === 'Comfort/Heavy'
    ).capped_ratio,
    1.3
  );
});

test('missing approval and short own history remain neutral and never enable candidate values', () => {
  const input = integrationInput();
  const absent = integrationSnapshot(input, {
    release: null, status: 'awaiting_first_approval',
  });
  assert.equal(absent.values[0].census.ratio, null);
  assert.equal(projectRestaurantVolume({
    ...input, benchmarkSnapshot: absent,
  }).nights[0].seasonal.S, 1);

  const short = {
    ...input,
    history: input.history.slice(-35),
    dishFacts: input.dishFacts.filter(
      fact => fact.business_date >= shift(input.asOf, -35)
    ),
  };
  assert.equal(
    integrationSnapshot(short).values[0].census.reason,
    'below_eight_week_minimum'
  );
});

test('a mismatched R baseline is rejected even when the benchmark envelope digest is valid', () => {
  const input = integrationInput();
  const snapshot = structuredClone(integrationSnapshot(input));
  snapshot.values[0].base_digest = 'b'.repeat(64);
  delete snapshot.digest;
  snapshot.digest = digest(snapshot);
  assert.throws(() => projectRestaurantVolume({
    ...input, benchmarkSnapshot: snapshot,
  }), /Benchmark base/);
});

test('a missing middle target week is disqualifying even when both endpoint weeks are positive', () => {
  const input = trendInput();
  input.targetDates = [shift(target, -7), target, shift(target, 7)];
  input.pulls[0] = termPull(
    'soup',
    input.pulls[0].payload.filter(row => row.week_start !== '2025-02-17')
  );
  assert.equal(trendsRatio(input).reason, 'insufficient_usable_terms');
});

test('term scaling cancels within each separate request', () => {
  const input = trendInput();
  const before = trendsRatio(input).ratio;
  input.pulls[0] = termPull(
    'soup',
    input.pulls[0].payload.map(row => ({ ...row, value: row.value * 1000 }))
  );
  near(trendsRatio(input).ratio, before);
});

test('leap-February normalization uses all 29 days before Monday-week interpolation', () => {
  const sales = ['2024-01-01', '2024-02-01', '2024-03-01'].map(
    (date, i) => ({ date, value: [31, 29, 31][i] * 100 })
  );
  const c = censusCurve({
    sales,
    cpi: sales.map(row => ({ ...row, value: 100 })),
    weekdayLevels: levels,
    closedWeekdays: [],
  });
  near(c.weekly('2024-02-29'), 100);
});

function contributionPlan(input) {
  const volume = projectRestaurantVolume(input);
  const shares = projectDishShares({ ...input, volume });
  return {
    settings_snapshot: input.resolvedSettings.settings,
    nights: volume.nights.map((night, i) => ({
      business_date: night.business_date,
      trace: { volume: night, categories: shares.nights[i].categories },
      dishes: shares.nights[i].dishes.map(dish => ({
        trace: structuredClone(dish),
      })),
    })),
  };
}

test('a restaurant contributes one mean launch index before clamping, regardless of its launch count', () => {
  const input = integrationInput();
  const plan = contributionPlan(input);
  plan.nights[0].dishes.find(
    dish => dish.trace.style_category === 'Comfort/Heavy'
  ).trace.baseline.trace.own_launch_ids = [uuid(70), uuid(71)];

  const raw = {
    restaurant_id: rid,
    as_of: input.asOf,
    lifecycle: {
      history: input.history,
      dish_facts: input.dishFacts,
      dishes: input.dishes,
      launch_history: [
        { id: uuid(70), launch_index: 100 },
        { id: uuid(71), launch_index: 0 },
      ],
    },
  };

  assert.deepEqual(benchmarkContributions(raw, plan, input.asOf, 1), [{
    target_date: input.asOf,
    metric: 'launch:Comfort/Heavy',
    ratio: 50,
  }]);
});

test('outlier counterfactuals use the original pinned Census vintage with the run-free R baseline', () => {
  const input = integrationInput();
  const history = input.history.map(n => ({
    ...n,
    total_units:
      n.business_date >= shift(input.asOf, -6) &&
      n.business_date < shift(input.asOf, -3) ? 160 : 100,
  }));
  const sales = Array.from({ length: 10 }, (_, i) => ({
    date: new Date(Date.UTC(2024, 9 + i, 1)).toISOString().slice(0, 10),
    value: 3100 + i * 100,
  }));
  const release = {
    id: uuid(88),
    created_at: '2026-02-01T00:00:00Z',
    published_at: '2026-02-02T00:00:00Z',
    dictionary_digest: digest(BENCHMARK_DICTIONARY),
    census: {
      sales,
      cpi: sales.map(row => ({ ...row, value: 100 })),
    },
  };
  const archives = Array.from({ length: 6 }, (_, i) => {
    const date = shift(input.asOf, i - 6);
    return {
      id: uuid(i + 200),
      restaurant_id: rid,
      run_date: date,
      target_date: date,
      model_major: 4,
      source_through: shift(date, -1),
      issued_at: `${date}T06:00:00Z`,
      supersedes_id: null,
      availability: 'available',
      expected: 100,
      benchmark_context: {
        restaurant_id: rid,
        as_of: date,
        state: 'US-NJ',
        closed_weekdays: [],
        pooled: [],
        status: 'current',
        release,
      },
    };
  });
  const result = classifyProjectionOutliers({
    ...input, history, archives, decisions: [], reviews: [],
  });
  assert.ok(result.candidates.length);
  const cf = result.candidates[0].counterfactuals[0];
  assert.equal(cf.volume.seasonal.source, 'public_proxy');
  assert.equal(cf.volume.recent.L, 100);
  assert.equal(cf.volume.seasonal.benchmark.release_id, release.id);
});

test('zero observed category demand is usable pooled evidence; it is not a missing Trends week', () => {
  const input = integrationInput();
  const ly = input.history.map(n => ({
    ...n,
    business_date: shift(n.business_date, -364),
    source_revision: `ly:${n.source_revision}`,
  }));
  const lyFacts = input.dishFacts.map(fact => ({
    ...fact,
    business_date: shift(fact.business_date, -364),
    source_revision: `ly:${fact.source_revision}`,
  }));

  for (const fact of lyFacts.filter(
    fact => fact.business_date >= '2025-02-10'
  )) {
    fact.units = fact.dish_id === uuid(12) ? 100 : 0;
  }

  input.history = [...ly, ...input.history];
  input.dishFacts = [...lyFacts, ...input.dishFacts];
  input.firstDataDate = ly[0].business_date;

  const rows = benchmarkContributions({
    restaurant_id: rid,
    as_of: input.asOf,
    lifecycle: {
      history: input.history,
      dish_facts: input.dishFacts,
      dishes: input.dishes,
      launch_history: [],
    },
  }, contributionPlan(input), input.asOf, 1);

  assert.equal(
    rows.find(row => row.metric === 'category:Comfort/Heavy').ratio,
    0
  );
});