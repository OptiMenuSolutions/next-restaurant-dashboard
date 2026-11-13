import test from 'node:test';
import assert from 'node:assert/strict';

import {
  requireRestaurantTimezone,
  restaurantLocalDate,
  loadRestaurantTimezone,
} from '../lib/restaurantTime.js';

test('regional zones and explicit UTC are accepted', () => {
  for (const zone of [
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'America/Phoenix',
    'Asia/Tokyo',
    'UTC',
  ]) {
    assert.equal(typeof requireRestaurantTimezone(zone), 'string');
  }
});

test('unknown and invalid zones never receive a guessed fallback', () => {
  for (const zone of [null, undefined]) {
    assert.throws(
      () => requireRestaurantTimezone(zone),
      { code: 'RESTAURANT_TIMEZONE_REQUIRED' }
    );
  }

  for (const zone of [
    '', 'EST', 'Mars/Restaurant', ' America/New_York ',
    '+05:00', 'posix/America/New_York', 123,
  ]) {
    assert.throws(
      () => requireRestaurantTimezone(zone),
      { code: 'RESTAURANT_TIMEZONE_INVALID' }
    );
  }
});

test('the same instant can fall on different restaurant dates', () => {
  const now = new Date('2026-11-12T06:00:00Z');

  assert.equal(restaurantLocalDate('America/New_York', now), '2026-11-12');
  assert.equal(restaurantLocalDate('America/Los_Angeles', now), '2026-11-11');
  assert.equal(restaurantLocalDate('Asia/Tokyo', now), '2026-11-12');
});

for (const [label, zone, midnight] of [
  ['New York winter', 'America/New_York', '2026-11-12T05:00:00Z'],
  ['New York summer', 'America/New_York', '2026-07-12T04:00:00Z'],
  ['Los Angeles winter', 'America/Los_Angeles', '2026-11-12T08:00:00Z'],
  ['Los Angeles summer', 'America/Los_Angeles', '2026-07-12T07:00:00Z'],
  ['Phoenix summer', 'America/Phoenix', '2026-07-12T07:00:00Z'],
]) {
  test(label + ' changes date at local midnight', () => {
    const atMidnight = new Date(midnight);
    const immediatelyBefore = new Date(atMidnight.getTime() - 1);
    const month = midnight.slice(5, 7);

    assert.equal(
      restaurantLocalDate(zone, immediatelyBefore),
      '2026-' + month + '-11'
    );
    assert.equal(
      restaurantLocalDate(zone, atMidnight),
      '2026-' + month + '-12'
    );
  });
}

test('invalid timestamps are rejected', () => {
  for (const now of [new Date('invalid'), '2026-11-12', null]) {
    assert.throws(
      () => restaurantLocalDate('America/New_York', now),
      /A valid timestamp is required/
    );
  }
});

const RID = 'timezone-test-restaurant';

function database({ zone = 'America/Chicago', missing = false, error = null } = {}) {
  return {
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
            data: missing ? null : { id: RID, operational_timezone: zone },
            error,
          };
        },
      };
      return query;
    },
  };
}

test('timezone loading reads the requested restaurant setting', async () => {
  assert.equal(
    await loadRestaurantTimezone(database(), RID),
    'America/Chicago'
  );
});

test('an unconfigured restaurant cannot silently use server time', async () => {
  await assert.rejects(
    loadRestaurantTimezone(database({ zone: null }), RID),
    { code: 'RESTAURANT_TIMEZONE_REQUIRED' }
  );
});

test('an inaccessible restaurant cannot receive another default', async () => {
  await assert.rejects(
    loadRestaurantTimezone(database({ missing: true }), RID),
    { code: 'RESTAURANT_NOT_FOUND' }
  );
});

test('timezone read failures remain visible', async () => {
  await assert.rejects(
    loadRestaurantTimezone(database({
      error: { message: 'Synthetic database read failure' },
    }), RID),
    { code: 'RESTAURANT_TIMEZONE_LOAD_FAILED' }
  );
});