import test from 'node:test';
import assert from 'node:assert/strict';
import { activateInvoiceDeliveries } from '../lib/admin/activateInvoiceDeliveries.js';
import { createActivateDeliveriesHandler } from '../pages/api/cron/activate-invoice-deliveries.js';

const NOW = new Date('2026-11-13T12:00:00Z');

const RESTAURANTS = ['a', 'b', 'c', 'd'].map(id => ({
  id,
  operational_timezone: 'America/New_York',
  onboarding_completed_at: '2026-11-01T00:00:00Z',
  deactivated_at: null,
}));

const job = (id, overrides = {}) => ({
  restaurant_id: id,
  generation: 2,
  completed_generation: 1,
  lease_until: null,
  updated_at: '2026-11-12T00:00:00Z',
  finished_at: null,
  ...overrides,
});

function fixture({
  restaurants = RESTAURANTS.slice(0, 2),
  jobs = [job('a'), job('b')],
  locked = [],
  counts = {},
  rpcErrors = {},
  rpcResults = {},
  publishErrors = {},
} = {}) {
  const calls = {
    rpc: [],
    dispatched: [],
    filters: [],
    policies: [],
  };

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
          restaurant_id: id,
          local_today: '2026-11-13',
          eligible_invoices: count,
          calculations_queued: count > 0,
        },
      };
    },
  };

  const dependencies = {
    now: NOW,
    list: async make =>
      make().table === 'restaurants' ? restaurants : jobs,

    getPolicy: async (database, id) => {
      calls.policies.push(id);
      return { matching_enabled: !locked.includes(id) };
    },

    dispatch: async (message, options) => {
      const id = message.restaurant_id;

      assert.equal(message.version, 1);
      assert.equal(message.generation, '2');
      assert.equal(options.retentionSeconds, 86400);
      assert.equal(
        options.idempotencyKey,
        'invoice-delivery:2026-11-13:' + id + ':2'
      );

      calls.dispatched.push(id);

      if (publishErrors[id] instanceof Error) {
        throw publishErrors[id];
      }

      return { messageId: 'synthetic-' + id };
    },
  };

  return {
    calls,
    db,
    run: extra =>
      activateInvoiceDeliveries(db, { ...dependencies, ...extra }),
  };
}

test('queues restaurant-scoped activation and dispatches durable calculation messages', async () => {
  const f = fixture();
  const result = await f.run();

  assert.equal(result.queued.length, 2);
  assert.deepEqual(f.calls.rpc.map(call => call.args), [
    { p_restaurant_id: 'a' },
    { p_restaurant_id: 'b' },
  ]);
  assert.deepEqual(f.calls.dispatched, ['a', 'b']);
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
  assert.deepEqual(
    f.calls.rpc.map(call => call.args.p_restaurant_id),
    ['b']
  );
  assert.deepEqual(f.calls.dispatched, ['b']);
});

test('unfinished unconfigured accounts and deactivated restaurants are skipped', async () => {
  const f = fixture({
    restaurants: [
      {
        ...RESTAURANTS[0],
        operational_timezone: null,
        onboarding_completed_at: null,
      },
      {
        ...RESTAURANTS[1],
        deactivated_at: '2026-11-12T00:00:00Z',
      },
    ],
  });

  const result = await f.run();

  assert.equal(result.skipped.length, 2);
  assert.equal(result.failed.length, 0);
  assert.equal(f.calls.rpc.length, 0);
  assert.equal(f.calls.dispatched.length, 0);
});

test('completed accounts with missing or invalid timezones fail without a fallback', async () => {
  for (const zone of [null, 'EST', 'Mars/Restaurant']) {
    const f = fixture({
      restaurants: [{
        ...RESTAURANTS[0],
        operational_timezone: zone,
      }],
    });

    const result = await f.run();

    assert.equal(result.failed.length, 1);
    assert.equal(f.calls.rpc.length, 0);
    assert.equal(f.calls.dispatched.length, 0);
  }
});

