import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeShippingAddress,
  resolveShippingAddressTimezone,
} from '../lib/shippingAddressTimezone.js';

const ADDRESS = {
  shipping_address_line1: '1 Test Street',
  shipping_city: 'Trenton',
  shipping_state: 'NJ',
  shipping_zip: '08608',
};

function components(state = 'NJ', zip = '08608', country = 'US') {
  return [
    { types: ['country'], short_name: country },
    { types: ['administrative_area_level_1'], short_name: state },
    { types: ['postal_code'], short_name: zip },
    { types: ['street_number'], long_name: '1' },
    { types: ['route'], long_name: 'Test Street' },
  ];
}

function match(overrides = {}) {
  return {
    place_id: 'synthetic-place',
    address_components: components(),
    types: ['street_address'],
    geometry: {
      location_type: 'ROOFTOP',
      location: { lat: 40.2171, lng: -74.7429 },
    },
    ...overrides,
  };
}

function dependencies({ matches = [match()], zones = ['America/New_York'] } = {}) {
  const calls = [];
  return {
    calls,
    apiKey: 'synthetic-test-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ status: 'OK', results: matches }) };
    },
    findTimezones: async (latitude, longitude) => {
      calls.push({ latitude, longitude });
      return zones;
    },
  };
}

test('normalization preserves the supplied address and ZIP+4', () => {
  const input = {
    ...ADDRESS,
    shipping_address_line1: '  1   Test Street  ',
    shipping_state: 'nj',
    shipping_zip: '08608-1234',
  };
  assert.deepEqual(normalizeShippingAddress(input), {
    ...ADDRESS, shipping_zip: '08608-1234',
  });
  assert.equal(input.shipping_state, 'nj');
});

test('invalid or incomplete addresses fail before any external lookup', async () => {
  const invalid = [null, [], {},
    { ...ADDRESS, shipping_address_line1: '' },
    { ...ADDRESS, shipping_city: 123 },
    { ...ADDRESS, shipping_address_line1: '1 Test\nStreet' },
    { ...ADDRESS, shipping_state: 'XX' },
    { ...ADDRESS, shipping_zip: '8608' },
    { ...ADDRESS, shipping_zip: '08608-extra' },
  ];
  for (const address of invalid) {
    const deps = dependencies();
    await assert.rejects(resolveShippingAddressTimezone(address, deps), {
      code: 'ADDRESS_INVALID', status: 422,
    });
    assert.equal(deps.calls.length, 0);
  }
});

test('full address goes only to the fixed Google endpoint with a timeout', async () => {
  const deps = dependencies();
  await resolveShippingAddressTimezone(ADDRESS, deps);
  const url = new URL(deps.calls[0].url);
  assert.equal(url.origin, 'https://maps.googleapis.com');
  assert.equal(url.pathname, '/maps/api/geocode/json');
  assert.equal(url.searchParams.get('address'), '1 Test Street, Trenton, NJ 08608');
  assert.equal(url.searchParams.get('components'), 'country:US');
  assert.equal(url.searchParams.get('key'), 'synthetic-test-key');
  assert.equal(deps.calls[0].options.cache, 'no-store');
  assert.equal(deps.calls[0].options.redirect, 'error');
  assert.ok(deps.calls[0].options.signal instanceof AbortSignal);
});

test('one matching address resolves through its coordinates and returns provenance', async () => {
  const deps = dependencies();
  const result = await resolveShippingAddressTimezone(ADDRESS, deps);
  assert.equal(result.timezone, 'America/New_York');
  assert.deepEqual(result.address, ADDRESS);
  assert.deepEqual(deps.calls[1], { latitude: 40.2171, longitude: -74.7429 });
  assert.deepEqual(result.resolution, {
    provider: 'google_geocoding_geo_tz', place_id: 'synthetic-place',
  });
});

for (const [label, matches, code] of [
  ['no address match', [], 'ADDRESS_NOT_FOUND'],
  ['multiple address matches', [match(), match()], 'ADDRESS_AMBIGUOUS'],
  ['different country', [match({ address_components: components('NJ', '08608', 'CA') })], 'ADDRESS_MISMATCH'],
  ['different state', [match({ address_components: components('NY') })], 'ADDRESS_MISMATCH'],
  ['different ZIP', [match({ address_components: components('NJ', '08609') })], 'ADDRESS_MISMATCH'],
]) {
  test(label + ' never selects a guessed timezone', async () => {
    const deps = dependencies({ matches });
    await assert.rejects(resolveShippingAddressTimezone(ADDRESS, deps), { code, status: 422 });
    assert.equal(deps.calls.length, 1);
  });
}

