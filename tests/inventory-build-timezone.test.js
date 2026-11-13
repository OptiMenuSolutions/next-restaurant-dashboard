import test from 'node:test';
import assert from 'node:assert/strict';

import { inventoryBuild } from '../lib/inventoryBuild.js';

const RID = 'inventory-timezone-restaurant';

function fixture({
  timeZone = 'America/New_York',
  readError = null,
  retryWithTokyo = false,
} = {}) {
  let configuredZone = timeZone;
  const calls = { dates: [], commits: [], begins: 0 };

  const db = {
    from(table) {
      assert.equal(table, 'restaurants');
      const query = {
        select(columns) {
          assert.equal(columns, 'id, operational_timezone');
          return query;
        },
        eq(column, value) {
          assert.equal(column, 'id');
          assert.equal(value, RID);
          return query;
        },
        async maybeSingle() {
          return {
            data: readError ? null : {
              id: RID,
              operational_timezone: configuredZone,
            },
            error: readError,
          };
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(args.p_restaurant_id, RID);
      if (name === 'begin_inventory_build') {
        calls.begins++;
        return { data: 'build-token-' + calls.begins, error: null };
      }

      assert.equal(name, 'commit_inventory_build');
      calls.commits.push(args);
      if (retryWithTokyo && calls.commits.length === 1) {
        configuredZone = 'Asia/Tokyo';
        return {
          data: null,
          error: { message: 'INVENTORY_BUILD_CHANGED' },
        };
      }
      return { data: { rows: args.p_rows.length }, error: null };
    },
  };

  async function calculate(database, restaurantId, throughDate) {
    assert.equal(database, db);
    assert.equal(restaurantId, RID);
    calls.dates.push(throughDate);
    return { rows: [{ restaurant_id: RID }] };
  }

  return { db, calls, calculate };
}

test('inventory builds use each restaurant local date', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: Date.parse('2026-11-12T06:00:00Z'),
  });

  for (const [timeZone, expectedDate] of [
    ['America/New_York', '2026-11-12'],
    ['America/Los_Angeles', '2026-11-11'],
  ]) {
    const f = fixture({ timeZone });
    const result = await inventoryBuild(f.db, RID, f.calculate);

    assert.equal(result, 1);
    assert.deepEqual(f.calls.dates, [expectedDate]);
    assert.equal(f.calls.commits.length, 1);
  }
});

test('unconfigured time prevents inventory calculation and commit', async () => {
  const f = fixture({ timeZone: null });

  await assert.rejects(
    inventoryBuild(f.db, RID, f.calculate),
    { code: 'RESTAURANT_TIMEZONE_REQUIRED' }
  );

  assert.deepEqual(f.calls.dates, []);
  assert.deepEqual(f.calls.commits, []);
});

test('inventory retry reloads the restaurant time zone', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: Date.parse('2026-11-12T06:00:00Z'),
  });

  const f = fixture({
    timeZone: 'America/Los_Angeles',
    retryWithTokyo: true,
  });
  await inventoryBuild(f.db, RID, f.calculate);

  assert.equal(f.calls.begins, 2);
  assert.deepEqual(f.calls.dates, ['2026-11-11', '2026-11-12']);
});

test('timezone lookup failure cannot commit inventory', async () => {
  const f = fixture({
    readError: { message: 'Synthetic settings read failure' },
  });

  await assert.rejects(
    inventoryBuild(f.db, RID, f.calculate),
    { code: 'RESTAURANT_TIMEZONE_LOAD_FAILED' }
  );

  assert.deepEqual(f.calls.dates, []);
  assert.deepEqual(f.calls.commits, []);
});