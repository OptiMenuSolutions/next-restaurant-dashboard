// pages/api/cron/sync-pos-menu.js
//
// Daily POS Menu v2 sync for every connected Shift4 location. Pulls the full
// menu once per location (HMAC signed), saves it with lib/pos/saveMenu.js,
// marks items deleted in the POS, and links new POS items to OptiMenu dishes
// by exact name. Runs before the overnight ticket sync.
//
// SETUP: add to vercel.json crons, for example
//   { "path": "/api/cron/sync-pos-menu", "schedule": "45 7 * * *" }

import { createClient } from '@supabase/supabase-js';
import { buildHmacHeaders } from '../../../lib/pos/hmac-auth.js';
import { saveMenu } from '../../../lib/pos/saveMenu';
import { sendCronAlert } from '../../../lib/cronAlert';
import { withJobRun } from '../../../lib/admin/jobRun';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const API_BASE = process.env.SHIFT4_API_HOST || 'https://conecto-api.shift4payments.com';
const CLIENT_ID = process.env.SHIFT4_CLIENT_ID;
const CLIENT_SECRET = process.env.SHIFT4_CLIENT_SECRET;

// Same retry rule as the Shift4 provider: 429 or 5xx, up to 3 tries, a fresh
// signature each try (signatures expire after about 10 seconds).
async function fetchMenu(locationId) {
  const path = `/pos/v2/${locationId}/menu`;
  for (let i = 0; ; i++) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: buildHmacHeaders({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, method: 'GET', path }),
    });
    if ((res.status === 429 || res.status >= 500) && i < 2) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      const waitMs = Math.min(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** i, 10000);
      console.warn(`[cron:pos-menu] ${res.status} from Shift4 for ${locationId}, retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Shift4 menu fetch failed: ${data?.error?.message || res.status}`);
    return data;
  }
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Missing SHIFT4_CLIENT_ID or SHIFT4_CLIENT_SECRET' });
  }

  const { data: connections, error } = await supabase
    .from('pos_connections')
    .select('id, restaurant_id, shift4_location_id')
    .eq('provider', 'shift4')
    .eq('status', 'connected');

  if (error) {
    console.error('[cron:pos-menu] Failed to load connections:', error.message);
    await sendCronAlert('POS menu sync cron', 'Could not load the Shift4 connections, so no menu sync ran.', [error.message]);
    return res.status(500).json({ error: 'Failed to load connections' });
  }

  const results = { success: [], failed: [] };

  for (const conn of connections || []) {
    if (!conn.shift4_location_id) continue;
    try {
      const menu = await fetchMenu(conn.shift4_location_id);
      const counts = await saveMenu(supabase, {
        restaurantId: conn.restaurant_id,
        posSystem: 'shift4',
        menu,
      });
      console.log(
        `[cron:pos-menu] location ${conn.shift4_location_id}: ${counts.items} items (${counts.added} new, ${counts.removed} removed, ${counts.linked} linked), ` +
        `${counts.categories} categories, ${counts.modifierSets} modifier sets, ${counts.modifiers} modifiers`
      );
      results.success.push({ locationId: conn.shift4_location_id, ...counts });
    } catch (err) {
      console.error(`[cron:pos-menu] location ${conn.shift4_location_id} failed:`, err.message);
      results.failed.push({ locationId: conn.shift4_location_id, error: err.message });
    }
  }

  if (results.failed.length) {
    await sendCronAlert(
      'POS menu sync cron',
      `${results.failed.length} Shift4 menu sync(s) failed.`,
      results.failed.map((f) => `Location ${f.locationId}: ${f.error}`)
    );
  }

  return res.status(200).json(results);
}

export default withJobRun('sync-pos-menu', handler);