import {
  loadRestaurantTimezone,
  restaurantLocalDate,
} from '../../../lib/restaurantTime.js';

export function createCountContextHandler({ db, verifyOwner } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed.' });
    }

    try {
      const services = !db || !verifyOwner
        ? await import('../../../lib/scannerAuth')
        : null;
      const database = db || services.admin;
      const authenticate = verifyOwner || services.requireOwner;
      const auth = await authenticate(req);

      if (auth.error) {
        return res.status(auth.status || 401).json({ error: auth.error });
      }
      if (!auth.restaurant?.id) {
        return res.status(401).json({ error: 'Please sign in again.' });
      }

      const timezone = await loadRestaurantTimezone(
        database,
        auth.restaurant.id
      );

      return res.status(200).json({
        timezone,
        today: restaurantLocalDate(timezone),
      });
    } catch (error) {
      const needsConfiguration = [
        'RESTAURANT_TIMEZONE_REQUIRED',
        'RESTAURANT_TIMEZONE_INVALID',
      ].includes(error.code);

      console.error('[inventory/count-context]', error.message);

      return res.status(needsConfiguration ? 422 : 503).json({
        code: error.code || 'RESTAURANT_TIMEZONE_LOAD_FAILED',
        error: needsConfiguration
          ? 'Configure the restaurant time zone in Restaurant settings before reviewing a count.'
          : 'Could not load the restaurant local date. Please retry.',
      });
    }
  };
}

export default createCountContextHandler();