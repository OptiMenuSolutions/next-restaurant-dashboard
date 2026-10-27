// pages/api/cron/sync-all-pos.js
//
// Unified daily POS sync for all providers (Square, Shift4, etc.)
// Handles both OAuth2 (Square) and HMAC (Shift4) auth patterns.

import { createClient } from '@supabase/supabase-js';
import { getProvider } from '../../../lib/pos/registry';
import { sendCronAlert } from '../../../lib/cronAlert';
import { saveTickets } from '../../../lib/pos/saveTickets';
import { runUsage } from '../../../lib/pos/runUsage';
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

async function syncConnection(conn, range) {
  const provider = getProvider(conn.provider);

  let connection = conn;

  // ─── Handle OAuth2 refresh (Square, etc.) ───────────────────────────────
  // Not Shift4: its sales use HMAC, and its tokens are renewed by the
  // refresh-shift4-tokens job, so a sign-in problem never blocks a sales sync.
  if (provider.authType === 'oauth2' && conn.expires_at && conn.provider !== 'shift4') {
    const soon = new Date(Date.now() + 5 * 60 * 1000);
    if (new Date(conn.expires_at) < soon) {
      const refreshed = await provider.refresh(conn);
      if (refreshed) {
        await supabase
          .from('pos_connections')
          .update({
            access_token: refreshed.accessToken,
            expires_at: refreshed.expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conn.id);
        connection = { ...conn, access_token: refreshed.accessToken, expires_at: refreshed.expiresAt };
      }
    }
  }

  // ─── Fetch sales (and raw tickets, if the provider supports it) ─────────
  let records;
  let tickets = null;
  if (typeof provider.fetchSalesAndTickets === 'function') {
    const result = await provider.fetchSalesAndTickets(connection, range);
    records = result.sales;
    tickets = result.tickets;
  } else {
    records = await provider.fetchSales(connection, range);
  }

  // ─── Delete old records in date range (except user uploads) ────────────
  const { error: deleteError } = await supabase
    .from('pos_sales')
    .delete()
    .eq('restaurant_id', conn.restaurant_id)
    .eq('pos_system', conn.provider)
    .is('upload_session_id', null)
    .gte('sale_date', range.from)
    .lte('sale_date', range.to);
  if (deleteError) throw new Error(`pos_sales delete failed: ${deleteError.message}`);

  // ─── Insert new records ───────────────────────────────────────────────
  if (records.length) {
    const rows = records.map((r) => ({
      ...r,
      restaurant_id: conn.restaurant_id,
      pos_system: conn.provider,
      upload_session_id: null,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: insertError } = await supabase.from('pos_sales').insert(rows.slice(i, i + 500));
      if (insertError) throw new Error(`pos_sales insert failed: ${insertError.message}`);
    }
  }

  // ─── Save raw tickets and lines ─────────────────────────────────────────
  // A failure here alerts but does not fail the connection: pos_sales is
  // already saved, and marking the connection error would stop future syncs.
  let ticketCounts = { tickets: 0, lines: 0 };
  if (tickets) {
    try {
      ticketCounts = await saveTickets(supabase, {
        restaurantId: conn.restaurant_id,
        posSystem: conn.provider,
        tickets,
      });
    } catch (err) {
      console.error(`[cron:sync-all-pos] ticket save failed for ${conn.restaurant_id}:`, err.message);
      await sendCronAlert('POS sync cron', `Sales synced but raw tickets failed to save for restaurant ${conn.restaurant_id}.`, [err.message]);
    }
  }

  // ─── Update connection status ──────────────────────────────────────────
  await supabase
    .from('pos_connections')
    .update({
      last_synced_at: new Date().toISOString(),
      status: 'connected',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id);

  let usage = null;

  if (conn.provider === 'shift4') {
    try {
      usage = await runUsage(
        supabase,
        conn.restaurant_id
      );

      if (usage.error) throw new Error(usage.error);
    } catch (error) {
      usage = { error: error.message };

      console.error(
        '[pos-usage:after-sync]',
        conn.restaurant_id,
        error.message
      );

      await sendCronAlert(
        'POS ingredient usage',
        `Sales saved for ${conn.restaurant_id}, but ingredient usage needs a retry.`,
        [error.message]
      );
    }
  }

  return {
    rows: records.length,
    ...ticketCounts,
    usage,
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

  for (const conn of live) {
    try {
      const counts = await syncConnection(conn, range);
      results.success.push({ restaurantId: conn.restaurant_id, provider: conn.provider, ...counts });
      console.log(`[cron:sync-all-pos] ✓ ${conn.provider} for ${conn.restaurant_id} — ${counts.rows} sales rows, ${counts.tickets} tickets, ${counts.lines} lines`);
    } catch (err) {
      results.failed.push({ restaurantId: conn.restaurant_id, provider: conn.provider, error: err.message });
      console.error(`[cron:sync-all-pos] ✗ ${conn.provider} for ${conn.restaurant_id}:`, err.message);
      const failureUpdate = {
        last_error: err.message,
        updated_at: new Date().toISOString(),
      };

      // Shift4 sales use app-level HMAC credentials. A sync failure does
      // not establish that the merchant disconnected or must sign in again.
      if (conn.provider !== 'shift4') {
        failureUpdate.status = 'error';
      }

      const { error: statusError } = await supabase
        .from('pos_connections')
        .update(failureUpdate)
        .eq('id', conn.id);

      if (statusError) {
        console.error(
          `[cron:sync-all-pos] Could not record sync failure for ${conn.restaurant_id}:`,
          statusError.message
        );
      }
    }
  }

  console.log(`[cron:sync-all-pos] Done — ${results.success.length} synced, ${results.failed.length} failed`);
  if (results.failed.length) {
    await sendCronAlert(
      'POS sync cron',
      `${results.failed.length} of ${live.length} POS connections failed to sync. Shift4 links remain connected and will retry on the next run. Check the individual errors before requesting reconnection.`,
      results.failed.map(f => `${f.provider}, restaurant ${f.restaurantId}: ${f.error}`)
    );
  }
  return res.status(200).json({ synced: results.success.length, failed: results.failed.length, results });
}

export default withJobRun('sync-all-pos', handler);