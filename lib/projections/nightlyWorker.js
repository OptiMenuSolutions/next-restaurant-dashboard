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
  const monotonic = dependencies.monotonic ?? (() => performance.now());
  const started = monotonic();
  const budget = dependencies.budgetMs ?? 180000;

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
  const done = new Map(Object.entries(job.work_state?.source_done ?? {}));
  const quiet = new Map(Object.entries(job.work_state?.quiet ?? {}));
  const failures = new Map();
  const attempted = new Map();
  const fallbackAt = Date.parse(timing.deadline_at) - 30 * 60000;

  let stage = 'ingestion';

  const state = () => ({
    source_done: Object.fromEntries(done),
    quiet: Object.fromEntries(quiet),
  });

  const checkpoint = (name, extra = {}) => projectionRPC(db, 'projection_checkpoint', {
    ...args,
    stage_name: name,
    work_state: state(),
    ...extra,
  });

  const yieldIfDue = async () => {
    if (monotonic() - started < budget) return;

    const retry_at = new Date(Date.parse(now()) + 15000).toISOString();
    await checkpoint('budget', { retry_at });

    throw Object.assign(new Error('Invocation checkpointed'), {
      yielded: true,
      retry_at,
    });
  };

  try {
    async function ingest(work) {
      if (!Array.isArray(work.dates)) {
        throw projectionJobError('PROJECTION_WORK_INVALID', 'Missing ingestion work.');
      }

      for (const item of work.dates) {
        const day = item.business_date;
        const generation = item.generation ?? null;

        if (
          !item.covered ||
          (done.has(day) && done.get(day) === generation) ||
          (attempted.has(day) && attempted.get(day) === generation)
        ) continue;

        if (Date.parse(quiet.get(day)) > Date.parse(now())) continue;

        await yieldIfDue();
        attempted.set(day, generation);

        try {
          const result = await api.ingestProjectionNight(db, {
            restaurantId: job.restaurant_id,
            businessDate: day,
            readSource: ctx => readSource({
              ...ctx,
              signal: AbortSignal.timeout(
                Math.max(1, Math.ceil(budget - (monotonic() - started)))
              ),
            }),
          });

          if (result.recheck_failed) {
            throw projectionJobError(
              'PROJECTION_SOURCE_UNAVAILABLE',
              'A source recheck failed.',
              'source'
            );
          }

          await projectionRPC(db, 'projection_refresh_treatments', { ...args, day });

          const ack = await projectionRPC(db, 'projection_ack_night', {
            ...args,
            day,
            generation,
          });

          failures.delete(day);

          if (Date.parse(ack.quiet_ready_at) > Date.parse(ack.last_observed_at)) {
            quiet.set(day, ack.quiet_ready_at);
            done.delete(day);
          } else {
            quiet.delete(day);
            done.set(day, null);
          }
        } catch (e) {
          const code = /^PROJECTION_[A-Z_]+$/.test(e.code || '')
            ? e.code
            : /^PROJECTION_[A-Z_]+$/.test(e.message || '')
              ? e.message
              : 'PROJECTION_JOB_FAILED';

          const kind = e.kind || (
            /TIMEZONE|SETUP|CALENDAR/.test(code) ? 'setup'
              : /SOURCE|PROVIDER/.test(code) ? 'source'
                : 'technical'
          );

          failures.set(day, { date: day, code, kind });

          if (job.job_kind === 'backfill' || kind !== 'source') {
            throw projectionJobError(code, e.message, kind);
          }
        }

        await checkpoint(stage);
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

      const wait = [...quiet.values()].sort(
        (a, b) => Date.parse(b) - Date.parse(a)
      )[0];

      if (b.phase === 'verify' && wait) {
        await checkpoint('backfill_quiet', { retry_at: wait });
        return { again: true, retry_at: wait, attempt: job.attempts };
      }

      const next = shiftProjectionDate(last, 1);
      const end = next > b.backfill_until;
      const phase = end ? b.phase === 'observe' ? 'verify' : 'complete' : b.phase;

      if (end && phase === 'verify') {
        done.clear();
        quiet.clear();
      }

      await checkpoint('backfill', {
        progress: {
          cursor_date: end && phase === 'verify' ? b.backfill_from : next,
          phase,
        },
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
    await yieldIfDue();
    await checkpoint(stage);
    work = await projectionRPC(db, 'projection_work', { ...args, repair: true });
    await ingest(work);

    stage = 'calendar';
    await yieldIfDue();
    await checkpoint(stage);

    const asOf = job.job_kind === 'maintenance'
      ? work.timing.business_date
      : job.business_date;

    const calendar = await api.readProjectionCalendar(db, {
      restaurantId: job.restaurant_id,
      from: work.backfill.backfill_from,
      until: shiftProjectionDate(asOf, 7),
    });

    await api.applyProjectionCalendarFlags(db, calendar);

    await projectionRPC(db, 'projection_ack_calendar', {
      ...args,
      generations: work.calendar_dates ?? [],
    });

    const failed = [...failures.values()];
    const wait = [...quiet.values()].sort(
      (a, b) => Date.parse(b) - Date.parse(a)
    )[0];

    if (job.job_kind === 'maintenance') {
      const more = await db.from('projection_dirty_nights')
        .select('business_date')
        .eq('restaurant_id', job.restaurant_id)
        .limit(1);

      if (more.error || !Array.isArray(more.data)) {
        throw projectionJobError('PROJECTION_DATABASE_FAILED', 'Dirty-night read failed.');
      }

      const again = more.data.length > 0 || Boolean(wait);
      const retry_at = failed.length
        ? new Date(Date.parse(now()) + 10 * 60000).toISOString()
        : wait ?? now();

      await checkpoint(stage, {
        done: !again,
        retry_at: again ? retry_at : null,
        problem: failed.length
          ? { code: 'PROJECTION_SOURCE_UNAVAILABLE', kind: 'source', failures: failed }
          : null,
      });

      return { again, retry_at, attempt: job.attempts };
    }

    const latest = shiftProjectionDate(asOf, -1);
    const latestFailure = failures.get(latest);
    const retry = latestFailure
      ? Date.parse(now()) + 10 * 60000
      : Math.max(Date.parse(wait ?? timing.ready_at), Date.parse(timing.ready_at));

    if (latestFailure || retry > Date.parse(now())) {
      if (retry < fallbackAt && Date.parse(now()) < fallbackAt) {
        const retry_at = new Date(retry).toISOString();

        await checkpoint('quiet_period', {
          retry_at,
          problem: latestFailure ?? null,
        });

        return {
          again: true,
          retry_at,
          attempt: job.attempts,
          ...(latestFailure ? { error: latestFailure } : {}),
        };
      }

      await projectionRPC(db, 'projection_fallback', {
        ...args,
        excluded_dates: [...new Set([
          ...(latestFailure ? [latest] : []),
          ...quiet.keys(),
        ])],
      });
    }

    const context = () => ({
      restaurantId: job.restaurant_id,
      asOf,
      snapshotAt: now(),
    });

    stage = 'outliers';
    await yieldIfDue();
    await checkpoint(stage);
    await api.storeProjectionOutliers(db, await api.readProjectionOutliers(db, context()));

    stage = 'holiday_learning';
    await yieldIfDue();
    await checkpoint(stage);
    const holiday = await api.readProjectionHolidays(db, context());
    await api.storeProjectionHolidays(db, holiday.learning);

    stage = 'lifecycle';
    await yieldIfDue();
    await checkpoint(stage);
    await api.storeProjectionLaunches(db, await api.readProjectionLifecycle(db, context()));

    stage = 'snapshot';
    await yieldIfDue();
    await checkpoint(stage);
    const raw = await projectionRPC(db, 'projection_snapshot', args);

    stage = 'forecast';
    await yieldIfDue();
    await checkpoint(stage);
    const plan = api.buildProjectionRun(raw);
    plan.trace.source_failures = failed;

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
    if (e.yielded) {
      return {
        again: true,
        retry_at: e.retry_at,
        attempt: job.attempts,
        stage: 'budget',
      };
    }

    dependencies.onError?.(e);

    const retry_at = new Date(Date.parse(now()) + 10 * 60000).toISOString();
    const code = /^PROJECTION_[A-Z_]+$/.test(e.code || '') ? e.code : 'PROJECTION_JOB_FAILED';
    const kind = e.kind || 'technical';

    try {
      await checkpoint(stage, { retry_at, problem: { code, kind } });
    } catch (lost) {
      if (['PT409', 'PROJECTION_LEASE_CONFLICT'].includes(lost.code)) {
        return { skip: true, status: 'lease_lost' };
      }
      throw lost;
    }

    return {
      again: true,
      retry_at,
      attempt: job.attempts,
      error: { code, kind },
      stage,
    };
  }
}