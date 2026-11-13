import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  previousCalendarDate,
  wasteSnapshotDates,
} from '../lib/wasteSnapshotDates.js';

const NOW = new Date('2026-11-12T06:00:00Z');
const RESTAURANTS = [
  { id: 'east', name: 'East', operational_timezone: 'America/New_York', onboarding_completed_at: '2026-11-01T00:00:00Z' },
  { id: 'west', name: 'West', operational_timezone: 'America/Los_Angeles', onboarding_completed_at: '2026-11-01T00:00:00Z' },
];

function harness({
  restaurants = RESTAURANTS,
  existing = false,
  maintenanceError = null,
  wrongRestaurant = false,
} = {}) {
  const calls = { rpc: [], calculations: [], inventory: [], confirmations: [], alerts: [] };
  const db = {
    async rpc(name, args) {
      calls.rpc.push({ name, args: args ? JSON.parse(JSON.stringify(args)) : null });
      if (name === 'refresh_sample_dates') return { data: 0, error: null };
      assert.equal(name, 'maintain_restaurant_waste_confirmations');
      if (maintenanceError && args.p_restaurant_id === 'east') {
        return { data: null, error: { message: maintenanceError } };
      }
      return {
        data: {
          restaurant_id: wrongRestaurant ? 'foreign' : args.p_restaurant_id,
          reasked: 1,
          expired: 2,
        },
        error: null,
      };
    },
    from(table) {
      if (table === 'restaurants') {
        return {
          async select(columns) {
            assert.equal(columns, 'id, name, operational_timezone, onboarding_completed_at');
            return { data: restaurants, error: null };
          },
        };
      }
      if (table === 'waste_confirmations') {
        return {
          async upsert(rows, options) {
            calls.confirmations.push(...rows);
            assert.equal(options.ignoreDuplicates, true);
            return { error: null };
          },
        };
      }
      assert.equal(table, 'waste_risk_snapshots');
      const query = {
        filters: {},
        select() { return query; },
        eq(key, value) { query.filters[key] = value; return query; },
        limit() { return query; },
        order() { return query; },
        async single() { return { data: existing ? { id: 'saved' } : null }; },
        async upsert() { return { error: null }; },
      };
      return query;
    },
  };

  // Execute the actual route with mocked imports; no network or database access.
  const source = readFileSync(
    new URL('../pages/api/cron/snapshot-waste-risk.js', import.meta.url),
    'utf8'
  )
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export const config/m, 'const config')
    .replace(/^export default /m, 'globalThis.testHandler = ');

  const context = {
    process: { env: { CRON_SECRET: 'synthetic-secret' } },
    console: { log() {}, error() {} },
    createClient: () => db,
    withJobRun: (name, handler) => handler,
    previousCalendarDate,
    wasteSnapshotDates: zone => wasteSnapshotDates(zone, NOW),
    processInvoiceCalculations: async (client, id) => {
      calls.calculations.push(id);
      return { errors: [] };
    },
    deliverPriceAlerts: async () => ({ failures: [] }),
    deliverLowMarginAlerts: async () => ({ failures: [] }),
    runUsage: async () => ({ applied: true }),
    rebuildCurrentInventory: async () => {
      throw new Error('Unexpected duplicate inventory rebuild');
    },
    calculateInventory: async (client, id, date) => {
      calls.inventory.push({ id, date });
      return {
        counts: [],
        risks: [{
          invoiceItemId: 'line-' + id,
          name: 'Synthetic ingredient',
          deliveryDate: '2026-11-01',
          daysLeft: 0,
          remainingQty: 2,
          unitCost: 15,
        }],
      };
    },
    readAllInventoryRows: async factory => {
      const query = factory();
      return [{
        invoice_item_id: 'line-' + query.filters.restaurant_id,
        days_left: 1,
        inventory_count_line_id: null,
      }];
    },
    sendCronAlert: async (...args) => { calls.alerts.push(args); },
  };
  vm.runInNewContext(source, context, { filename: 'snapshot-waste-risk.js' });

  async function run({ method = 'GET', authorized = true } = {}) {
    const response = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; },
    };
    await context.testHandler({
      method,
      headers: { authorization: authorized ? 'Bearer synthetic-secret' : 'wrong' },
    }, response);
    return response;
  }
  return { calls, run };
}

