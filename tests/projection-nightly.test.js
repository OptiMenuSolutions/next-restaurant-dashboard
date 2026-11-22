import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTION_DEFAULTS, validateProjectionSettings } from '../lib/projections/settings.js';
import { projectionConserves, validateProjectionPlan } from '../lib/projections/nightlyPlan.js';
import { canonicalProjectionTimezone, createProjectionSourceReader } from '../lib/projections/nightlySource.js';
import { processProjectionJob, projectionRPC } from '../lib/projections/nightlyWorker.js';
import { createShift4ProjectionReader } from '../lib/pos/providers/shift4.js';

const ID = '10000000-0000-4000-8000-000000000001';
const settings = () => ({ ...PROJECTION_DEFAULTS });

const plan = () => ({
  run_date: '2026-11-22',
  settings_snapshot: settings(),
  nights: Array.from({ length: 8 }, (_, i) => ({
    business_date: `2026-11-${22 + i}`,
    days_ahead: i + 1,
    availability: 'available',
    expected: 30,
    low: 20,
    high: 40,
    confidence: 'own history',
    trace: {
      share_status: 'ok',
      categories: [{ style_category: 'Neutral', status: 'ok' }],
    },
    dishes: [{
      dish_id: ID,
      share: 1,
      expected: 30,
      low: 20,
      high: 40,
      trace: { style_category: 'Neutral', within_category_share: 1 },
    }],
  })),
});

test('publication defaults are explicit, integer, after the buffer and before day end', () => {
  assert.equal(PROJECTION_DEFAULTS.publish_deadline_minutes, 180);

  for (const value of [null, NaN, Infinity, 0, 60, 60.5, 1440]) {
    assert.throws(() => validateProjectionSettings({
      ...settings(),
      publish_deadline_minutes: value,
    }));
  }

  assert.equal(validateProjectionSettings({
    ...settings(),
    publish_deadline_minutes: 61,
  }).publish_deadline_minutes, 61);
});

test('historical settings stay readable without installing a publication default', () => {
  const old = settings();
  delete old.publish_deadline_minutes;
  assert.equal(Object.hasOwn(validateProjectionSettings(old), 'publish_deadline_minutes'), false);
});

test('conservation uses the approved relative tolerance without rounding', () => {
  assert.ok(projectionConserves(1e9, 1e9 + 0.5));
  assert.ok(!projectionConserves(1e9, 1e9 + 2));
  assert.ok(projectionConserves(0, 1e-10));
  assert.ok(!projectionConserves(null, 0));
  assert.equal(validateProjectionPlan(plan()).nights[0].expected, 30);
});

test('invalid ranges, dates, dish duplicates and nonconserving allocations reject', () => {
  for (const mutate of [
    p => p.nights.pop(),
    p => p.nights[0].high = 10,
    p => p.nights[0].business_date = '2026-11-21',
    p => p.nights[0].dishes.push(p.nights[0].dishes[0]),
    p => p.nights[0].dishes[0].expected = 29,
  ]) {
    const p = plan();
    mutate(p);
    assert.throws(() => validateProjectionPlan(p));
  }
});

test('closed and missing baselines retain zero and null respectively', () => {
  const p = plan();
  Object.assign(p.nights[0], { availability: 'closed', expected: 0, low: 0, high: 0 });
  p.nights[0].trace.share_status = 'closed';
  Object.assign(p.nights[0].dishes[0], { expected: 0, low: 0, high: 0 });
  assert.doesNotThrow(() => validateProjectionPlan(p));

  Object.assign(p.nights[1], {
    availability: 'needs_baseline',
    expected: null,
    low: null,
    high: null,
  });
  p.nights[1].trace.share_status = 'needs_baseline';
  Object.assign(p.nights[1].dishes[0], {
    expected: null,
    low: null,
    high: null,
    share: null,
  });
  assert.doesNotThrow(() => validateProjectionPlan(p));
});

test('time zones require explicit valid context and canonical aliases match', () => {
  for (const zone of [null, '', 'invalid/zone']) {
    assert.throws(() => canonicalProjectionTimezone(zone), {
      code: 'PROJECTION_TIMEZONE_REQUIRED',
    });
  }

  assert.equal(
    canonicalProjectionTimezone('US/Eastern'),
    canonicalProjectionTimezone('America/New_York')
  );
});

const context = () => ({
  restaurant_id: ID,
  business_date: '2026-11-22',
  timezone: 'America/New_York',
  window_from: '2026-11-22T09:00:00Z',
  window_to: '2026-11-23T09:00:00Z',
  connections: [{ id: ID, provider: 'shift4' }],
});

