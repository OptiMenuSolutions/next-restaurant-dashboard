// pages/api/pos/shift4/disconnect.js
//
// POST with no body. Removes OptiMenu from the restaurant's Shift4 location
// (DELETE /marketplace/v2/locations/{id}, the partner-initiated uninstall in
// Shift4's docs) and marks the pos_connections row disconnected so the cron
// stops syncing it. Sales already in pos_sales are kept.

import shift4 from '../../../../lib/pos/providers/shift4';
import { supabaseAdmin, getRestaurantIdForRequest, getShift4Connection } from '../../../../lib/pos/shift4-connect';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const restaurantId = await getRestaurantIdForRequest(req);
  if (!restaurantId) return res.status(401).json({ error: 'Unauthorized' });

  const conn = await getShift4Connection(restaurantId);
  if (!conn) return res.status(200).json({ ok: true });

  if (conn.shift4_location_id) {
    try {
      await shift4.removeInstallation(conn.shift4_location_id);
    } catch (err) {
      console.error('[pos/shift4/disconnect]', err.message);
      return res.status(502).json({ error: 'Shift4 could not disconnect this location. Please try again.' });
    }
  }

  const { error } = await supabaseAdmin
    .from('pos_connections')
    .update({
      status: 'disconnected',
      shift4_location_id: null,
      access_token: null,
      refresh_token: null,
      expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}