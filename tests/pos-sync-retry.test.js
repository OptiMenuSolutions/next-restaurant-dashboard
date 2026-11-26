import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const restaurantId = 'restaurant-1';
const failure = 'Shift4 ticket pages do not reconcile to the total count';
const manualRange = { from: '2026-11-17', to: '2026-11-18' };
const scheduledRange = { from: '2026-11-22', to: '2026-11-25' };

class FixtureDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : ['2026-11-25T08:00:00Z']));
  }

  static now() {
    return Date.parse('2026-11-25T08:00:00Z');
  }
}

const sharedSyncSource = readFileSync(
  new URL('../lib/pos/syncConnection.js', import.meta.url), 'utf8'
).replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');

function harness(
  provider = 'shift4',
  ticketSaveError = null,
  beforeUsage = async () => {},
  busyClaims = 0
) {
  const connection = {
    id: 'connection-1',
    restaurant_id: restaurantId,
    provider,
    status: 'connected',
  };
  const alerts = [];
  const pulls = [];
  const saleDeletes = [];
  const waits = [];
  let fail = true;
  let heldLease = null;
  let leaseCount = 0;

  const db = {
    async rpc(name, args) {
      assert.equal(args.target, restaurantId);
      if (name === 'pos_sync_acquire') {
        if (heldLease || busyClaims > 0) {
          if (busyClaims > 0) busyClaims--;
          return { data: null, error: null };
        }
        heldLease = `lease-${++leaseCount}`;
        return { data: heldLease, error: null };
      }

      assert.equal(name, 'pos_sync_release');
      assert.equal(args.lease_token, heldLease);
      heldLease = null;
      return { error: null };
    },
    auth: {
      async getUser() {
        return { data: { user: { id: 'user-1' } }, error: null };
      },
    },
    from(table) {
      const filters = {};
      let update;
      let deleting = false;
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        not() { return query; },
        is(key, value) { filters[key] = value; return query; },
        gte(key, value) { filters.from = value; return query; },
        lte(key, value) { filters.to = value; return query; },
        update(patch) { update = patch; return query; },
        delete() { deleting = true; return query; },
        async single() {
          if (table === 'profiles') return { data: { restaurant_id: restaurantId } };
          assert.equal(table, 'pos_connections');
          assert.equal(filters.restaurant_id, restaurantId);
          return { data: { ...connection } };
        },
        then(resolve) {
          if (table === 'restaurants') return resolve({ data: [], error: null });
          if (table === 'pos_sales') {
            assert.equal(deleting, true);
            saleDeletes.push(filters);
            return resolve({ error: null });
          }
          assert.equal(table, 'pos_connections');
          if (update) {
            assert.equal(filters.id, connection.id);
            Object.assign(connection, update);
            return resolve({ error: null });
          }
          assert.equal(filters.status, 'connected');
          const data = connection.status === filters.status ? [{ ...connection }] : [];
          return resolve({ data, error: null });
        },
      };
      return query;
    },
  };

  async function pull(conn, range) {
    pulls.push({ id: conn.id, from: range.from, to: range.to });
    if (fail) throw new Error(failure);
    return [];
  }

  function route(path) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
      .replace(/^import .*;\r?$/gm, '')
      .replace(/^export const config/m, 'const config')
      .replace(/^export default /m, 'globalThis.handler = ');

    const context = {
      Date: FixtureDate,
      delay: async ms => { waits.push(ms); },
      process: { env: { CRON_SECRET: 'cron-secret' } },
      console: { log() {}, error() {} },
      createClient: () => db,
      withJobRun: (_name, handler) => handler,
      getProvider: () => provider === 'shift4'
        ? {
            async fetchSalesAndTickets(conn, range) {
              return { sales: await pull(conn, range), tickets: [] };
            },
          }
        : { authType: 'oauth2', fetchSales: pull },
      async saveTickets() {
        if (ticketSaveError) throw new Error(ticketSaveError);
        return { tickets: 0, lines: 0 };
      },
      async runUsage() {
        await beforeUsage();
        return { applied: true };
      },
      sendCronAlert: async (...args) => { alerts.push(args); },
    };

    vm.createContext(context);
    vm.runInContext(sharedSyncSource, context, { filename: 'syncConnection.js' });
    vm.runInContext(source, context, { filename: path });

    return async (req) => {
      const res = {
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      };
      await context.handler(req, res);
      return res;
    };
  }

  return {
    connection, alerts, pulls, saleDeletes, waits,
    allowPull() { fail = false; },
    manual: (range = manualRange) => route('../pages/api/pos/sync.js')({
      method: 'POST',
      headers: { authorization: 'Bearer user-token' },
      body: { restaurantId, ...range },
    }),
    scheduled: () => route('../pages/api/cron/sync-all-pos.js')({
      method: 'GET',
      headers: { authorization: 'Bearer cron-secret' },
    }),
  };
}

