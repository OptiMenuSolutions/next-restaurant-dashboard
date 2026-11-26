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
import { syncPosConnection } from '../../../lib/pos/syncConnection.js';
import { sendCronAlert } from '../../../lib/cronAlert';

export const config = { maxDuration: 300 };

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

  const range = reqFrom && reqTo ? { from: reqFrom, to: reqTo } : defaultRange();

  try {
    const counts = await syncPosConnection(supabase, conn, range, { alertName: 'POS sync manual' });
    return res.status(200).json({
      synced: counts.rows, tickets: counts.tickets, lines: counts.lines,
      from: range.from, to: range.to,
    });
  } catch (err) {
    if (err.code === 'POS_SYNC_BUSY' || err.code === 'POS_SYNC_LOCK_UNAVAILABLE') {
      return res.status(err.code === 'POS_SYNC_BUSY' ? 409 : 503).json({
        error: err.message, code: err.code, retryable: true,
      });
    }

    console.error(`[pos/sync] ${conn.provider} sync failed for ${restaurantId}:`, err.message);
    if (conn.provider === 'shift4') {
      await sendCronAlert(
        'POS sync manual',
        'A manual Shift4 sync failed. The connection remains eligible for the next scheduled run.',
        [`shift4, restaurant ${restaurantId}, ${range.from} through ${range.to}: ${err.message}`]
      );
    }

    return res.status(502).json({ error: err.message });
  }
}