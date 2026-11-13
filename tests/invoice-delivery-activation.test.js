import test from 'node:test';
import assert from 'node:assert/strict';
import { activateInvoiceDeliveries } from '../lib/admin/activateInvoiceDeliveries.js';
import { createActivateDeliveriesHandler } from '../pages/api/cron/activate-invoice-deliveries.js';

const NOW = new Date('2026-11-13T12:00:00Z');
const RESTAURANTS = ['a', 'b', 'c', 'd'].map(id => ({
  id, operational_timezone: 'America/New_York',
  onboarding_completed_at: '2026-11-01T00:00:00Z', deactivated_at: null,
}));

const job = (id, overrides = {}) => ({
  restaurant_id: id, generation: 2, completed_generation: 1,
  lease_until: null, updated_at: '2026-11-12T00:00:00Z', finished_at: null,
  ...overrides,
});

function fixture({
  restaurants = RESTAURANTS.slice(0, 2),
  jobs = [job('a'), job('b')], locked = [], counts = {},
  rpcErrors = {}, rpcResults = {}, outcomes = {},
} = {}) {
  const calls = { rpc: [], processed: [], filters: [], policies: [] };
  const db = {
    from(table) {
      const q = {
        table,
        select() { return q; },
        is(key, value) {
          calls.filters.push({ table, key, value });
          return q;
        },
        order() { return q; },
      };
      return q;
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      assert.equal(name, 'queue_due_invoice_deliveries');
      const id = args.p_restaurant_id;
      const count = counts[id] ?? 1;
      return {
        error: rpcErrors[id] ? { message: rpcErrors[id] } : null,
        data: rpcResults[id] || {
          restaurant_id: id, local_today: '2026-11-13',
          eligible_invoices: count, calculations_queued: count > 0,
        },
      };
    },
  };

  const dependencies = {
    now: NOW,
    list: async make => make().table === 'restaurants' ? restaurants : jobs,
    getPolicy: async (database, id) => {
      calls.policies.push(id);
      return { matching_enabled: !locked.includes(id) };
    },
    process: async (database, id) => {
      calls.processed.push(id);
      if (outcomes[id] instanceof Error) throw outcomes[id];
      return outcomes[id] || { skipped: false, errors: [] };
    },
  };

  return {
    calls,
    db,
    run: extra => activateInvoiceDeliveries(db, { ...dependencies, ...extra }),
  };
}

test('queues restaurant-scoped activation and uses the existing calculation worker', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.queued.length, 2);
  assert.deepEqual(f.calls.rpc.map(call => call.args), [
    { p_restaurant_id: 'a' }, { p_restaurant_id: 'b' },
  ]);
  assert.deepEqual(f.calls.processed, ['a', 'b']);
  assert.equal(result.failed.length, 0);
  assert.deepEqual(f.calls.filters, [
    { table: 'restaurants', key: 'deactivated_at', value: null },
  ]);
});

test('locked matching queues and processes nothing for that restaurant', async () => {
  const f = fixture({ locked: ['a'] });
  const result = await f.run();
  assert.deepEqual(result.skipped, [
    { restaurant_id: 'a', reason: 'matching_locked' },
  ]);
  assert.deepEqual(f.calls.rpc.map(call => call.args.p_restaurant_id), ['b']);
  assert.deepEqual(f.calls.processed, ['b']);
});

test('unfinished unconfigured accounts and deactivated restaurants are skipped', async () => {
  const f = fixture({ restaurants: [
    {
      ...RESTAURANTS[0],
      operational_timezone: null,
      onboarding_completed_at: null,
    },
    { ...RESTAURANTS[1], deactivated_at: '2026-11-12T00:00:00Z' },
  ] });
  const result = await f.run();
  assert.equal(result.skipped.length, 2);
  assert.equal(result.failed.length, 0);
  assert.equal(f.calls.rpc.length, 0);
  assert.equal(f.calls.processed.length, 0);
});

test('completed accounts with missing or invalid timezones fail without a fallback', async () => {
  for (const zone of [null, 'EST', 'Mars/Restaurant']) {
    const f = fixture({
      restaurants: [{ ...RESTAURANTS[0], operational_timezone: zone }],
    });
    const result = await f.run();
    assert.equal(result.failed.length, 1);
    assert.equal(f.calls.rpc.length, 0);
    assert.equal(f.calls.processed.length, 0);
  }
});

test('a configured sample remains eligible without completed onboarding', async () => {
  const f = fixture({
    restaurants: [{ ...RESTAURANTS[0], onboarding_completed_at: null }],
  });
  await f.run();
  assert.deepEqual(f.calls.processed, ['a']);
});

test('pending failed work is retried even when no new invoice activates', async () => {
  const f = fixture({ counts: { a: 0, b: 0 } });
  const result = await f.run();
  assert.equal(result.queued.length, 0);
  assert.deepEqual(f.calls.processed, ['a', 'b']);
});

