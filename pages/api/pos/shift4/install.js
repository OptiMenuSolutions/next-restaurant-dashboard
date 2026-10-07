// pages/api/pos/shift4/install.js
//
// Shift4 OAuth connect, step 4. POST { locationId } installs OptiMenu on the
// location the merchant picked, then marks the pos_connections row connected
// so the daily sync-all-pos cron starts pulling its sales.

import shift4 from '../../../../lib/pos/providers/shift4';
import { supabaseAdmin, getRestaurantIdForRequest, getShift4Connection } from '../../../../lib/pos/shift4-connect';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const restaurantId = await getRestaurantIdForRequest(req);
  if (!restaurantId) return res.status(401).json({ error: 'Unauthorized' });

  const locationId = Number(req.body?.locationId);
  if (!Number.isInteger(locationId)) return res.status(400).json({ error: 'locationId is required' });

  const conn = await getShift4Connection(restaurantId);
  if (!conn || conn.status !== 'pending' || !conn.access_token) {
    return res.status(409).json({
      error: 'There is no Shift4 connection in progress. Go back and click Connect Shift4 to start again.',
      restart: true,
    });
  }

  let target;
  try {
    // Re-check availability on the server so an unavailable location can never
    // be installed, even if the browser sends its id (certification test OA-007).
    const locations = await shift4.listLocations(conn.access_token);
    target = locations.find((l) => l.id === locationId);
    if (!target || !target.isAvailable) {
      return res.status(400).json({ error: 'That location cannot be connected to OptiMenu.' });
    }
    await shift4.installLocation(conn.access_token, locationId);
  } catch (err) {
    console.error('[pos/shift4/install]', err.message);
    if (err.status === 401) {
      return res.status(409).json({
        error: 'Your Shift4 sign-in has expired. Go back and click Connect Shift4 to start again.',
        restart: true,
      });
    }
    return res.status(502).json({ error: 'Shift4 could not connect that location. Please try again.' });
  }

  // The merchant token was only needed to list and install locations. Ongoing
  // sales syncs use OptiMenu's own HMAC credentials, so drop the token now
  // instead of storing it and refreshing it every 24 hours.
  const { error: updateError } = await supabaseAdmin
    .from('pos_connections')
    .update({
      status: 'connected',
      shift4_location_id: locationId,
      access_token: null,
      refresh_token: null,
      expires_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id);

  if (updateError) {
    console.error('[pos/shift4/install] Installed on Shift4 but could not save:', updateError.message);
    return res.status(500).json({ error: 'Connected in Shift4, but we could not save it. Please contact support.' });
  }

  return res.status(200).json({ ok: true, locationName: target.name });
}