// pages/api/pos/shift4/locations.js
//
// Shift4 OAuth connect, step 3. The OAuth callback stored the merchant's
// short-lived access token on a pending pos_connections row. The location
// picker (pages/client/connect-shift4.js) calls this to list the Shift4
// locations OptiMenu can be installed on. The token never leaves the server.

import shift4 from '../../../../lib/pos/providers/shift4';
import { getRestaurantIdForRequest, getShift4Connection } from '../../../../lib/pos/shift4-connect';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const restaurantId = await getRestaurantIdForRequest(req);
  if (!restaurantId) return res.status(401).json({ error: 'Unauthorized' });

  const conn = await getShift4Connection(restaurantId);
  if (!conn || conn.status !== 'pending' || !conn.access_token) {
    return res.status(409).json({
      error: 'There is no Shift4 connection in progress. Go back and click Connect Shift4 to start again.',
      restart: true,
    });
  }

  try {
    const locations = await shift4.listLocations(conn.access_token);
    return res.status(200).json({ locations });
  } catch (err) {
    console.error('[pos/shift4/locations]', err.message);
    if (err.status === 401) {
      return res.status(409).json({
        error: 'Your Shift4 sign-in has expired. Go back and click Connect Shift4 to start again.',
        restart: true,
      });
    }
    return res.status(502).json({ error: 'Could not load your Shift4 locations. Please try again.' });
  }
}