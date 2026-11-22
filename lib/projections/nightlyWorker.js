import { ingestProjectionNight } from './ingestion.js';
import { readProjectionCalendar, applyProjectionCalendarFlags } from './calendarStore.js';
import { readProjectionOutliers, storeProjectionOutliers } from './outlierStore.js';
import { readProjectionHolidays, storeProjectionHolidays } from './holidayStore.js';
import { readProjectionLifecycle, storeProjectionLaunches } from './lifecycleStore.js';
import { shiftProjectionDate } from './businessTime.js';
import { buildProjectionRun } from './nightlyPlan.js';
import { projectionJobError } from './nightlySource.js';

export async function projectionRPC(db, name, args = {}) {
  const result = await db.rpc(name, args);

  if (
    !result || result.error || !result.data ||
    typeof result.data !== 'object' || Array.isArray(result.data)
  ) {
    const message = result?.error?.message || 'Invalid projection database response.';
    throw projectionJobError(
      /^PROJECTION_[A-Z_]+$/.test(message)
        ? message
        : result?.error?.code || 'PROJECTION_DATABASE_FAILED',
      message
    );
  }

  return result.data;
}

export async function processProjectionJob(db, message, readSource, dependencies = {}) {
  if (
    !message || Object.keys(message).length !== 1 ||
    !/^[0-9a-f-]{36}$/i.test(message.job_id || '')
  ) {
    throw projectionJobError('PROJECTION_JOB_INVALID', 'Queue messages must contain only a job ID.');
  }

  const now = dependencies.now ?? (() => new Date().toISOString());
  const api = {
    ingestProjectionNight,
    readProjectionCalendar,
    applyProjectionCalendarFlags,
    readProjectionOutliers,
    storeProjectionOutliers,
    readProjectionHolidays,
    storeProjectionHolidays,
    readProjectionLifecycle,
    storeProjectionLaunches,
    buildProjectionRun,
    ...dependencies,
  };

  const claimed = await projectionRPC(db, 'projection_claim', { jid: message.job_id });
  if (claimed.skip) return claimed;

  const { job, token, timing } = claimed;
  const args = { jid: job.id, tok: token };
  let stage = 'ingestion';
  let waitUntil = null;

  const checkpoint = (name, extra = {}) => projectionRPC(db, 'projection_checkpoint', {
    ...args,
    stage_name: name,
    ...extra,
  });

  try {
    const seen = new Map();
    const failures = [];

    async function ingest(work, correctionsOnly = false) {
      if (!Array.isArray(work.dates)) {
        throw projectionJobError('PROJECTION_WORK_INVALID', 'Missing ingestion work.');
      }

      for (const item of work.dates) {
        if (
          !item.covered ||
          (
            correctionsOnly && seen.has(item.business_date) &&
            seen.get(item.business_date) === item.generation
          )
        ) continue;

        try {
          const result = await api.ingestProjectionNight(db, {
            restaurantId: job.restaurant_id,
            businessDate: item.business_date,
            readSource,
          });

          seen.set(item.business_date, item.generation);

          if (result.recheck_failed) {
            throw projectionJobError(
              'PROJECTION_SOURCE_UNAVAILABLE',
              'A source recheck failed.',
              'source'
            );
          }

          await projectionRPC(db, 'projection_refresh_treatments', {
            ...args,
            day: item.business_date,
          });

          const ack = await projectionRPC(db, 'projection_ack_night', {
            ...args,
            day: item.business_date,
            generation: item.generation,
          });

          if (Date.parse(ack.quiet_ready_at) > Date.parse(ack.last_observed_at)) {
            waitUntil = !waitUntil || Date.parse(ack.quiet_ready_at) > Date.parse(waitUntil)
              ? ack.quiet_ready_at
              : waitUntil;
          }
        } catch (e) {
          failures.push({
            date: item.business_date,
            code: e.code || 'PROJECTION_SOURCE_UNAVAILABLE',
            kind: e.kind || 'source',
          });

          if (job.job_kind === 'backfill') throw e;
        }
      }
    }

    await checkpoint(stage);
    let work = await projectionRPC(db, 'projection_work', { ...args, repair: false });
    await ingest(work);

    if (job.job_kind === 'backfill') {
      const b = work.backfill;
      const last = work.dates.at(-1)?.business_date;

      if (!last) {
        throw projectionJobError('PROJECTION_BACKFILL_INVALID', 'Backfill cursor is missing.');
      }

      if (b.phase === 'verify' && waitUntil) {
        await checkpoint('backfill_quiet', { retry_at: waitUntil });
        return { again: true, retry_at: waitUntil, attempt: job.attempts };
      }

      const next = shiftProjectionDate(last, 1);
      const end = next > b.backfill_until;
      const phase = end ? b.phase === 'observe' ? 'verify' : 'complete' : b.phase;
      const cursor = end && phase === 'verify' ? b.backfill_from : next;

      await checkpoint('backfill', {
        progress: { cursor_date: cursor, phase },
        done: phase === 'complete',
        retry_at: phase === 'complete' ? null : now(),
      });

      return {
        again: phase !== 'complete',
        retry_at: now(),
        attempt: job.attempts,
        backfill: phase,
      };
    }

    stage = 'repairs';
    await checkpoint(stage);
    work = await projectionRPC(db, 'projection_work', { ...args, repair: true });
    await ingest(work, true);

    stage = 'calendar';
    await checkpoint(stage);
    const asOf = job.job_kind === 'maintenance' ? work.timing.business_date : job.business_date;

    const calendar = await api.readProjectionCalendar(db, {
      restaurantId: job.restaurant_id,
      from: work.backfill.backfill_from,
      until: shiftProjectionDate(asOf, 7),
    });

    await api.applyProjectionCalendarFlags(db, calendar);

    if (job.job_kind === 'maintenance') {
      const hasMore = await db.from('projection_dirty_nights')
        .select('business_date')
        .eq('restaurant_id', job.restaurant_id)
        .limit(1);

      if (hasMore.error || !Array.isArray(hasMore.data)) {
        throw projectionJobError('PROJECTION_DATABASE_FAILED', 'Dirty-night read failed.');
      }

      const again = hasMore.data.length > 0 || waitUntil !== null;
      const retry = failures.length
        ? new Date(Date.parse(now()) + 10 * 60000).toISOString()
        : waitUntil ?? now();

      await checkpoint(stage, {
        done: !again,
        retry_at: again ? retry : null,
        problem: failures.length
          ? { code: 'PROJECTION_SOURCE_UNAVAILABLE', kind: 'source', failures }
          : null,
      });

      return { again, retry_at: retry, attempt: job.attempts };
    }

    const latest = shiftProjectionDate(asOf, -1);
    const failure = failures.find(x => x.date === latest || x.kind === 'setup');

    if (failure) throw projectionJobError(failure.code, failure.code, failure.kind);

    const ready = waitUntil && Date.parse(waitUntil) > Date.parse(timing.ready_at)
      ? waitUntil
      : timing.ready_at;

    if (Date.parse(now()) < Date.parse(ready)) {
      await checkpoint('quiet_period', { retry_at: ready });
      return { again: true, retry_at: ready, attempt: job.attempts };
    }

    const context = () => ({
      restaurantId: job.restaurant_id,
      asOf,
      snapshotAt: now(),
    });

    stage = 'outliers';
    await checkpoint(stage);
    await api.storeProjectionOutliers(db, await api.readProjectionOutliers(db, context()));

    stage = 'holiday_learning';
    await checkpoint(stage);
    const holiday = await api.readProjectionHolidays(db, context());
    await api.storeProjectionHolidays(db, holiday.learning);

    stage = 'lifecycle';
    await checkpoint(stage);
    await api.storeProjectionLaunches(db, await api.readProjectionLifecycle(db, context()));

    stage = 'snapshot';
    await checkpoint(stage);
    const raw = await projectionRPC(db, 'projection_snapshot', args);

    stage = 'forecast';
    await checkpoint(stage);
    const plan = api.buildProjectionRun(raw);
    plan.trace.source_failures = failures;

    stage = 'validate';
    await checkpoint(stage);

    stage = 'publish';
    await checkpoint(stage);

    return await projectionRPC(db, 'projection_publish', {
      ...args,
      snapshot_at: raw.snapshot_at,
      source_digest: raw.context_digest,
      plan,
    });
  } catch (e) {
    dependencies.onError?.(e);

    const retryAt = new Date(Date.parse(now()) + 10 * 60000).toISOString();
    const code = /^PROJECTION_[A-Z_]+$/.test(e.code || '') ? e.code : 'PROJECTION_JOB_FAILED';
    const kind = e.kind || (
      /SOURCE/.test(code) ? 'source'
        : /TIMEZONE|SETUP|CALENDAR/.test(code) ? 'setup'
          : 'technical'
    );

    try {
      await checkpoint(stage, { retry_at: retryAt, problem: { code, kind } });
    } catch (leaseError) {
      if (['PT409', 'PROJECTION_LEASE_CONFLICT'].includes(leaseError.code)) {
        return { skip: true, status: 'lease_lost' };
      }
      throw leaseError;
    }

    return {
      again: true,
      retry_at: retryAt,
      attempt: job.attempts,
      error: { code, kind },
      stage,
    };
  }
}