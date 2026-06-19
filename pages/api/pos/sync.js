// pages/api/pos/sync.js
//
// Pull sales from a restaurant's connected POS and write them into pos_sales.
// Provider-agnostic: looks up the connection, dispatches to the right adapter,
// then replaces this provider's API rows for the date range (idempotent re-run).
//
// Idempotency / source separation: API-sourced rows are the ONLY pos_sales rows
// with upload_session_id IS NULL. CSV uploads always carry an upload_session_id.
// So the delete below scopes to (restaurant, provider, NULL session, date range)
// and can never clobber CSV-uploaded history. Once a restaurant is on live API
// sync, stop CSV-uploading the same dates to avoid double-counting in the engine
// (which reads ALL pos_sales rows for the trailing window regardless of source).

import { createClient } from '@supabase/supabase-js';
import { getProvider } from '../../../lib/pos/registry';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function defaultRange(days = 14) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth: Bearer token + ownership (same pattern as ai-recommendations) ──────
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { restaurantId, from: reqFrom, to: reqTo } = req.body || {};
  if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('restaurant_id')
    .eq('id', user.id)
    .single();
  if (!profile || profile.restaurant_id !== restaurantId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // ── Load the connection ──────────────────────────────────────────────────────
  const { data: conn } = await supabase
    .from('pos_connections')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .single();

  if (!conn) return res.status(400).json({ error: 'No POS connected for this restaurant' });
  if (conn.status !== 'connected') {
    return res.status(400).json({ error: `POS connection is "${conn.status}", not connected` });
  }

  const provider = getProvider(conn.provider);
  const range = reqFrom && reqTo ? { from: reqFrom, to: reqTo } : defaultRange();

  try {
    // ── Refresh the access token if it is an OAuth provider and near expiry ─────
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

    // ── Pull + normalize ─────────────────────────────────────────────────────--
    const records = await provider.fetchSales(connection, range);

    // ── Idempotent replace of this provider's API rows in the range ────────────
    await supabase
      .from('pos_sales')
      .delete()
      .eq('restaurant_id', restaurantId)
      .eq('pos_system', conn.provider)
      .is('upload_session_id', null)
      .gte('sale_date', range.from)
      .lte('sale_date', range.to);

    if (records.length) {
      const rows = records.map(r => ({
        ...r,
        restaurant_id: restaurantId,
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

    return res.status(200).json({ synced: records.length, from: range.from, to: range.to });

  } catch (err) {
    console.error(`[pos/sync] ${conn.provider} sync failed for ${restaurantId}:`, err.message);
    await supabase
      .from('pos_connections')
      .update({ status: 'error', last_error: err.message, updated_at: new Date().toISOString() })
      .eq('id', conn.id);
    return res.status(502).json({ error: err.message });
  }
}