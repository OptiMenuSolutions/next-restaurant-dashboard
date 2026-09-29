// pages/api/cron/purge-deactivated-accounts.js
// Runs daily. Finds restaurants deactivated more than 60 days ago and
// permanently deletes them — auth user, restaurant row, and every piece of
// their data. This is genuinely irreversible.
//
// !! TEST THIS AGAINST A THROWAWAY TEST RESTAURANT BEFORE TRUSTING IT IN
// !! PRODUCTION !! I only have confirmed cascade behavior for two foreign
// keys (profiles.restaurant_id -> CASCADE, feedback.restaurant_id -> SET
// NULL) — everything else below is deleted explicitly, in dependency order,
// because I don't know whether the rest of your schema actually cascades.
// If it does, this is redundant but harmless. If it doesn't, this is the
// only thing standing between "deactivated" and "orphaned rows forever."
// Either way — verify against a real (disposable) restaurant first.
//
// SETUP REQUIRED: same CRON_SECRET pattern as the other cron jobs. Add to
// vercel.json's crons array, e.g. daily at a low-traffic hour:
//   { "path": "/api/cron/purge-deactivated-accounts", "schedule": "0 10 * * *" }

import { createClient } from '@supabase/supabase-js';
import stripe from '../../../lib/stripeServer';
import { sendCronAlert } from '../../../lib/cronAlert';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RETENTION_DAYS = 60;

// Deletes every file under a restaurant's folder in a Storage bucket,
// including nested folders. Uses the Storage API: deleting storage rows in
// SQL would leave the actual files behind.
async function removeStorageFolder(bucket, prefix) {
  let removed = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) throw new Error(`${bucket} list failed: ${error.message}`);
    if (!data?.length) break;
    const files = data.filter(o => o.id).map(o => `${prefix}/${o.name}`);
    const folders = data.filter(o => !o.id).map(o => `${prefix}/${o.name}`);
    for (const folder of folders) removed += await removeStorageFolder(bucket, folder);
    if (!files.length) break;
    const { error: rmError } = await supabase.storage.from(bucket).remove(files);
    if (rmError) throw new Error(`${bucket} remove failed: ${rmError.message}`);
    removed += files.length;
  }
  return removed;
}

async function purgeRestaurant(restaurant) {
  const restaurantId = restaurant.id;

  // 1. Files first: if the database purge below fails, the restaurant row
  // still exists and tomorrow's run retries everything. Done the other way,
  // a failed file cleanup would leave files no row points to.
  const invoiceFiles = await removeStorageFolder('invoices', restaurantId);
  const menuFiles = await removeStorageFolder('menus', restaurantId);
  console.log(`[purge-deactivated-accounts] ${restaurant.name || restaurantId}: removed ${invoiceFiles} invoice and ${menuFiles} menu files`);

  // 2. Cancel any lingering Stripe subscription (should already be canceled
  // by deactivate.js; this is a safety net).
  if (restaurant.stripe_subscription_id) {
    try {
      await stripe.subscriptions.cancel(restaurant.stripe_subscription_id);
    } catch {
      // Already canceled or does not exist: fine, continue.
    }
  }

  // 3. All database rows and the auth user, in one transaction: any error
  // rolls the whole purge back and throws, so the alert fires.
  const { error } = await supabase.rpc('purge_restaurant', { target: restaurantId });
  if (error) throw new Error(`purge_restaurant failed: ${error.message}`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const { data: dueForPurge, error } = await supabase
    .from('restaurants')
    .select('id, name, user_id, stripe_subscription_id, deactivated_at')
    .not('deactivated_at', 'is', null)
    .lt('deactivated_at', cutoff.toISOString());

  if (error) {
    console.error('[purge-deactivated-accounts] Failed to query deactivated restaurants:', error.message);
    await sendCronAlert('Account purge cron', 'Could not query deactivated restaurants, so nothing was purged.', [error.message]);
    return res.status(500).json({ error: error.message });
  }

  if (!dueForPurge?.length) {
    return res.status(200).json({ purged: 0 });
  }

  const results = { purged: [], failed: [] };
  for (const restaurant of dueForPurge) {
    try {
      await purgeRestaurant(restaurant);
      results.purged.push(restaurant.name || restaurant.id);
      console.log(`[purge-deactivated-accounts] Purged ${restaurant.name || restaurant.id}`);
    } catch (err) {
      results.failed.push({ id: restaurant.id, name: restaurant.name, error: err.message });
      console.error(`[purge-deactivated-accounts] Failed to purge ${restaurant.id}:`, err.message);
    }
  }

  if (results.failed.length) {
    await sendCronAlert(
      'Account purge cron',
      `${results.failed.length} deactivated restaurant(s) could not be purged and may be partly deleted.`,
      results.failed.map(f => `${f.name || f.id}: ${f.error}`)
    );
  }
  return res.status(200).json({ purged: results.purged.length, failed: results.failed, names: results.purged });
}
