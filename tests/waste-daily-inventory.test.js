import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWasteDailyInventory } from '../lib/wasteDailyInventory.js';

const job = {
  restaurant_id: 'fixture',
  assessment_date: '2026-11-26',
  sync_not_before: '2026-11-26T10:00:00Z',
  timing: {
    timezone: 'America/New_York',
    cutoff_minutes: 240,
    starts_at: '2026-11-26T09:00:00Z',
    deadline_at: '2026-11-26T12:00:00Z',
  },
};

function harness(overrides = {}) {
  const calls = [];
  const connection = {
    restaurant_id: 'fixture',
    provider: 'shift4',
    status: 'connected',
    shift4_timezone: 'America/New_York',
  };
  const query = {
    select: () => query,
    eq: (column, value) => {
      assert.equal(connection[column], value);
      return query;
    },
    maybeSingle: async () => ({ data: connection, error: null }),
  };
  const db = { from(table) { assert.equal(table, 'pos_connections'); return query; } };
  const options = {
    now: () => '2026-11-26T10:00:30Z',
    sync: async (client, conn, range, options) => {
      assert.equal(client, db);
      assert.equal(conn, connection);
      assert.equal(options.alertOnFailure, false);
      calls.push(range);
      return {
        rawTicketsSaved: true,
        syncRevision: 'latest-sync',
        startedAt: '2026-11-26T10:00:00Z',
        finishedAt: '2026-11-26T10:00:20Z',
        ...overrides,
      };
    },
    calculate: async (client, restaurant, cutoff, zone) => {
      assert.equal(client, db);
      calls.push({ restaurant, cutoff, zone });
      return { rows: [{ invoice_item_id: 'lot' }], usageJob: { generation: 9 } };
    },
  };
  return { db, calls, options };
}

test('the daily inventory step uses shared sync for the completed business date', async () => {
  const { db, calls, options } = harness();
  const receipt = await prepareWasteDailyInventory(db, job, options);

  assert.deepEqual(calls, [
    { from: '2026-11-25', to: '2026-11-26' },
    { restaurant: 'fixture', cutoff: job.timing.starts_at, zone: job.timing.timezone },
  ]);
  assert.equal(receipt.syncRevision, 'latest-sync');
  assert.equal(receipt.usageJob.generation, 9);
});

test('raw-ticket failures and unfinished usage prevent the as-of inventory build', async () => {
  for (const overrides of [{ rawTicketsSaved: false }, { usage: { retryPending: true } }]) {
    const { db, calls, options } = harness(overrides);
    await assert.rejects(prepareWasteDailyInventory(db, job, options), { code: 'POS_SYNC_INCOMPLETE' });
    assert.equal(calls.length, 1);
  }
});

test('the daily step does not call sync before the quiet period or after the deadline', async () => {
  for (const time of ['2026-11-26T09:59:59Z', '2026-11-26T12:00:00Z']) {
    const { db, calls, options } = harness();
    await assert.rejects(
      prepareWasteDailyInventory(db, job, { ...options, now: () => time }),
      { code: 'POS_SYNC_OUTSIDE_WINDOW' }
    );
    assert.equal(calls.length, 0);
  }
});