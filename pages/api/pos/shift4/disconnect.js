// pages/api/pos/shift4/disconnect.js
//
// POST with no body. Removes OptiMenu from the restaurant's Shift4 location
// (DELETE /marketplace/v2/locations/{id}, the partner-initiated uninstall in
// Shift4's docs) and marks the pos_connections row disconnected so the cron
// stops syncing it. Sales already in pos_sales are kept.

import shift4 from '../../../../lib/pos/providers/shift4';
import { supabaseAdmin, getRestaurantIdForRequest, getShift4Connection } from '../../../../lib/pos/shift4-connect';
import { disconnectedShift4State, updateShift4Connection } from '../../../../lib/pos/shift4-state';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const restaurantId = await getRestaurantIdForRequest(req);
  if (!restaurantId) return res.status(401).json({ error: 'Unauthorized' });

  const conn = await getShift4Connection(restaurantId);
  if (!conn) return res.status(200).json({ ok: true });
  if (conn.status === 'disconnected') return res.status(200).json({ ok: true });
  if (conn.status === 'installing') return res.status(409).json({
    error: 'Installation is in progress. Finish or retry installation before disconnecting.',
  });

  // Claim the lifecycle operation before calling Shift4. Sync persistence and
  // token refresh cannot write through this state while DELETE is in flight.
  let claimed = conn;
  if (conn.status !== 'disconnecting') {
    const saved = await updateShift4Connection(supabaseAdmin, conn, {
      status: 'disconnecting', updated_at: new Date().toISOString(),
    });
    if (!saved) return res.status(409).json({ error: 'The connection changed. Reload and try again.' });
    claimed = { ...conn, status: 'disconnecting' };
  }

  if (conn.shift4_location_id) {
    try {
      await shift4.removeInstallation(conn.shift4_location_id);
    } catch (err) {
      // A 404 means Shift4 already removed OptiMenu from this location, so
      // finish the disconnect on our side instead of leaving the owner stuck.
      const gone = err.status === 404 || /\b404\b|not found/i.test(String(err.message));
      console.error('[pos/shift4/disconnect]', err.message);
      if (!gone) {
        // Keep disconnecting on an ambiguous network/API failure: the remote
        // removal may have happened. Retrying DELETE is safe; syncing is paused.
        return res.status(502).json({ error: 'Shift4 could not confirm disconnection. Sales syncing is paused; retry Disconnect.' });
      }
    }
  }

  try {
    const saved = await updateShift4Connection(supabaseAdmin, claimed, disconnectedShift4State());
    if (!saved) {
      const current = await getShift4Connection(restaurantId);
      if (current && current.status !== 'disconnected') return res.status(409).json({
        error: 'The connection changed during disconnect. Reload to check its current state.',
      });
    }
  } catch (error) { return res.status(500).json({ error: error.message }); }
  return res.status(200).json({ ok: true });
}