test('a configured sample remains eligible without completed onboarding', async () => {
  const f = fixture({
    restaurants: [{
      ...RESTAURANTS[0],
      onboarding_completed_at: null,
    }],
  });

  await f.run();
  assert.deepEqual(f.calls.dispatched, ['a']);
});

test('pending failed work is retried even when no new invoice activates', async () => {
  const f = fixture({ counts: { a: 0, b: 0 } });
  const result = await f.run();

  assert.equal(result.queued.length, 0);
  assert.deepEqual(f.calls.dispatched, ['a', 'b']);
});

test('completed and foreign jobs are excluded but active leases still get retryable messages', async () => {
  const f = fixture({
    jobs: [
      job('a', { completed_generation: 2 }),
      job('b', { lease_until: '2026-11-13T13:00:00Z' }),
      job('foreign'),
    ],
  });

  await f.run();
  assert.deepEqual(f.calls.dispatched, ['b']);
});

test('every pending restaurant is dispatched without a three-job limit', async () => {
  const f = fixture({
    restaurants: RESTAURANTS,
    jobs: RESTAURANTS.map(r => job(r.id)),
  });

  const result = await f.run();

  assert.deepEqual(f.calls.dispatched.sort(), ['a', 'b', 'c', 'd']);
  assert.equal(result.dispatched.length, 4);
});

test('publishing concurrency is bounded while all jobs are dispatched', async () => {
  const restaurants = Array.from({ length: 12 }, (_, i) => ({
    ...RESTAURANTS[0],
    id: String(i),
  }));

  const f = fixture({
    restaurants,
    jobs: restaurants.map(r => job(r.id)),
  });

  let active = 0;
  let peak = 0;
  const sent = [];

  const result = await f.run({
    dispatch: async message => {
      active++;
      peak = Math.max(peak, active);

      await new Promise(resolve => setTimeout(resolve, 1));

      sent.push(message.restaurant_id);
      active--;
    },
  });

  assert.equal(sent.length, 12);
  assert.equal(result.failed.length, 0);
  assert.ok(peak <= 4);
});

test('a queue failure is reported while other restaurants continue', async () => {
  const f = fixture({
    rpcErrors: { a: 'Synthetic queue failure' },
  });

  const result = await f.run();

  assert.deepEqual(result.failed, [
    { restaurant_id: 'a', error: 'Synthetic queue failure' },
  ]);
  assert.deepEqual(f.calls.dispatched, ['b']);
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
    assert.deepEqual(f.calls.dispatched, ['b']);
  }
});

test('a publish failure is reported while remaining restaurants are dispatched', async () => {
  const f = fixture({
    publishErrors: {
      a: new Error('Synthetic publish failure'),
    },
  });

  const result = await f.run();

  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].restaurant_id, 'a');
  assert.deepEqual(f.calls.dispatched, ['a', 'b']);
  assert.deepEqual(
    result.dispatched.map(m => m.restaurant_id),
    ['b']
  );
});

test('invalid scheduler options fail before database work', async () => {
  const f = fixture();

  await assert.rejects(
    f.run({ now: new Date('invalid') }),
    TypeError
  );

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

      if (throws) {
        throw new Error('Synthetic private database detail');
      }

      return {
        checked: 2,
        queued: [],
        dispatched: [],
        skipped: [],
        failed,
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
  assert.equal(
    result.res.headers['Cache-Control'],
    'private, no-store'
  );
  assert.equal(result.calls, 1);
});

test('partial failures use a failing HTTP status for job monitoring', async () => {
  const result = await request({
    failed: [{
      restaurant_id: 'a',
      error: 'Synthetic failure',
    }],
  });

  assert.equal(result.res.statusCode, 503);
});

test('unexpected cron failures do not expose raw database details', async () => {
  const result = await request({ throws: true });

  assert.equal(result.res.statusCode, 500);
  assert.doesNotMatch(
    result.res.body.error,
    /private database detail/
  );
});