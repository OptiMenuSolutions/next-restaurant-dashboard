import test from 'node:test';
import assert from 'node:assert/strict';
import { saveShippingAddress } from '../lib/saveShippingAddress.js';

const RID = 'restaurant-test';
const ADDRESS = {
  shipping_address_line1: '1 Test Street', shipping_city: 'Trenton',
  shipping_state: 'NJ', shipping_zip: '08608',
};
const RESULT = {
  success: true,
  restaurant: {
    id: RID, ...ADDRESS, operational_timezone: 'America/New_York',
    onboarding_completed_at: '2026-11-12T12:00:00Z',
  },
};

function fixture({
  token = 'synthetic-token',
  authError = null,
  body = RESULT,
  status = 200,
} = {}) {
  const calls = [];
  return {
    calls,
    db: { auth: { getSession: async () => ({
      data: { session: token ? { access_token: token } : null },
      error: authError,
    }) } },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: status < 400, status, json: async () => body };
    },
  };
}

test('client sends the address and authenticated tenant without a client timezone', async () => {
  const f = fixture();
  const result = await saveShippingAddress(f.db, RID, {
    ...ADDRESS, timezone: 'UTC',
  }, {
    completeOnboarding: true, fetchImpl: f.fetchImpl,
  });
  assert.equal(result, RESULT);
  assert.equal(f.calls[0].url, '/api/account/save-shipping-address');
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer synthetic-token');
  assert.deepEqual(JSON.parse(f.calls[0].options.body), {
    restaurant_id: RID, address: ADDRESS, complete_onboarding: true,
  });
});

test('ordinary address correction does not request onboarding completion', async () => {
  const f = fixture();
  await saveShippingAddress(f.db, RID, ADDRESS, { fetchImpl: f.fetchImpl });
  assert.equal(JSON.parse(f.calls[0].options.body).complete_onboarding, false);
});

test('missing restaurant or authentication prevents a request', async () => {
  for (const [rid, options] of [
    [null, {}],
    [RID, { token: null }],
    [RID, { authError: new Error('Synthetic auth failure') }],
  ]) {
    const f = fixture(options);
    await assert.rejects(saveShippingAddress(f.db, rid, ADDRESS, {
      fetchImpl: f.fetchImpl,
    }));
    assert.equal(f.calls.length, 0);
  }
});

test('server validation and stale-write errors remain visible to the owner', async () => {
  for (const status of [422, 409, 503]) {
    const f = fixture({
      status, body: { error: 'Synthetic actionable error' },
    });
    await assert.rejects(saveShippingAddress(f.db, RID, ADDRESS, {
      fetchImpl: f.fetchImpl,
    }), {
      message: 'Synthetic actionable error', status,
    });
  }
});

test('a response for a different tenant is rejected', async () => {
  const f = fixture({
    body: {
      ...RESULT,
      restaurant: { ...RESULT.restaurant, id: 'foreign' },
    },
  });
  await assert.rejects(saveShippingAddress(f.db, RID, ADDRESS, {
    fetchImpl: f.fetchImpl,
  }), /Unexpected address save result/);
});

test('missing timezone or incomplete saved address is rejected', async () => {
  for (const patch of [
    { operational_timezone: null },
    { operational_timezone: '' },
    { shipping_zip: '' },
  ]) {
    const f = fixture({
      body: { ...RESULT, restaurant: { ...RESULT.restaurant, ...patch } },
    });
    await assert.rejects(saveShippingAddress(f.db, RID, ADDRESS, {
      fetchImpl: f.fetchImpl,
    }), /Unexpected address save result/);
  }
});

test('onboarding cannot advance without a saved completion timestamp', async () => {
  const f = fixture({
    body: {
      ...RESULT,
      restaurant: { ...RESULT.restaurant, onboarding_completed_at: null },
    },
  });
  await assert.rejects(saveShippingAddress(f.db, RID, ADDRESS, {
    completeOnboarding: true, fetchImpl: f.fetchImpl,
  }), /Unexpected address save result/);
});

test('unreadable response does not report a successful save', async () => {
  const f = fixture();
  await assert.rejects(saveShippingAddress(f.db, RID, ADDRESS, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => { throw new Error('Synthetic bad JSON'); },
    }),
  }), /response could not be read/);
});

test('address editor sends its original saved values for stale-edit detection', async () => {
  const f = fixture();
  const expected = {
    ...ADDRESS, operational_timezone: 'America/New_York',
  };
  await saveShippingAddress(f.db, RID, ADDRESS, {
    expected, fetchImpl: f.fetchImpl,
  });
  assert.deepEqual(JSON.parse(f.calls[0].options.body).expected, expected);
});