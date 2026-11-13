import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveShippingAddressHandler } from '../pages/api/account/save-shipping-address.js';

const RID = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';
const ADDRESS = {
  shipping_address_line1: '1 Test Street', shipping_city: 'Trenton',
  shipping_state: 'NJ', shipping_zip: '08608',
};

function fixture(options = {}) {
  const calls = { reads: [], resolves: [], rpc: [] };
  const restaurant = options.restaurant === null ? null : {
    id: RID, user_id: ACTOR, deactivated_at: null,
    shipping_address_line1: null, shipping_city: null,
    shipping_state: null, shipping_zip: null, operational_timezone: null,
    ...options.restaurant,
  };
  const db = {
    from(table) {
      assert.equal(table, 'restaurants');
      const query = {
        select() { return query; },
        eq(key, value) {
          calls.reads.push({ key, value });
          return query;
        },
        async maybeSingle() {
          return { data: restaurant, error: options.readError || null };
        },
      };
      return query;
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      return {
        error: options.rpcError || null,
        data: options.result || {
          success: true, changed: true, calculations_queued: options.matching !== false,
          restaurant: { id: RID, ...ADDRESS, operational_timezone: 'America/New_York' },
        },
      };
    },
  };
  const handler = createSaveShippingAddressHandler({
    db,
    verifyAccess: async () => options.access || { user: { id: ACTOR } },
    getMatchingPolicy: async () => options.policy || { matching_enabled: options.matching !== false },
    resolveAddress: async address => {
      calls.resolves.push(address);
      if (options.resolveError) throw options.resolveError;
      return options.resolved || {
        address, timezone: 'America/New_York',
        resolution: { provider: 'google_geocoding_geo_tz', place_id: 'synthetic-place' },
      };
    },
  });
  async function run(body = { restaurant_id: RID, address: ADDRESS }, method = 'POST') {
    const response = {
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
      end() { return this; },
    };
    await handler({ method, body, headers: {} }, response);
    return response;
  }
  return { calls, run };
}

test('owner save passes server-resolved timezone and captured state to one RPC', async () => {
  const { calls, run } = fixture();
  const response = await run({ restaurant_id: RID, address: ADDRESS, complete_onboarding: true });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(calls.reads, [{ key: 'id', value: RID }]);
  assert.deepEqual(calls.resolves, [ADDRESS]);
  assert.deepEqual(calls.rpc, [{
    name: 'save_restaurant_shipping_address',
    args: {
      p_restaurant_id: RID, p_actor_id: ACTOR,
      p_expected: {
        shipping_address_line1: null, shipping_city: null,
        shipping_state: null, shipping_zip: null, operational_timezone: null,
      },
      p_address: ADDRESS, p_timezone: 'America/New_York',
      p_place_id: 'synthetic-place', p_complete_onboarding: true,
      p_queue_calculations: true,
    },
  }]);
});