test('incomplete and invalid geocoder coordinates are rejected', async () => {
  for (const coordinates of [null, {}, { lat: '40', lng: -74 },
    { lat: NaN, lng: -74 }, { lat: 91, lng: -74 }, { lat: 40, lng: -181 }]) {
    const deps = dependencies({
      matches: [match({
        geometry: { location_type: 'ROOFTOP', location: coordinates },
      })],
    });
    await assert.rejects(resolveShippingAddressTimezone(ADDRESS, deps), {
      code: 'ADDRESS_LOOKUP_UNAVAILABLE', status: 503,
    });
    assert.equal(deps.calls.length, 1);
  }
});

test('network, HTTP, JSON and malformed-response failures remain retryable', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('Synthetic network failure'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new Error('Invalid JSON'); } }),
    async () => ({ ok: true, json: async () => ({ result: {} }) }),
  ]) {
    await assert.rejects(resolveShippingAddressTimezone(ADDRESS, {
      ...dependencies(), fetchImpl,
    }), { code: 'ADDRESS_LOOKUP_UNAVAILABLE', status: 503 });
  }
});

test('missing, ambiguous, invalid and ocean timezones never receive a fallback', async () => {
  for (const zones of [[], ['America/New_York', 'America/Chicago'],
    ['EST'], ['Mars/Restaurant'], ['Etc/GMT+5'], null]) {
    await assert.rejects(resolveShippingAddressTimezone(ADDRESS, dependencies({ zones })), {
      code: 'ADDRESS_TIMEZONE_UNRESOLVED', status: 422,
    });
  }
});

test('timezone library failures remain retryable', async () => {
  await assert.rejects(resolveShippingAddressTimezone(ADDRESS, {
    ...dependencies(),
    findTimezones: async () => { throw new Error('Synthetic lookup failure'); },
  }), { code: 'TIMEZONE_LOOKUP_UNAVAILABLE', status: 503 });
});

test('missing server key fails before an external request', async () => {
  const deps = dependencies();
  await assert.rejects(resolveShippingAddressTimezone(ADDRESS, {
    ...deps, apiKey: '',
  }), { code: 'ADDRESS_LOOKUP_NOT_CONFIGURED', status: 503 });
  assert.equal(deps.calls.length, 0);
});

test('partial, coarse and incomplete street matches are rejected', async () => {
  for (const candidate of [
    match({ partial_match: true }),
    match({ types: ['postal_code'] }),
    match({ address_components: components().filter(c => !c.types.includes('street_number')) }),
    match({ geometry: { location_type: 'APPROXIMATE', location: { lat: 40, lng: -74 } } }),
    match({ geometry: { location_type: 'GEOMETRIC_CENTER', location: { lat: 40, lng: -74 } } }),
    match({ types: ['premise'], partial_match: true, geometry: { location_type: 'GEOMETRIC_CENTER', location: { lat: 40, lng: -74 } } }),
    match({ types: ['premise'], address_components: components().filter(c => !c.types.includes('route')), geometry: { location_type: 'GEOMETRIC_CENTER', location: { lat: 40, lng: -74 } } }),
  ]) {
    await assert.rejects(resolveShippingAddressTimezone(ADDRESS, dependencies({ matches: [candidate] })), {
      code: 'ADDRESS_INCOMPLETE_MATCH', status: 422,
    });
  }
});

test('Google API failures are retryable and do not expose provider details', async () => {
  for (const status of ['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT', 'UNKNOWN_ERROR']) {
    await assert.rejects(resolveShippingAddressTimezone(ADDRESS, {
      ...dependencies(),
      fetchImpl: async () => ({ ok: true, json: async () => ({
        status, results: [], error_message: 'Synthetic private provider detail',
      }) }),
    }), error => error.code === 'ADDRESS_LOOKUP_UNAVAILABLE' &&
      error.status === 503 && !error.message.includes('private provider detail'));
  }
});

test('Google ZERO_RESULTS is an address failure rather than a service failure', async () => {
  await assert.rejects(resolveShippingAddressTimezone(ADDRESS, {
    ...dependencies(),
    fetchImpl: async () => ({ ok: true, json: async () => ({
      status: 'ZERO_RESULTS', results: [],
    }) }),
  }), { code: 'ADDRESS_NOT_FOUND', status: 422 });
});

test('complete premise and subpremise centers are valid address locations', async () => {
  for (const types of [['premise', 'street_address'], ['subpremise']]) {
    const deps = dependencies({ matches: [match({
      types,
      geometry: {
        location_type: 'GEOMETRIC_CENTER',
        location: { lat: 40.2171, lng: -74.7429 },
      },
    })] });
    const result = await resolveShippingAddressTimezone(ADDRESS, deps);
    assert.equal(result.timezone, 'America/New_York');
    assert.deepEqual(deps.calls[1], {
      latitude: 40.2171,
      longitude: -74.7429,
    });
  }
});