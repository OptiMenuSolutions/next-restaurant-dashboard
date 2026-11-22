import { shiftProjectionDate } from './businessTime.js';
import { shift4ProjectionSnapshot } from './shift4Source.js';

export function projectionJobError(code, message, kind = 'technical') {
  return Object.assign(new Error(message), { code, kind });
}

export function canonicalProjectionTimezone(zone) {
  try {
    if (typeof zone !== 'string' || !zone) throw new Error('Missing time zone');
    return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    throw projectionJobError(
      'PROJECTION_TIMEZONE_REQUIRED',
      'A valid operational/location time zone is required.',
      'setup'
    );
  }
}

export function createProjectionSourceReader(
  db,
  { provider, fetchTickets, now = () => new Date().toISOString() }
) {
  let locationRead;

  return async context => {
    if (!Array.isArray(context.connections) || !context.connections.length) {
      throw projectionJobError(
        'PROJECTION_SOURCE_MISSING',
        'No timestamped POS source covers this night.',
        'source'
      );
    }

    let locations;
    try {
      locations = await (locationRead ??= provider.listInstalledLocations({
        signal: context.signal,
      }));
    } catch (e) {
      locationRead = null;
      throw projectionJobError('PROJECTION_SOURCE_UNAVAILABLE', e.message, 'source');
    }

    if (!Array.isArray(locations)) {
      throw projectionJobError(
        'PROJECTION_SOURCE_INVALID',
        'Invalid Shift4 location response.',
        'source'
      );
    }

    const sources = [];

    for (const source of context.connections) {
      if (source.provider !== 'shift4') {
        throw projectionJobError(
          'PROJECTION_PROVIDER_SETUP_REQUIRED',
          'This source needs a timestamped projection adapter.',
          'setup'
        );
      }

      const reply = await db.from('pos_connections')
        .select('id,restaurant_id,provider,shift4_location_id,shift4_timezone')
        .eq('restaurant_id', context.restaurant_id)
        .eq('id', source.id)
        .single();

      if (
        reply.error ||
        reply.data?.restaurant_id !== context.restaurant_id ||
        reply.data?.id !== source.id
      ) {
        throw projectionJobError(
          'PROJECTION_SOURCE_UNAVAILABLE',
          'The expected POS connection could not be loaded.',
          'source'
        );
      }

      const connection = reply.data;
      const location = locations.find(
        l => String(l.id) === String(connection.shift4_location_id)
      );

      if (!location) {
        throw projectionJobError(
          'PROJECTION_SOURCE_UNAVAILABLE',
          'Shift4 location is unavailable.',
          'source'
        );
      }

      const zone = canonicalProjectionTimezone(context.timezone);

      if (
        zone !== canonicalProjectionTimezone(location.timeZone) ||
        zone !== canonicalProjectionTimezone(connection.shift4_timezone)
      ) {
        throw projectionJobError(
          'PROJECTION_TIMEZONE_MISMATCH',
          'Shift4 location, connection and operational time zones must match.',
          'setup'
        );
      }

      try {
        const records = await fetchTickets(connection, {
          from: context.business_date,
          to: shiftProjectionDate(context.business_date, 1),
        }, { signal: context.signal });

        sources.push(...shift4ProjectionSnapshot({
          restaurantId: context.restaurant_id,
          connectionId: source.id,
          records,
          coverageFrom: context.window_from,
          coverageTo: context.window_to,
          observedAt: now(),
          complete: true,
        }).sources);
      } catch (e) {
        throw projectionJobError('PROJECTION_SOURCE_UNAVAILABLE', e.message, 'source');
      }
    }

    return {
      restaurant_id: context.restaurant_id,
      observed_at: now(),
      sources,
    };
  };
}