test('completed jobs, active leases and foreign restaurant jobs are excluded', async () => {
  const f = fixture({ jobs: [
    job('a', { completed_generation: 2 }),
    job('b', { lease_until: '2026-11-13T13:00:00Z' }),
    job('foreign'),
  ] });
  await f.run();
  assert.equal(f.calls.processed.length, 0);
});

test('bounded batches prefer older attempts so a recent failure cannot monopolize the queue', async () => {
  const f = fixture({ restaurants: RESTAURANTS, jobs: [
    job('a', { finished_at: '2026-11-13T11:59:00Z' }),
    job('b', { updated_at: '2026-11-12T02:00:00Z' }),
    job('c', { updated_at: '2026-11-12T01:00:00Z' }),
    job('d', { updated_at: '2026-11-12T03:00:00Z' }),
  ] });
  await f.run({ maxJobs: 2 });
  assert.deepEqual(f.calls.processed, ['c', 'b']);
});

test('a queue failure is reported while other restaurants continue', async () => {
  const f = fixture({ rpcErrors: { a: 'Synthetic queue failure' } });
  const result = await f.run();
  assert.deepEqual(result.failed, [
    { restaurant_id: 'a', error: 'Synthetic queue failure' },
  ]);
  assert.deepEqual(f.calls.processed, ['b']);
});

test('malformed or wrong-tenant queue responses are rejected', async () => {
  for (const bad of [
    {
      restaurant_id: 'foreign',
      eligible_invoices: 1,
      calculations_queued: true,
    },
    {
      restaurant_id: 'a',
      eligible_invoices: 0,
      calculations_queued: true,
    },
    {
      restaurant_id: 'a',
      eligible_invoices: -1,
      calculations_queued: false,
    },
  ]) {
    const f = fixture({ rpcResults: { a: bad } });
    const result = await f.run();
    assert.equal(result.failed.length, 1);
    assert.deepEqual(f.calls.processed, ['b']);
  }
});

test('worker errors and exceptions are reported without blocking remaining jobs', async () => {
  const f = fixture({
    outcomes: {
      a: { skipped: false, errors: ['Synthetic pricing failure'] },
    },
  });
  const result = await f.run();
  assert.equal(result.failed.length, 1);
  assert.deepEqual(f.calls.processed, ['a', 'b']);

  const thrown = fixture({
    outcomes: { a: new Error('Synthetic worker exception') },
  });
  assert.equal((await thrown.run()).failed.length, 1);
  assert.deepEqual(thrown.calls.processed, ['a', 'b']);
});

test('invalid scheduler options fail before database work', async () => {
  const f = fixture();
  for (const extra of [
    { now: new Date('invalid') },
    { maxJobs: 0 },
    { maxJobs: 11 },
  ]) {
    await assert.rejects(f.run(extra), TypeError);
  }
  assert.equal(f.calls.rpc.length, 0);
});

async function request({
  method = 'GET',
  secret = 'synthetic-secret',
  authorization = 'Bearer synthetic-secret',
  failed = [],
  throws = false,
} = {}) {
  let calls = 0;

  const handler = createActivateDeliveriesHandler({
    db: {},
    getSecret: () => secret,
    run: async () => {
      calls++;
      if (throws) throw new Error('Synthetic private database detail');
      return {
        checked: 2, queued: [], processed: [], skipped: [], failed,
      };
    },
  });

  const res = {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await handler({ method, headers: { authorization } }, res);
  return { res, calls };
}

test('cron rejects missing configuration and unauthorized callers before work', async () => {
  for (const options of [
    { secret: null, authorization: 'Bearer null' },
    { secret: '', authorization: 'Bearer ' },
    { authorization: 'wrong' },
  ]) {
    const result = await request(options);
    assert.equal(result.res.statusCode, 401);
    assert.equal(result.calls, 0);
  }
});

test('cron permits GET only and rejects POST before work', async () => {
  const result = await request({ method: 'POST' });
  assert.equal(result.res.statusCode, 405);
  assert.equal(result.res.headers.Allow, 'GET');
  assert.equal(result.calls, 0);
});

test('authorized cron returns no-store results', async () => {
  const result = await request();
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.headers['Cache-Control'], 'private, no-store');
  assert.equal(result.calls, 1);
});

test('partial failures use a failing HTTP status for job monitoring', async () => {
  const result = await request({
    failed: [{ restaurant_id: 'a', error: 'Synthetic failure' }],
  });
  assert.equal(result.res.statusCode, 503);
});

test('unexpected cron failures do not expose raw database details', async () => {
  const result = await request({ throws: true });
  assert.equal(result.res.statusCode, 500);
  assert.doesNotMatch(result.res.body.error, /private database detail/);
});