test('a refused manual Shift4 sync stays connected and is picked up by the next cron', async () => {
  const state = harness();
  assert.equal((await state.manual()).statusCode, 502);
  assert.equal(state.connection.status, 'connected');
  assert.equal(state.connection.last_error, failure);
  assert.equal(state.connection.updated_at, '2026-11-25T08:00:00.000Z');
  assert.equal(state.saleDeletes.length, 0);
  assert.equal(
    state.alerts[0][2][0],
    `shift4, restaurant ${restaurantId}, 2026-11-17 through 2026-11-18: ${failure}`
  );

  state.allowPull();
  const response = await state.scheduled();
  assert.equal(response.body.synced, 1);
  assert.deepEqual(state.pulls, [
    { id: state.connection.id, ...manualRange },
    { id: state.connection.id, ...scheduledRange },
  ]);
  assert.equal(state.saleDeletes.length, 1);
  assert.equal(state.connection.last_error, null);
});

test('the cron includes the attempted range in its Shift4 failure alert', async () => {
  const state = harness();
  const response = await state.scheduled();
  assert.equal(response.body.failed, 1);
  assert.equal(state.connection.status, 'connected');
  assert.equal(state.connection.last_error, failure);
  assert.equal(
    state.alerts[0][2][0],
    `shift4, restaurant ${restaurantId}, 2026-11-22 through 2026-11-25: ${failure}`
  );
});

test('a failed manual OAuth sync still marks the connection as error', async () => {
  const state = harness('square');
  assert.equal((await state.manual()).statusCode, 502);
  assert.equal(state.connection.status, 'error');
  assert.equal(state.alerts.length, 0);
  assert.equal((await state.scheduled()).body.synced, 0);
  assert.equal(state.pulls.length, 1);
});

test('a manual raw-ticket save failure alerts with the requested date range', async () => {
  const state = harness('shift4', 'ticket write failed');
  state.allowPull();

  const response = await state.manual();
  assert.equal(response.statusCode, 200);
  assert.equal(state.connection.status, 'connected');
  assert.equal(state.alerts.length, 1);
  assert.match(state.alerts[0][1], /restaurant-1/);
  assert.equal(state.alerts[0][2][0], '2026-11-17 through 2026-11-18: ticket write failed');
});

test('manual and scheduled syncs cannot overlap for the same restaurant and date range', async () => {
  let enteredUsage;
  const usageStarted = new Promise(resolve => { enteredUsage = resolve; });
  let finishUsage;
  const usagePaused = new Promise(resolve => { finishUsage = resolve; });

  const state = harness('shift4', null, async () => {
    enteredUsage();
    await usagePaused;
  });
  state.allowPull();

  const scheduled = state.scheduled();
  await Promise.race([
    usageStarted,
    scheduled.then(() => assert.fail('Scheduled sync finished before applying usage')),
  ]);

  try {
    const response = await state.manual(scheduledRange);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, 'POS_SYNC_BUSY');
    assert.equal(response.body.retryable, true);
    assert.equal(state.pulls.length, 1);
    assert.equal(state.saleDeletes.length, 1);
    assert.equal(state.connection.status, 'connected');
    assert.equal(state.connection.last_error, null);
  } finally {
    finishUsage();
    assert.equal((await scheduled).body.synced, 1);
  }

  assert.equal((await state.manual(scheduledRange)).statusCode, 200);
  assert.equal(state.pulls.length, 2);
  assert.equal(state.saleDeletes.length, 2);
});

test('cron retries a busy restaurant once without reporting the initial conflict as a failure', async () => {
  const state = harness('shift4', null, async () => {}, 1);
  state.allowPull();

  const response = await state.scheduled();
  assert.deepEqual(state.waits, [60_000]);
  assert.equal(response.body.synced, 1);
  assert.equal(response.body.failed, 0);
  assert.equal(state.pulls.length, 1);
  assert.equal(state.alerts.length, 0);
});

test('cron records a still-busy restaurant after its single retry', async () => {
  const state = harness('shift4', null, async () => {}, 2);
  const response = await state.scheduled();

  assert.deepEqual(state.waits, [60_000]);
  assert.equal(response.body.failed, 1);
  assert.equal(response.body.results.failed[0].code, 'POS_SYNC_BUSY');
  assert.equal(state.pulls.length, 0);
  assert.equal(state.connection.last_error, undefined);
});