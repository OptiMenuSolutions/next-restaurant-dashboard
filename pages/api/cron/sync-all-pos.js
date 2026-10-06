// pages/api/cron/sync-all-pos.js
//
// Unified daily POS sync for all providers (Square, Shift4, etc.)
// Handles both OAuth2 (Square) and HMAC (Shift4) auth patterns.

import { createClient } from '@supabase/supabase-js';
import { getProvider } from '../../../lib/pos/registry';
import { sendCronAlert } from '../../../lib/cronAlert';

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
  if (provider.authType === 'oauth2' && conn.expires_at) {
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

  // ─── Fetch sales from provider ──────────────────────────────────────────
  const records = await provider.fetchSales(connection, range);

  // ─── Delete old records in date range (except user uploads) ────────────
  await supabase
    .from('pos_sales')
    .delete()
    .eq('restaurant_id', conn.restaurant_id)
    .eq('pos_system', conn.provider)
    .is('upload_session_id', null)
    .gte('sale_date', range.from)
    .lte('sale_date', range.to);

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

  return records.length;
}

export default async function handler(req, res) {
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
  if (!connections?.length) return res.status(200).json({ synced: 0 });

  const range = defaultRange();
  const results = { success: [], failed: [] };

  for (const conn of connections) {
    try {
      const rowCount = await syncConnection(conn, range);
      results.success.push({ restaurantId: conn.restaurant_id, provider: conn.provider, rows: rowCount });
      console.log(`[cron:sync-all-pos] ✓ ${conn.provider} for ${conn.restaurant_id} — ${rowCount} rows`);
    } catch (err) {
      results.failed.push({ restaurantId: conn.restaurant_id, provider: conn.provider, error: err.message });
      console.error(`[cron:sync-all-pos] ✗ ${conn.provider} for ${conn.restaurant_id}:`, err.message);
      await supabase
        .from('pos_connections')
        .update({ status: 'error', last_error: err.message, updated_at: new Date().toISOString() })
        .eq('id', conn.id);
    }
  }

  console.log(`[cron:sync-all-pos] Done — ${results.success.length} synced, ${results.failed.length} failed`);
  if (results.failed.length) {
    await sendCronAlert(
      'POS sync cron',
      `${results.failed.length} of ${connections.length} POS connections failed to sync. They are marked error and will not sync again until reconnected.`,
      results.failed.map(f => `${f.provider}, restaurant ${f.restaurantId}: ${f.error}`)
    );
  }
  return res.status(200).json({ synced: results.success.length, failed: results.failed.length, results });
}