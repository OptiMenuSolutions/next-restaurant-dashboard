// pages/api/cron/refresh-shift4-tokens.js
// Keeps every Shift4 connection's OAuth sign-in alive (certification OA-009).
// Runs every 6 hours. A token that expires within the next 8 hours, or has no
// saved expiry, is renewed with grant_type=refresh_token, the new tokens are
// saved, and one Bearer call to Shift4 confirms the renewed token works.
// Run now on Jobs & health renews every token straight away.
//
// Sales syncs use OptiMenu's own HMAC keys, so a failed refresh never stops
// sales. It is saved on the connection (token_error), emailed as an alert,
// and shows on Jobs & health with a to-do on Today. A revoked or expired
// refresh token needs the owner to reconnect Shift4 from Profile.

import { createClient } from '@supabase/supabase-js';
import shift4 from '../../../lib/pos/providers/shift4';
import { sendCronAlert } from '../../../lib/cronAlert';
import { withJobRun } from '../../../lib/admin/jobRun';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DUE_WITHIN_MS = 8 * 60 * 60 * 1000;

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const force = req.query.manual === '1' || req.query.force === '1';
  const { data: conns, error } = await supabase
    .from('pos_connections')
    .select('id, restaurant_id, status, refresh_token, expires_at, restaurants(name)')
    .eq('provider', 'shift4')
    .in('status', ['connected', 'error'])
    .not('refresh_token', 'is', null);
  if (error) return res.status(500).json({ error: error.message });

  const due = (conns || []).filter((c) => force || !c.expires_at || new Date(c.expires_at).getTime() - Date.now() < DUE_WITHIN_MS);
  const refreshed = [];
  const failed = [];

  for (const c of due) {
    const now = new Date().toISOString();
    try {
      const t = await shift4.refresh(c);
      const { error: saveErr } = await supabase
        .from('pos_connections')
        .update({ access_token: t.accessToken, refresh_token: t.refreshToken, expires_at: t.expiresAt, token_refreshed_at: now, token_error: null, updated_at: now })
        .eq('id', c.id);
      if (saveErr) throw new Error(`renewed, but the new token could not be saved: ${saveErr.message}`);
      // One authenticated Bearer call proves the renewed token works.
      const locations = await shift4.listLocations(t.accessToken);
      refreshed.push({ restaurantId: c.restaurant_id, restaurant: c.restaurants?.name || null, expiresAt: t.expiresAt, locations: locations.length });
      console.log(`[cron:refresh-shift4-tokens] ✓ restaurant ${c.restaurant_id}, valid until ${t.expiresAt}`);
    } catch (err) {
      const msg = err.reauth
        ? `Shift4 sign-in could not be renewed (${err.message}). The owner needs to reconnect Shift4 from Profile. Sales keep syncing meanwhile.`
        : `Shift4 sign-in renewal failed (${err.message}). It tries again in 6 hours.`;
      console.error(`[cron:refresh-shift4-tokens] ✗ restaurant ${c.restaurant_id}:`, err.message);
      await supabase.from('pos_connections').update({ token_error: msg, updated_at: now }).eq('id', c.id);
      failed.push({ restaurantId: c.restaurant_id, restaurant: c.restaurants?.name || null, reauth: !!err.reauth, error: msg });
    }
  }

  if (failed.length) {
    await sendCronAlert('Shift4 sign-in refresh', `${failed.length} Shift4 connection(s) could not renew their sign-in.`, failed.map((f) => `${f.restaurant || `Restaurant ${f.restaurantId}`}: ${f.error}`));
  }
  return res.status(200).json({ checked: (conns || []).length, due: due.length, refreshed, failed });
}

export default withJobRun('refresh-shift4-tokens', handler);