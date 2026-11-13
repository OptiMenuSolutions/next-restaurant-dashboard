import { requireRestaurantTimezone } from './restaurantTime.js';

const STATES = new Set((
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA ' +
  'MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX ' +
  'UT VT VA WA WV WI WY PR VI GU AS MP'
).split(' '));

function fail(code, message, status = 422) {
  return Object.assign(new Error(message), { code, status });
}

export function normalizeShippingAddress(input) {
  const fields = [
    'shipping_address_line1', 'shipping_city', 'shipping_state', 'shipping_zip',
  ];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('ADDRESS_INVALID', 'Enter a complete shipping address.');
  }
  const address = {};
  for (const key of fields) {
    const value = input[key];
    if (
      typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) ||
      !value.trim() || value.length > (key === 'shipping_address_line1' ? 200 : 100)
    ) {
      throw fail('ADDRESS_INVALID', 'Enter a complete, valid shipping address.');
    }
    address[key] = value.trim().replace(/\s+/g, ' ');
  }
  address.shipping_state = address.shipping_state.toUpperCase();
  if (
    !STATES.has(address.shipping_state) ||
    !/^\d{5}(?:-\d{4})?$/.test(address.shipping_zip)
  ) {
    throw fail('ADDRESS_INVALID', 'Enter a valid U.S. state and ZIP code.');
  }
  return address;
}

async function geographicTimezones(latitude, longitude) {
  const module = await import('geo-tz');
  const find = module.find || module.default?.find;
  if (typeof find !== 'function') throw new Error('Timezone lookup unavailable');
  return find(latitude, longitude);
}

export async function resolveShippingAddressTimezone(input, {
  apiKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY,
  fetchImpl = globalThis.fetch,
  findTimezones = geographicTimezones,
} = {}) {
  const address = normalizeShippingAddress(input);
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw fail('ADDRESS_LOOKUP_NOT_CONFIGURED', 'Address lookup is not configured. Please contact support.', 503);
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.search = new URLSearchParams({
    address: [
      address.shipping_address_line1,
      address.shipping_city,
      address.shipping_state + ' ' + address.shipping_zip,
    ].join(', '),
    components: 'country:US',
    language: 'en',
    key: apiKey.trim(),
  }).toString();

  let payload;
  try {
    const response = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Geocoder request failed');
    payload = await response.json();
    if (
      !['OK', 'ZERO_RESULTS'].includes(payload?.status) ||
      !Array.isArray(payload.results)
    ) {
      throw new Error('Invalid or unsuccessful geocoder response');
    }
  } catch {
    // Never log the request URL: it contains the server API key.
    throw fail('ADDRESS_LOOKUP_UNAVAILABLE', 'Address lookup is temporarily unavailable. Please try again.', 503);
  }

  const matches = payload.results;
  if (payload.status === 'ZERO_RESULTS' || matches.length === 0) {
    throw fail('ADDRESS_NOT_FOUND', 'We could not locate that shipping address. Check it and try again.');
  }
  if (matches.length !== 1) {
    throw fail('ADDRESS_AMBIGUOUS', 'More than one address matched. Check the street, city, state and ZIP code.');
  }

  const match = matches[0];
  const components = Array.isArray(match?.address_components) ? match.address_components : [];
  const component = type => components.find(item => item?.types?.includes(type));
  if (
    component('country')?.short_name !== 'US' ||
    component('administrative_area_level_1')?.short_name !== address.shipping_state ||
    component('postal_code')?.short_name !== address.shipping_zip.slice(0, 5)
  ) {
    throw fail('ADDRESS_MISMATCH', 'The located address has a different country, state or ZIP code. Check your shipping address.');
  }
  if (
    match.partial_match === true ||
    !component('street_number')?.long_name ||
    !component('route')?.long_name ||
    !Array.isArray(match.types) ||
    !match.types.some(type => ['street_address', 'premise', 'subpremise'].includes(type)) ||
    !(
      ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(match.geometry?.location_type) ||
      (
        match.geometry?.location_type === 'GEOMETRIC_CENTER' &&
        match.types.some(type => ['premise', 'subpremise'].includes(type))
      )
    )
  ) {
    throw fail('ADDRESS_INCOMPLETE_MATCH', 'We could not locate the complete street address. Check it and try again.');
  }

  const latitude = match.geometry?.location?.lat;
  const longitude = match.geometry?.location?.lng;
  if (
    typeof latitude !== 'number' || !Number.isFinite(latitude) ||
    latitude < -90 || latitude > 90 ||
    typeof longitude !== 'number' || !Number.isFinite(longitude) ||
    longitude < -180 || longitude > 180
  ) {
    throw fail('ADDRESS_LOOKUP_UNAVAILABLE', 'Address lookup returned incomplete location data. Please try again.', 503);
  }

  let zones;
  try {
    zones = await findTimezones(latitude, longitude);
  } catch {
    throw fail('TIMEZONE_LOOKUP_UNAVAILABLE', 'We could not determine the address time zone. Please try again.', 503);
  }
  if (!Array.isArray(zones) || zones.length !== 1) {
    throw fail('ADDRESS_TIMEZONE_UNRESOLVED', 'We could not determine one time zone for that address. Please check the address.');
  }

  let timezone;
  try {
    timezone = requireRestaurantTimezone(zones[0]);
    if (/^Etc\//.test(timezone)) throw new Error('Location is outside a regional timezone');
  } catch {
    throw fail('ADDRESS_TIMEZONE_UNRESOLVED', 'We could not determine a valid regional time zone for that address.');
  }

  return {
    address,
    timezone,
    resolution: {
      provider: 'google_geocoding_geo_tz',
      place_id: typeof match.place_id === 'string' ? match.place_id : null,
    },
  };
}