import {
  normalizeShippingAddress,
  resolveShippingAddressTimezone,
} from '../../../lib/shippingAddressTimezone.js';
import { requireRestaurantTimezone } from '../../../lib/restaurantTime.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = [
  'shipping_address_line1', 'shipping_city', 'shipping_state', 'shipping_zip',
];

export function createSaveShippingAddressHandler({
  db,
  verifyAccess,
  resolveAddress = resolveShippingAddressTimezone,
  getMatchingPolicy = async (database, restaurantId) => {
    const { getProgressiveInvoiceMatchingPolicy } =
      await import('../../../lib/progressiveInvoiceMatching');
    return getProgressiveInvoiceMatchingPolicy(database, restaurantId);
  },
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).end();
    }

    let body;
    let address;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (
        !body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['restaurant_id', 'address', 'complete_onboarding', 'expected'].includes(key)) ||
        !UUID.test(body.restaurant_id || '') ||
        (body.complete_onboarding !== undefined && typeof body.complete_onboarding !== 'boolean')
      ) throw new Error('Invalid request');
      address = normalizeShippingAddress(body.address);
      if (Object.keys(body.address).some(key => !FIELDS.includes(key))) {
        throw new Error('Invalid address fields');
      }
      if (body.expected !== undefined) {
        const keys = [...FIELDS, 'operational_timezone'];
        if (
          !body.expected || typeof body.expected !== 'object' || Array.isArray(body.expected) ||
          Object.keys(body.expected).length !== keys.length ||
          keys.some(key => !Object.hasOwn(body.expected, key) || (
            body.expected[key] !== null && typeof body.expected[key] !== 'string'
          ))
        ) throw new Error('Invalid expected address');
      }
    } catch {
      return res.status(422).json({ error: 'A restaurant ID and complete shipping address are required.' });
    }

    try {
      const access = verifyAccess
        ? await verifyAccess(req, body.restaurant_id)
        : await import('../../../lib/withRestaurantAuth')
            .then(module => module.verifyRestaurantAccess(req, body.restaurant_id));
      if (access.error) {
        return res.status(access.status || 403).json({ error: access.error });
      }
      if (!access.user?.id || !UUID.test(access.user.id)) {
        return res.status(401).json({ error: 'Unauthorized.' });
      }

      const database = db || await import('@supabase/supabase-js')
        .then(({ createClient }) => createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        ));
      const { data: restaurant, error: readError } = await database
        .from('restaurants')
        .select('id, user_id, deactivated_at, shipping_address_line1, shipping_city, shipping_state, shipping_zip, operational_timezone')
        .eq('id', body.restaurant_id)
        .maybeSingle();
      if (readError) {
        return res.status(503).json({ error: 'Could not load the restaurant. Please try again.' });
      }
      if (!restaurant || restaurant.id !== body.restaurant_id) {
        return res.status(404).json({ error: 'Restaurant not found.' });
      }
      if (restaurant.user_id !== access.user.id || restaurant.deactivated_at) {
        return res.status(403).json({ error: 'Only the active restaurant owner can change the shipping address.' });
      }

      const expected = Object.fromEntries(
        [...FIELDS, 'operational_timezone'].map(key => [key, restaurant[key] ?? null])
      );
      if (body.expected && Object.keys(expected).some(key => expected[key] !== body.expected[key])) {
        return res.status(409).json({ error: 'The restaurant address changed. Reload before saving again.' });
      }
      const policy = await getMatchingPolicy(database, body.restaurant_id);
      if (typeof policy?.matching_enabled !== 'boolean') throw new Error('Policy unavailable');

      let resolved;
      try {
        resolved = await resolveAddress(address);
      } catch (error) {
        const known = [
          'ADDRESS_INVALID', 'ADDRESS_LOOKUP_NOT_CONFIGURED', 'ADDRESS_LOOKUP_UNAVAILABLE',
          'ADDRESS_NOT_FOUND', 'ADDRESS_AMBIGUOUS', 'ADDRESS_MISMATCH',
          'ADDRESS_INCOMPLETE_MATCH', 'TIMEZONE_LOOKUP_UNAVAILABLE', 'ADDRESS_TIMEZONE_UNRESOLVED',
        ];
        if (!known.includes(error.code)) throw error;
        return res.status(error.status === 503 ? 503 : 422).json({ error: error.message });
      }
      const timezone = requireRestaurantTimezone(resolved?.timezone);
      if (
        resolved?.resolution?.provider !== 'google_geocoding_geo_tz' ||
        FIELDS.some(key => resolved.address?.[key] !== address[key])
      ) throw new Error('Invalid address resolution');

      const { data: result, error } = await database.rpc(
        'save_restaurant_shipping_address',
        {
          p_restaurant_id: body.restaurant_id,
          p_actor_id: access.user.id,
          p_expected: expected,
          p_address: address,
          p_timezone: timezone,
          p_place_id: resolved.resolution.place_id ?? null,
          p_complete_onboarding: body.complete_onboarding === true,
          p_queue_calculations: policy.matching_enabled,
        }
      );
      if (error) {
        const [status, message] = {
          '40001': [409, 'The restaurant address changed. Reload before saving again.'],
          '42501': [403, 'Only the restaurant owner can change the shipping address.'],
          '22023': [422, 'The shipping address or time zone is invalid.'],
        }[error.code] || [500, 'The shipping address could not be saved.'];
        return res.status(status).json({ error: message });
      }
      if (
        result?.success !== true || typeof result.changed !== 'boolean' ||
        result.calculations_queued !== (
          result.changed && policy.matching_enabled &&
          restaurant.operational_timezone !== timezone
        ) ||
        result.restaurant?.id !== body.restaurant_id ||
        result.restaurant?.operational_timezone !== timezone ||
        FIELDS.some(key => result.restaurant?.[key] !== address[key])
      ) throw new Error('Unexpected address save result');
      return res.status(200).json(result);
    } catch {
      return res.status(500).json({ error: 'The shipping address could not be saved. Please try again.' });
    }
  };
}

export default createSaveShippingAddressHandler();