function sourceFixture(zone = 'America/New_York', error = null) {
  const calls = [];

  const db = {
    from(table) {
      calls.push(table);
      const b = {
        select() { return b; },
        eq(k, v) { calls.push([k, v]); return b; },
        async single() {
          return {
            data: {
              id: ID,
              restaurant_id: ID,
              shift4_location_id: '1',
              shift4_timezone: 'America/New_York',
            },
            error: null,
          };
        },
      };
      return b;
    },
  };

  const reader = createProjectionSourceReader(db, {
    provider: {
      async listInstalledLocations() {
        if (error) throw error;
        return [{ id: 1, timeZone: zone }];
      },
    },
    async fetchTickets(conn, range) {
      calls.push(range);
      return { tickets: [] };
    },
    now: () => '2026-11-24T12:00:00Z',
  });

  return { reader, calls };
}

test('actual Shift4 zone mismatch is setup failure before reading tickets', async () => {
  const f = sourceFixture('America/Chicago');

  await assert.rejects(() => f.reader(context()), {
    code: 'PROJECTION_TIMEZONE_MISMATCH',
    kind: 'setup',
  });

  assert.equal(f.calls.some(x => x?.from), false);
});

test('source reads are tenant scoped and request D through D+1', async () => {
  const f = sourceFixture();
  const result = await f.reader(context());

  assert.ok(f.calls.some(x =>
    Array.isArray(x) && x[0] === 'restaurant_id' && x[1] === ID
  ));
  assert.deepEqual(f.calls.at(-1), { from: '2026-11-22', to: '2026-11-23' });
  assert.equal(result.sources.length, 1);
});

test('rate limits and token/provider failures are source failures', async () => {
  for (const status of [401, 429, 503]) {
    const f = sourceFixture(undefined, Object.assign(new Error('Provider failed'), { status }));

    await assert.rejects(() => f.reader(context()), {
      code: 'PROJECTION_SOURCE_UNAVAILABLE',
      kind: 'source',
    });
  }
});

const response = value => ({
  ok: true,
  status: 200,
  json: async () => value,
});

function ticketReader(pages) {
  let count = 0;

  return {
    reader: createShift4ProjectionReader({
      clientId: 'test',
      clientSecret: 'test',
      apiBase: 'https://example.test',
      request: async () => {
        const value = pages[count++];
        if (value instanceof Error) throw value;
        return response(value);
      },
    }),
    calls: () => count,
  };
}

test('projection raw reader follows short pages and retains tickets beyond close-date filters', async () => {
  const f = ticketReader([
    { results: [{ posRef: 'a', closedAt: '2026-12-01T00:00:00Z' }], next: '?page=2' },
    { results: [{ posRef: 'b' }] },
  ]);

  const result = await f.reader(
    { shift4_location_id: 1 },
    { from: '2026-11-22', to: '2026-11-23' }
  );

  assert.equal(f.calls(), 2);
  assert.deepEqual(result.tickets.map(t => t.external_ticket_id), ['a', 'b']);
});

test('first/later invalid pages, unsupported cursors and foreign pagination links fail visibly', async () => {
  for (const pages of [
    [{}],
    [{ results: [], next: '?page=2' }, {}],
    [{ results: [], hasMore: true }],
    [{ results: [], next: 'https://other.test/pos/v2/1/tickets' }],
  ]) {
    const f = ticketReader(pages);

    await assert.rejects(() => f.reader(
      { shift4_location_id: 1 },
      { from: '2026-11-22', to: '2026-11-23' }
    ));
  }
});

