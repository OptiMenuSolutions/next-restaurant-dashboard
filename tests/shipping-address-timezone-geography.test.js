import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveShippingAddressTimezone } from '../lib/shippingAddressTimezone.js';

// Google responses are mocked. Geographic timezone lookups use the real package.
for (const [city, state, zip, latitude, longitude, expected] of [
  ['Trenton', 'NJ', '08608', 40.2171, -74.7429, 'America/New_York'],
  ['Miami', 'FL', '33130', 25.7617, -80.1918, 'America/New_York'],
  ['Pensacola', 'FL', '32501', 30.4213, -87.2169, 'America/Chicago'],
  ['Phoenix', 'AZ', '85004', 33.4484, -112.0740, 'America/Phoenix'],
  ['Los Angeles', 'CA', '90012', 34.0522, -118.2437, 'America/Los_Angeles'],
  ['Honolulu', 'HI', '96813', 21.3099, -157.8581, 'Pacific/Honolulu'],
  ['Anchorage', 'AK', '99501', 61.2181, -149.9003, 'America/Anchorage'],
]) {
  test(city + ' resolves using real geographic timezone boundaries', async () => {
    const result = await resolveShippingAddressTimezone({
      shipping_address_line1: '1 Synthetic Test Street',
      shipping_city: city,
      shipping_state: state,
      shipping_zip: zip,
    }, {
      apiKey: 'synthetic-test-key',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ status: 'OK', results: [{
          address_components: [
            { types: ['country'], short_name: 'US' },
            { types: ['administrative_area_level_1'], short_name: state },
            { types: ['postal_code'], short_name: zip },
            { types: ['street_number'], long_name: '1' },
            { types: ['route'], long_name: 'Synthetic Test Street' },
          ],
          types: ['street_address'],
          geometry: {
            location_type: 'ROOFTOP',
            location: { lat: latitude, lng: longitude },
          },
        }] }),
      }),
    });
    assert.equal(result.timezone, expected);
  });
}