test('cron scopes maintenance and snapshots to each restaurant local date', async () => {
  const { calls, run } = harness();
  const response = await run();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.snapshotDates, {
    east: '2026-11-11', west: '2026-11-10',
  });
  assert.deepEqual(calls.inventory, [
    { id: 'east', date: '2026-11-11' },
    { id: 'west', date: '2026-11-10' },
  ]);
  assert.deepEqual(calls.rpc.slice(1).map(call => call.args), [
    { p_restaurant_id: 'east', p_expiry_window_days: 3 },
    { p_restaurant_id: 'west', p_expiry_window_days: 3 },
  ]);
  assert.deepEqual(calls.confirmations.map(row => [
    row.restaurant_id, row.last_seen_date, row.last_asked_date,
  ]), [
    ['east', '2026-11-11', '2026-11-12'],
    ['west', '2026-11-10', '2026-11-11'],
  ]);
  assert.equal(response.body.expiredConfirmations, 4);
  assert.equal(response.body.failed.length, 0);
});

test('existing snapshots still run confirmation maintenance', async () => {
  const { calls, run } = harness({ existing: true });
  const response = await run();
  assert.deepEqual(response.body.skipped, ['East', 'West']);
  assert.equal(calls.rpc.length, 3);
  assert.equal(calls.inventory.length, 0);
  assert.deepEqual(calls.calculations, ['east', 'west']);
  assert.equal(response.body.expiredConfirmations, 4);
});

test('missing timezone reports failure and skips that restaurant processing', async () => {
  const { calls, run } = harness({ restaurants: [
    { ...RESTAURANTS[0], operational_timezone: null },
    RESTAURANTS[1],
  ] });
  const response = await run();
  assert.equal(response.body.failed.length, 1);
  assert.match(response.body.failed[0].error, /Configure the restaurant time zone/);
  assert.deepEqual(calls.calculations, ['west']);
  assert.deepEqual(calls.rpc.slice(1).map(call => call.args.p_restaurant_id), ['west']);
  assert.deepEqual(response.body.snapshotDates, { west: '2026-11-10' });
});

test('maintenance failure is reported while other restaurants continue', async () => {
  const { calls, run } = harness({ maintenanceError: 'Synthetic maintenance failure' });
  const response = await run();
  assert.equal(response.body.failed.length, 1);
  assert.equal(response.body.failed[0].error, 'Synthetic maintenance failure');
  assert.equal(response.body.expiredConfirmations, 2);
  assert.equal(response.body.success.length, 2);
  assert.equal(calls.alerts.length, 1);
});

test('maintenance results for another restaurant are rejected', async () => {
  const { run } = harness({ wrongRestaurant: true });
  const response = await run();
  assert.equal(response.body.failed.length, 2);
  assert.equal(response.body.expiredConfirmations, 0);
  for (const failure of response.body.failed) {
    assert.equal(failure.error, 'Invalid waste-confirmation maintenance result');
  }
});

test('unauthorized requests perform no database work', async () => {
  const { calls, run } = harness();
  const response = await run({ authorized: false });
  assert.equal(response.statusCode, 401);
  assert.equal(calls.rpc.length, 0);
  assert.equal(calls.inventory.length, 0);
});

test('non-GET requests perform no database work', async () => {
  const { calls, run } = harness();
  const response = await run({ method: 'POST' });
  assert.equal(response.statusCode, 405);
  assert.equal(calls.rpc.length, 0);
});

test('an unconfigured account awaiting onboarding is skipped without a failure', async () => {
  const { calls, run } = harness({ restaurants: [
    {
      ...RESTAURANTS[0],
      operational_timezone: null,
      onboarding_completed_at: null,
    },
    RESTAURANTS[1],
  ] });
  const response = await run();
  assert.deepEqual(response.body.skipped, ['East']);
  assert.equal(response.body.failed.length, 0);
  assert.deepEqual(calls.calculations, ['west']);
  assert.deepEqual(
    calls.rpc.slice(1).map(call => call.args.p_restaurant_id),
    ['west']
  );
});

test('a configured sample account remains eligible without onboarding completion', async () => {
  const { calls, run } = harness({ restaurants: [
    { ...RESTAURANTS[0], onboarding_completed_at: null },
  ] });
  const response = await run();
  assert.equal(response.body.success.length, 1);
  assert.equal(response.body.failed.length, 0);
  assert.deepEqual(calls.calculations, ['east']);
});