function workerFixture({ skip = false, fail = false } = {}) {
  const stages = [];

  const db = {
    async rpc(name, args) {
      if (name === 'projection_claim') {
        return {
          data: skip ? { skip: true, status: 'disabled' } : {
            job: {
              id: ID,
              restaurant_id: ID,
              business_date: '2026-11-22',
              job_kind: 'forecast',
            },
            token: ID,
            timing: { ready_at: '2026-11-22T09:00:00Z' },
          },
        };
      }

      if (name === 'projection_checkpoint') {
        stages.push(args.stage_name);
        return { data: {} };
      }

      if (name === 'projection_work') {
        return {
          data: {
            dates: [{ covered: true, business_date: '2026-11-21', generation: 1 }],
            backfill: { backfill_from: '2026-10-01' },
          },
        };
      }

      if (name === 'projection_ack_night') {
        return {
          data: {
            quiet_ready_at: '2026-11-22T09:00:00Z',
            last_observed_at: '2026-11-22T09:00:00Z',
          },
        };
      }

      if (name === 'projection_snapshot') {
        return {
          data: {
            snapshot_at: '2026-11-22T10:00:00Z',
            context_digest: 'digest',
          },
        };
      }

      if (name === 'projection_publish') {
        return { data: { status: 'succeeded', run_id: ID } };
      }

      return { data: {} };
    },
  };

  const pass = async () => ({ learning: {} });

  return {
    db,
    stages,
    deps: {
      now: () => '2026-11-22T10:00:00Z',
      ingestProjectionNight: async () => {
        if (fail) {
          throw Object.assign(new Error('Source failed'), {
            code: 'PROJECTION_SOURCE_UNAVAILABLE',
            kind: 'source',
          });
        }
        return {};
      },
      readProjectionCalendar: pass,
      applyProjectionCalendarFlags: pass,
      readProjectionOutliers: pass,
      storeProjectionOutliers: pass,
      readProjectionHolidays: pass,
      storeProjectionHolidays: pass,
      readProjectionLifecycle: pass,
      storeProjectionLaunches: pass,
      buildProjectionRun: () => ({ trace: {} }),
    },
  };
}

test('worker executes all ten approved stages in order', async () => {
  const f = workerFixture();

  assert.equal(
    (await processProjectionJob(f.db, { job_id: ID }, null, f.deps)).status,
    'succeeded'
  );

  assert.deepEqual(f.stages, [
    'ingestion', 'repairs', 'calendar', 'outliers', 'holiday_learning',
    'lifecycle', 'snapshot', 'forecast', 'validate', 'publish',
  ]);
});

test('disabled claims do no work, and queue payloads accept only the job ID', async () => {
  const f = workerFixture({ skip: true });

  assert.equal(
    (await processProjectionJob(f.db, { job_id: ID }, null, f.deps)).status,
    'disabled'
  );

  assert.deepEqual(f.stages, []);

  await assert.rejects(() => processProjectionJob(
    f.db,
    { job_id: ID, restaurant_id: ID },
    null
  ), { code: 'PROJECTION_JOB_INVALID' });
});

test('source failures remain failed retries rather than empty successful forecasts', async () => {
  const f = workerFixture({ fail: true });
  const r = await processProjectionJob(f.db, { job_id: ID }, null, f.deps);

  assert.equal(r.again, true);
  assert.equal(r.error.kind, 'source');
  assert.equal(f.stages.includes('publish'), false);
});

test('invalid RPC responses fail rather than becoming empty successful work', async () => {
  for (const data of [null, [], 'bad']) {
    await assert.rejects(() => projectionRPC(
      { rpc: async () => ({ data }) },
      'projection_dispatch'
    ));
  }
});

test('partial category availability must be disclosed without losing available volume', () => {
  const p = plan();
  p.nights[0].trace.share_status = 'needs_baseline';
  assert.throws(() => validateProjectionPlan(p));

  p.nights[0].trace.partial_categories = [{
    style_category: 'Neutral',
    status: 'needs_baseline',
  }];
  p.nights[0].confidence = 'own history; partial categories';
  Object.assign(p.nights[0].dishes[0], {
    expected: null,
    low: null,
    high: null,
    share: null,
  });

  assert.equal(validateProjectionPlan(p).nights[0].expected, 30);
});

test('missing allocation trace is rejected', () => {
  const p = plan();
  delete p.nights[0].trace.share_status;
  assert.throws(() => validateProjectionPlan(p));
});

test('quiet-period waits checkpoint and requeue before model stages', async () => {
  const f = workerFixture();
  const original = f.db.rpc;

  f.db.rpc = async (name, args) => name === 'projection_ack_night'
    ? {
      data: {
        quiet_ready_at: '2026-11-22T11:00:00Z',
        last_observed_at: '2026-11-22T10:00:00Z',
      },
    }
    : original(name, args);

  const r = await processProjectionJob(f.db, { job_id: ID }, null, f.deps);

  assert.equal(r.retry_at, '2026-11-22T11:00:00Z');
  assert.equal(r.again, true);
  assert.equal(f.stages.includes('outliers'), false);
  assert.equal(f.stages.at(-1), 'quiet_period');
});

test('partial overrides also reject an out-of-day or pre-buffer deadline', () => {
  assert.throws(() => validateProjectionSettings({
    publish_deadline_minutes: 1440,
  }, { partial: true }));

  assert.throws(() => validateProjectionSettings({
    sync_buffer_minutes: 90,
    publish_deadline_minutes: 60,
  }, { partial: true }));
});