test('invalid input and client-supplied actor or timezone are rejected before reads', async () => {
  for (const body of [null, '{broken', {},
    { restaurant_id: RID, address: { ...ADDRESS, shipping_zip: 'invalid' } },
    { restaurant_id: RID, address: ADDRESS, actor_id: FOREIGN },
    { restaurant_id: RID, address: ADDRESS, timezone: 'UTC' },
    { restaurant_id: RID, address: { ...ADDRESS, timezone: 'UTC' } },
    { restaurant_id: RID, address: ADDRESS, complete_onboarding: 'true' },
  ]) {
    const { calls, run } = fixture();
    assert.equal((await run(body)).statusCode, 422);
    assert.equal(calls.reads.length, 0);
    assert.equal(calls.resolves.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
});

test('unauthorized caller causes no database read or paid address lookup', async () => {
  const { calls, run } = fixture({ access: { error: 'Unauthorized', status: 401 } });
  assert.equal((await run()).statusCode, 401);
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.resolves.length, 0);
});

test('linked non-owner and deactivated restaurant reject before address lookup', async () => {
  for (const restaurant of [{ user_id: FOREIGN }, { deactivated_at: '2026-11-01T00:00:00Z' }]) {
    const { calls, run } = fixture({ restaurant });
    assert.equal((await run()).statusCode, 403);
    assert.equal(calls.resolves.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
});

test('missing restaurant and failed reads do not call the resolver', async () => {
  for (const [options, status] of [
    [{ restaurant: null }, 404],
    [{ readError: { message: 'Synthetic failure' } }, 503],
  ]) {
    const { calls, run } = fixture(options);
    assert.equal((await run()).statusCode, status);
    assert.equal(calls.resolves.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
});

test('lookup failures return actionable errors without persistence', async () => {
  for (const [code, status] of [
    ['ADDRESS_NOT_FOUND', 422],
    ['ADDRESS_LOOKUP_UNAVAILABLE', 503],
  ]) {
    const { calls, run } = fixture({
      resolveError: Object.assign(new Error('Synthetic lookup error'), { code, status }),
    });
    const response = await run();
    assert.equal(response.statusCode, status);
    assert.equal(response.body.error, 'Synthetic lookup error');
    assert.equal(calls.rpc.length, 0);
  }
});

test('unknown resolver failures do not expose raw provider errors', async () => {
  const { calls, run } = fixture({ resolveError: new Error('Synthetic private provider detail') });
  const response = await run();
  assert.equal(response.statusCode, 500);
  assert.doesNotMatch(response.body.error, /private provider detail/);
  assert.equal(calls.rpc.length, 0);
});

test('resolver cannot substitute a different shipping address', async () => {
  const { calls, run } = fixture({ resolved: {
    address: { ...ADDRESS, shipping_zip: '08609' }, timezone: 'America/New_York',
    resolution: { provider: 'google_geocoding_geo_tz' },
  } });
  assert.equal((await run()).statusCode, 500);
  assert.equal(calls.rpc.length, 0);
});

test('existing address and timezone are captured for the stale-write guard', async () => {
  const { calls, run } = fixture({
    restaurant: { ...ADDRESS, operational_timezone: 'America/Chicago' },
  });
  assert.equal((await run()).statusCode, 200);
  assert.deepEqual(calls.rpc[0].args.p_expected, {
    ...ADDRESS, operational_timezone: 'America/Chicago',
  });
});

test('stale and foreign-owner database errors map to safe responses', async () => {
  for (const [code, status] of [
    ['40001', 409], ['42501', 403], ['22023', 422], ['XX000', 500],
  ]) {
    const { run } = fixture({
      rpcError: { code, message: 'Synthetic private database detail' },
    });
    const response = await run();
    assert.equal(response.statusCode, status);
    assert.doesNotMatch(response.body.error, /private database detail/);
  }
});

test('matching policy determines the queue request', async () => {
  const { calls, run } = fixture({ matching: false });
  assert.equal((await run()).statusCode, 200);
  assert.equal(calls.rpc[0].args.p_queue_calculations, false);
});

test('invalid matching policy stops before lookup or persistence', async () => {
  const { calls, run } = fixture({ policy: {} });
  assert.equal((await run()).statusCode, 500);
  assert.equal(calls.resolves.length, 0);
  assert.equal(calls.rpc.length, 0);
});

test('a persistence response for another restaurant is rejected', async () => {
  const { run } = fixture({ result: {
    success: true, changed: true, calculations_queued: true,
    restaurant: { id: FOREIGN, ...ADDRESS, operational_timezone: 'America/New_York' },
  } });
  assert.equal((await run()).statusCode, 500);
});

test('GET is rejected without database work', async () => {
  const { calls, run } = fixture();
  const response = await run(undefined, 'GET');
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'POST');
  assert.equal(calls.reads.length, 0);
});

test('an identical database retry is accepted without a new calculation job', async () => {
  const { run } = fixture({ result: {
    success: true, changed: false, calculations_queued: false,
    restaurant: { id: RID, ...ADDRESS, operational_timezone: 'America/New_York' },
  } });
  assert.equal((await run()).statusCode, 200);
});

test('an address change within the same timezone needs no pricing job', async () => {
  const { run } = fixture({
    restaurant: { operational_timezone: 'America/New_York' },
    result: {
      success: true, changed: true, calculations_queued: false,
      restaurant: { id: RID, ...ADDRESS, operational_timezone: 'America/New_York' },
    },
  });
  assert.equal((await run()).statusCode, 200);
});

test('unexpected calculation queue metadata is rejected', async () => {
  const { run } = fixture({ result: {
    success: true, changed: true, calculations_queued: false,
    restaurant: { id: RID, ...ADDRESS, operational_timezone: 'America/New_York' },
  } });
  assert.equal((await run()).statusCode, 500);
});

test('a matching client snapshot is accepted without trusting it as the new timezone', async () => {
  const { calls, run } = fixture();
  const response = await run({
    restaurant_id: RID, address: ADDRESS,
    expected: {
      shipping_address_line1: null, shipping_city: null,
      shipping_state: null, shipping_zip: null, operational_timezone: null,
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(calls.rpc[0].args.p_timezone, 'America/New_York');
});

test('an outdated or malformed client snapshot stops before a paid lookup', async () => {
  for (const [expected, status] of [
    [{ ...ADDRESS, operational_timezone: 'America/New_York' }, 409],
    [{ ...ADDRESS, operational_timezone: 'America/New_York', actor_id: FOREIGN }, 422],
    [null, 422],
  ]) {
    const { calls, run } = fixture();
    assert.equal((await run({
      restaurant_id: RID, address: ADDRESS, expected,
    })).statusCode, status);
    assert.equal(calls.resolves.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
});