// pages/api/cron/reconcile-shift4.js
//
// Daily Shift4 location reconciliation (certification test CORE-010). Runs at
// 07:00 UTC, an hour before sync-all-pos. One call to Shift4 lists every
// location installed for OptiMenu; we compare it with pos_connections:
//
//   - a connection whose location is no longer installed in Shift4 (an
//     uninstall webhook we missed) is set to disconnected, so the sync stops
//   - a location installed in Shift4 with no OptiMenu restaurant linked to it
//     is flagged in an alert email for a person to sort out
//   - each linked connection gets its location's time zone stored, which the
//     sync uses to date sales in the restaurant's local time (CORE-011)
//
// SETUP: add to vercel.json crons:
//   { "path": "/api/cron/reconcile-shift4", "schedule": "0 7 * * *" }

import { createClient } from '@supabase/supabase-js';
import shift4 from '../../../lib/pos/providers/shift4';
import { sendCronAlert } from '../../../lib/cronAlert';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let installed;
  try {
    installed = await shift4.listInstalledLocations();
  } catch (err) {
    console.error('[cron:reconcile-shift4] Could not list installed locations:', err.message);
    await sendCronAlert('Shift4 reconciliation', 'Could not load installed locations from Shift4, so nothing was checked today.', [err.message]);
    return res.status(500).json({ error: err.message });
  }

  const { data: connections, error } = await supabase
    .from('pos_connections')
    .select('id, restaurant_id, status, shift4_location_id, shift4_timezone')
    .eq('provider', 'shift4')
    .not('shift4_location_id', 'is', null);

  if (error) {
    console.error('[cron:reconcile-shift4] Could not load connections:', error.message);
    await sendCronAlert('Shift4 reconciliation', 'Could not load Shift4 connections from the database, so nothing was checked today.', [error.message]);
    return res.status(500).json({ error: error.message });
  }

  const installedById = new Map(installed.map((l) => [l.id, l]));
  const linkedIds = new Set();
  const disconnected = [];
  const failures = [];
  let timeZonesSaved = 0;

  for (const conn of connections) {
    const locationId = Number(conn.shift4_location_id);
    const location = installedById.get(locationId);

    if (!location) {
      if (conn.status !== 'connected' && conn.status !== 'error') continue;
      const { error: updateError } = await supabase
        .from('pos_connections')
        .update({
          status: 'disconnected',
          shift4_location_id: null,
          last_error: 'No longer installed in Shift4 (found by the daily reconciliation)',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conn.id);
      if (updateError) failures.push(`restaurant ${conn.restaurant_id}: ${updateError.message}`);
      else disconnected.push(`location ${locationId}, restaurant ${conn.restaurant_id}`);
      continue;
    }

    linkedIds.add(locationId);
    if (location.timeZone && location.timeZone !== conn.shift4_timezone) {
      const { error: tzError } = await supabase
        .from('pos_connections')
        .update({ shift4_timezone: location.timeZone, updated_at: new Date().toISOString() })
        .eq('id', conn.id);
      if (tzError) failures.push(`time zone for restaurant ${conn.restaurant_id}: ${tzError.message}`);
      else timeZonesSaved++;
    }
  }

  const unlinked = installed.filter((l) => !linkedIds.has(l.id));

  if (disconnected.length) {
    await sendCronAlert(
      'Shift4 reconciliation',
      `${disconnected.length} connection(s) were no longer installed in Shift4 and have been set to disconnected. Their sales will stop syncing.`,
      disconnected
    );
  }
  if (unlinked.length) {
    await sendCronAlert(
      'Shift4 reconciliation',
      `${unlinked.length} Shift4 location(s) have OptiMenu installed but are not linked to any OptiMenu restaurant, so their sales are not syncing.`,
      unlinked.map((l) => `location ${l.id}${l.name ? ` (${l.name})` : ''}`)
    );
  }
  if (failures.length) {
    await sendCronAlert('Shift4 reconciliation', 'Some reconciliation updates could not be saved.', failures);
  }

  console.log(
    `[cron:reconcile-shift4] ${installed.length} installed, ${connections.length} connections, ` +
    `${disconnected.length} disconnected, ${unlinked.length} unlinked, ${timeZonesSaved} time zones saved`
  );
  return res.status(200).json({
    installed: installed.length,
    connections: connections.length,
    disconnected: disconnected.length,
    unlinked: unlinked.map((l) => l.id),
    timeZonesSaved,
  });
}