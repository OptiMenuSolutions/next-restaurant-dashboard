import { createClient } from '@supabase/supabase-js';
import shift4 from '../../../lib/pos/providers/shift4';
import { sendCronAlert } from '../../../lib/cronAlert';
import { withJobRun } from '../../../lib/admin/jobRun';
import { updateShift4Connection } from '../../../lib/pos/shift4-state';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DUE_WITHIN_MS = 8 * 60 * 60 * 1000;

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const force = req.query.manual === '1' || req.query.force === '1';

  const { data: conns, error } = await supabase
    .from('pos_connections')
    .select(
      'id, restaurant_id, status, shift4_location_id, access_token, refresh_token, expires_at, restaurants(name)'
    )
    .eq('provider', 'shift4')
    .in('status', ['connected', 'error']);

  if (error) return res.status(500).json({ error: error.message });

  const due = (conns || []).filter(
    (c) =>
      force ||
      !c.refresh_token ||
      !c.expires_at ||
      !Number.isFinite(Date.parse(c.expires_at)) ||
      Date.parse(c.expires_at) - Date.now() < DUE_WITHIN_MS
  );

  const refreshed = [];
  const failed = [];

  for (const c of due) {
    const now = new Date().toISOString();
    let expected = c;

    try {
      const t = await shift4.refresh(c);

      const saved = await updateShift4Connection(supabase, c, {
        access_token: t.accessToken,
        refresh_token: t.refreshToken,
        expires_at: t.expiresAt,
        token_refreshed_at: now,
        token_error: null,
        updated_at: now,
      });

      if (!saved) continue;

      expected = {
        ...c,
        access_token: t.accessToken,
        refresh_token: t.refreshToken,
      };

      const locations = await shift4.listLocations(t.accessToken);

      refreshed.push({
        restaurantId: c.restaurant_id,
        restaurant: c.restaurants?.name || null,
        expiresAt: t.expiresAt,
        locations: locations.length,
      });

      console.log(
        `[cron:refresh-shift4-tokens] ✓ restaurant ${c.restaurant_id}, valid until ${t.expiresAt}`
      );
    } catch (err) {
      const msg = err.reauth
        ? `Shift4 sign-in could not be renewed (${err.message}). The owner needs to reconnect Shift4 from Profile. Sales keep syncing meanwhile.`
        : `Shift4 sign-in renewal failed (${err.message}). It tries again in 6 hours.`;

      console.error(
        `[cron:refresh-shift4-tokens] ✗ restaurant ${c.restaurant_id}:`,
        err.message
      );

      try {
        const recorded = await updateShift4Connection(supabase, expected, {
          token_error: msg,
          updated_at: now,
        });

        if (!recorded) continue;
      } catch (saveError) {
        console.error(
          '[cron:refresh-shift4-tokens] Could not record failure:',
          saveError.message
        );
      }

      failed.push({
        restaurantId: c.restaurant_id,
        restaurant: c.restaurants?.name || null,
        reauth: !!err.reauth,
        error: msg,
      });
    }
  }

  if (failed.length) {
    await sendCronAlert(
      'Shift4 sign-in refresh',
      `${failed.length} Shift4 connection(s) could not renew their sign-in.`,
      failed.map(
        (f) =>
          `${f.restaurant || `Restaurant ${f.restaurantId}`}: ${f.error}`
      )
    );
  }

  return res.status(200).json({
    checked: (conns || []).length,
    due: due.length,
    refreshed,
    failed,
  });
}

export default withJobRun('refresh-shift4-tokens', handler);