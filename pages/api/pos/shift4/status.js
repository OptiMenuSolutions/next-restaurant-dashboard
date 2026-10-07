// pages/api/pos/shift4/status.js
//
// GET. Returns the signed-in restaurant's Shift4 connection for the profile
// page: status, last sync time, and last error. Never returns tokens, which
// is why the browser asks this route instead of reading pos_connections.

import { getRestaurantIdForRequest, getShift4Connection } from '../../../../lib/pos/shift4-connect';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const restaurantId = await getRestaurantIdForRequest(req);
  if (!restaurantId) return res.status(401).json({ error: 'Unauthorized' });

  const conn = await getShift4Connection(restaurantId);
  if (!conn) return res.status(200).json({ connection: null });

  return res.status(200).json({
    connection: {
      status: conn.status,
      lastSyncedAt: conn.last_synced_at || null,
      lastError: conn.last_error || null,
    },
  });
}