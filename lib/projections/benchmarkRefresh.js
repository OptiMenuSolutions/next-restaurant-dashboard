import { buildProjectionRun } from './nightlyPlan.js';
import { resolveProjectionSettings } from './settings.js';
import {
  censusCurve,
  alignedBenchmarkRatio,
  benchmarkWeek,
  benchmarkContributions,
  BENCHMARK_DICTIONARY,
} from './benchmarks.js';
import { fetchFredBenchmark } from './fredBenchmarks.js';
import { shiftProjectionDate as shift } from './businessTime.js';
import { projectionISOWeekday as weekday } from './eligibility.js';
import { projectionVolumeDigest as digest } from './volumeProvenance.js';
import { projectionRPC } from './nightlyWorker.js';

export async function refreshProjectionBenchmarks(
  db,
  { snapshotAt, apiKey, fetchImpl, force = false } = {}
) {
  const vintage = new Date(snapshotAt).toISOString().slice(0, 10);
  const catalog = await projectionRPC(db, 'projection_benchmark_catalog');

  if (
    !force &&
    catalog.versions.some(
      version => version.vintage.slice(0, 7) === vintage.slice(0, 7)
    )
  ) {
    return { status: 'already_staged' };
  }

  const pulls = [];

  for (const series of ['MRTSSM722USN', 'CUUR0000SEFV']) {
    pulls.push(await fetchFredBenchmark(series, {
      snapshotAt,
      apiKey,
      fetchImpl,
    }));
  }

  const start = benchmarkWeek(vintage);
  const restaurants = [];

  for (const restaurant of catalog.restaurants) {
    let raw;
    let result;

    try {
      raw = await projectionRPC(db, 'projection_benchmark_inputs', {
        rid: restaurant.id,
        at_time: snapshotAt,
      });

      if (raw.backfill?.complete !== true) {
        throw Object.assign(new Error('BACKFILL_PENDING'), {
          code: 'BACKFILL_PENDING',
        });
      }

      // Candidate ratios use the actual baseline before benchmark selection.
      const { benchmarks, ...reference } = raw;
      const plan = buildProjectionRun(reference);

      const settings = resolveProjectionSettings({
        restaurantId: raw.restaurant_id,
        at: snapshotAt,
        globalVersion: raw.holiday.global_version,
        restaurantVersion: raw.holiday.restaurant_version,
      }).settings;

      const levels = Object.fromEntries(
        plan.nights
          .filter(n => n.trace.volume.recent)
          .map(n => [weekday(n.business_date), n.trace.volume.recent.L])
      );

      const curve = censusCurve({
        sales: pulls[0].normalized,
        cpi: pulls[1].normalized,
        weekdayLevels: levels,
        closedWeekdays: benchmarks.closed_weekdays,
      });

      const weeks = Array.from({ length: 8 }, (_, i) => {
        const monday = shift(start, 7 * i);
        const days = Array.from({ length: 7 }, (_, j) => {
          const target = shift(monday, j);
          const ref = plan.nights.find(
            n => weekday(n.business_date) === weekday(target)
          );

          if (benchmarks.closed_weekdays.includes(weekday(target))) {
            return {
              target_date: target,
              ratio: 1,
              capped_S: 1,
              applies: false,
              reason: 'closed_weekday',
              base: [],
            };
          }

          const base = ref.trace.volume.recent?.nights ?? [];
          const ratio = alignedBenchmarkRatio(
            curve.weekly,
            target,
            base,
            settings.year_alignment_days
          );

          return {
            target_date: target,
            ...ratio,
            capped_S: ratio.ratio === null
              ? null
              : Math.max(
                  settings.seasonal_ratio_min,
                  Math.min(
                    settings.seasonal_ratio_max,
                    1 + settings.census_strength * (ratio.ratio - 1)
                  )
                ),
            applies: ref.trace.volume.recent !== null,
            base: base.map(n => ({
              business_date: n.business_date,
              weight: n.weight,
            })),
          };
        });

        if (days.some(d => d.ratio === null)) {
          throw new Error('Missing candidate Census week.');
        }

        return { week_start: monday, days };
      });

      result = {
        id: restaurant.id,
        as_of: raw.as_of,
        source_digest: raw.context_digest,
        preview: {
          status: 'ok',
          weekday_weights: curve.weights,
          weeks,
        },
        contributions:
          /^[A-Z]{2}$/.test(restaurant.state || '') &&
          restaurant.concept_type
            ? benchmarkContributions(raw, plan, start)
            : [],
      };
    } catch (error) {
      const setup = [
        'PROJECTION_CALENDAR_SETUP_REQUIRED',
        'PROJECTION_TIMEZONE_REQUIRED',
        'PROJECTION_TIMEZONE_INVALID',
        'BACKFILL_PENDING',
      ].includes(error.code) || [
        'Open weekdays need positive fitted levels.',
        'PROJECTION_SETUP_REQUIRED',
        'Configure the restaurant timezone before running date-based calculations.',
      ].includes(error.message);

      if (!setup) throw error;

      result = {
        id: restaurant.id,
        as_of: raw?.as_of ?? start,
        source_digest: null,
        preview: {
          status: 'unavailable',
          reason: error.code || 'BASELINE_OR_SETUP_REQUIRED',
          weeks: [],
        },
        contributions: [],
      };
    }

    restaurants.push(result);
  }

  const { id } = await projectionRPC(db, 'projection_stage_benchmark', {
    doc: {
      snapshot_at: snapshotAt,
      vintage,
      valid_from: start,
      dictionary: BENCHMARK_DICTIONARY,
      dictionary_digest: digest(BENCHMARK_DICTIONARY),
      pulls: pulls.map(({ normalized, ...pull }) => pull),
      restaurants,
    },
  });

  const preview = await projectionRPC(db, 'projection_benchmark_preview', {
    vid: id,
  });

  if (
    !force &&
    catalog.versions.some(version => version.published_at) &&
    restaurants.some(restaurant => restaurant.preview.status === 'ok')
  ) {
    await projectionRPC(db, 'projection_approve_benchmark', {
      vid: id,
      expected_digest: preview.digest,
      actor: null,
    });

    return { status: 'published', id };
  }

  return { status: 'awaiting_admin_review', id };
}