// pages/api/cron/sync-all-pos.js
// Runs daily. pages/api/pos/sync.js only syncs one restaurant on-demand
// (triggered by an authenticated user, e.g. a "sync now" button) — nothing
// calls it automatically for every connected restaurant on a schedule. This
// is that missing piece: loop every `connected` pos_connections row and run
// the same sync logic pos/sync.js already implements.
//
// Deliberately NOT refactored to share code with pos/sync.js — that file
// was handed over already complete and working; duplicating its ~20 lines
// of sync logic here felt lower-risk than restructuring it into a shared
// helper this late. If you'd rather have one shared implementation, say so
// and I'll factor it out.
//
// SETUP REQUIRED: same CRON_SECRET pattern as the other cron jobs. Add to
// vercel.json's crons array — daily, after most of a restaurant's service
// hours are over, e.g.:
//   { "path": "/api/cron/sync-all-pos", "schedule": "0 8 * * *" }
// (08:00 UTC — adjust to your actual restaurants' timezone/closing time;
// this is a guess, not a confirmed-correct value.)

import { createClient } from '@supabase/supabase-js';
import { getProvider } from '../../../lib/pos/registry';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 3-day window, not 1 — catches any late-posting transactions from a
// previous day that hadn't settled yet at the time of the last sync,
// without needing to track a per-connection "last synced through" cursor.
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

  const records = await provider.fetchSales(connection, range);

  await supabase
    .from('pos_sales')
    .delete()
    .eq('restaurant_id', conn.restaurant_id)
    .eq('pos_system', conn.provider)
    .is('upload_session_id', null)
    .gte('sale_date', range.from)
    .lte('sale_date', range.to);

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
  return res.status(200).json({ synced: results.success.length, failed: results.failed.length, results });
}
