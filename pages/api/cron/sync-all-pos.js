// pages/api/cron/sync-all-pos.js
//
// Unified daily POS sync for all providers (Square, Shift4, etc.)
// Handles both OAuth2 (Square) and HMAC (Shift4) auth patterns.

import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { sendCronAlert } from '../../../lib/cronAlert';
import { syncPosConnection } from '../../../lib/pos/syncConnection.js';
import { withJobRun } from '../../../lib/admin/jobRun';

export const config = { maxDuration: 300 };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function defaultRange(days = 3) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  };
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: connections, error } = await supabase
    .from('pos_connections')
    .select('*')
    .eq('status', 'connected');

  if (error) {
    console.error('[cron:sync-all-pos] Failed to fetch connections:', error.message);
    await sendCronAlert('POS sync cron', 'Could not load POS connections, so no sales were synced.', [error.message]);
    return res.status(500).json({ error: error.message });
  }
  // Deactivated accounts keep their connection for reactivation, but no
  // new sales are pulled during the 60-day retention window.
  const { data: paused, error: pausedError } = await supabase
    .from('restaurants')
    .select('id')
    .not('deactivated_at', 'is', null);

  if (pausedError) {
    console.error('[cron:sync-all-pos] Failed to load deactivated restaurants:', pausedError.message);
    await sendCronAlert('POS sync cron', 'Could not check for deactivated restaurants, so no sales were synced.', [pausedError.message]);
    return res.status(500).json({ error: pausedError.message });
  }

  const pausedIds = new Set((paused || []).map((row) => row.id));
  const live = (connections || []).filter((conn) => !pausedIds.has(conn.restaurant_id));

  if (!live.length) return res.status(200).json({ synced: 0 });

  const range = defaultRange();
  const results = { success: [], failed: [] };

  const busy = [];

  async function attempt(conn, allowRetry) {
    try {
      const { rows, tickets, lines, usage } = await syncPosConnection(supabase, conn, range);
      results.success.push({ restaurantId: conn.restaurant_id, provider: conn.provider, rows, tickets, lines, usage });
      console.log(`[cron:sync-all-pos] ✓ ${conn.provider} for ${conn.restaurant_id} — ${rows} sales rows, ${tickets} tickets, ${lines} lines`);
    } catch (err) {
      if (allowRetry && err.code === 'POS_SYNC_BUSY') {
        busy.push({ conn, retryAt: Date.now() + 60_000 });
        return;
      }

      const retryable = err.code === 'POS_SYNC_BUSY' || err.code === 'POS_SYNC_LOCK_UNAVAILABLE';
      results.failed.push({
        restaurantId: conn.restaurant_id,
        provider: conn.provider,
        error: err.message,
        ...(retryable ? { code: err.code, retryable: true } : {}),
      });
      console.error(`[cron:sync-all-pos] ✗ ${conn.provider} for ${conn.restaurant_id}:`, err.message);
    }
  }

  for (const conn of live) await attempt(conn, true);

  for (const { conn, retryAt } of busy) {
    const remaining = retryAt - Date.now();
    if (remaining > 0) await delay(remaining);
    await attempt(conn, false);
  }

  console.log(`[cron:sync-all-pos] Done — ${results.success.length} synced, ${results.failed.length} failed`);
  if (results.failed.length) {
    await sendCronAlert(
      'POS sync cron',
      `${results.failed.length} of ${live.length} POS connections failed to sync. Shift4 links remain connected and will retry on the next run. Check the individual errors before requesting reconnection.`,
      results.failed.map(f => `${f.provider}, restaurant ${f.restaurantId}, ${range.from} through ${range.to}: ${f.error}`)
    );
  }
  return res.status(200).json({ synced: results.success.length, failed: results.failed.length, results });
}

export default withJobRun('sync-all-pos', handler);