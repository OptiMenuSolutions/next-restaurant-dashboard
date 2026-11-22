// Read-only rollout check. Never prints raw tickets, tokens or customer data.
import { createClient } from '@supabase/supabase-js';
import shift4, { createShift4ProjectionReader } from '../lib/pos/providers/shift4.js';
import { canonicalProjectionTimezone } from '../lib/projections/nightlySource.js';
import { shiftProjectionDate } from '../lib/projections/businessTime.js';

const [restaurantId, day] = process.argv.slice(2);

if (!/^[0-9a-f-]{36}$/i.test(restaurantId || '')) {
  throw new Error('Restaurant UUID required');
}
shiftProjectionDate(day, 0);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    'Load the existing server environment; no credentials should be pasted into this command.'
  );
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const restaurant = await db.from('restaurants')
  .select('id,operational_timezone')
  .eq('id', restaurantId)
  .single();

if (restaurant.error) throw new Error(restaurant.error.message);

const connections = await db.from('pos_connections')
  .select('id,restaurant_id,shift4_location_id,shift4_timezone')
  .eq('restaurant_id', restaurantId)
  .eq('provider', 'shift4')
  .eq('status', 'connected');

if (connections.error || !connections.data?.length) {
  throw new Error('No Shift4 connection found');
}

const locations = await shift4.listInstalledLocations({
  signal: AbortSignal.timeout(20000),
});

let verified = true;

for (const connection of connections.data) {
  const location = locations.find(
    l => String(l.id) === String(connection.shift4_location_id)
  );
  const zone = canonicalProjectionTimezone(restaurant.data.operational_timezone);

  if (
    zone !== canonicalProjectionTimezone(location?.timeZone) ||
    zone !== canonicalProjectionTimezone(connection.shift4_timezone)
  ) {
    throw new Error('Operational, connection and actual location timezones differ');
  }

  const pages = [];
  const records = await createShift4ProjectionReader({
    onPagination: meta => pages.push(meta),
  })(connection, {
    from: day,
    to: shiftProjectionDate(day, 1),
  }, {
    signal: AbortSignal.timeout(120000),
  });

  const total = pages.at(-1)?.total;
  const totalVerified = total !== null && total !== undefined &&
    total === records.tickets.length;

  verified &&= totalVerified && pages.length > 1;

  console.log(JSON.stringify({
    restaurant_id: restaurantId,
    connection_id: connection.id,
    from: day,
    through: shiftProjectionDate(day, 1),
    tickets: records.tickets.length,
    pages,
    total_verified: totalVerified,
    multi_page_verified: totalVerified && pages.length > 1,
  }, null, 2));
}

if (!verified) {
  console.error(
    'REVIEW REQUIRED: totals or multi-page traversal remain unverified. Confirm the real pagination/terminal-page contract before enabling projections.'
  );
  process.exitCode = 2;
} else {
  console.log(
    'PASS: every page reconciles to the provider total and multi-page traversal was exercised. No records changed.'
  );
}