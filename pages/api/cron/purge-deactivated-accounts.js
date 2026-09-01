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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RETENTION_DAYS = 60;

async function purgeRestaurant(restaurant) {
  const restaurantId = restaurant.id;

  // ── Menu tree: component_ingredients -> menu_item_components, then
  // menu_item_ingredients (the legacy flat table) -> menu_items ────────────
  const { data: menuItems } = await supabase
    .from('menu_items').select('id').eq('restaurant_id', restaurantId);
  const menuItemIds = (menuItems || []).map((m) => m.id);

  if (menuItemIds.length) {
    const { data: components } = await supabase
      .from('menu_item_components').select('id').in('menu_item_id', menuItemIds);
    const componentIds = (components || []).map((c) => c.id);
    if (componentIds.length) {
      await supabase.from('component_ingredients').delete().in('component_id', componentIds);
    }
    await supabase.from('menu_item_components').delete().in('menu_item_id', menuItemIds);
    await supabase.from('menu_item_ingredients').delete().in('menu_item_id', menuItemIds);
  }
  await supabase.from('menu_item_cost_history').delete().eq('restaurant_id', restaurantId);
  await supabase.from('menu_items').delete().eq('restaurant_id', restaurantId);

  // ── Invoice tree: invoice_items + invoice_files -> invoices ─────────────
  const { data: invoices } = await supabase
    .from('invoices').select('id').eq('restaurant_id', restaurantId);
  const invoiceIds = (invoices || []).map((i) => i.id);
  if (invoiceIds.length) {
    await supabase.from('invoice_items').delete().in('invoice_id', invoiceIds);
    await supabase.from('invoice_files').delete().in('invoice_id', invoiceIds);
  }
  await supabase.from('invoices').delete().eq('restaurant_id', restaurantId);

  // ── Everything else with a direct restaurant_id column ──────────────────
  const directTables = [
    'pos_sales',
    'pos_connections',
    'ai_recommendations',
    'waste_risk_snapshots',
    'waste_confirmations',
    'upload_sessions',
    'activity_logs',
    'ingredients',
  ];
  for (const table of directTables) {
    await supabase.from(table).delete().eq('restaurant_id', restaurantId);
  }

  // feedback.restaurant_id is ON DELETE SET NULL per the schema — no
  // explicit delete needed, those rows survive with restaurant_id cleared
  // once the restaurant row itself is deleted below.

  // ── Cancel any lingering Stripe subscription (should already be canceled
  // from deactivate.js, this is a safety net) ─────────────────────────────
  if (restaurant.stripe_subscription_id) {
    try {
      await stripe.subscriptions.cancel(restaurant.stripe_subscription_id);
    } catch {
      // Already canceled or doesn't exist — fine, continue.
    }
  }

  // ── Delete the restaurant row — cascades to profiles (confirmed FK) ─────
  await supabase.from('restaurants').delete().eq('id', restaurantId);

  // ── Finally, delete the actual auth user ─────────────────────────────────
  if (restaurant.user_id) {
    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(restaurant.user_id);
    if (authDeleteError) {
      console.error(`[purge-deactivated-accounts] Failed to delete auth user ${restaurant.user_id}:`, authDeleteError.message);
    }
  }
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

  return res.status(200).json({ purged: results.purged.length, failed: results.failed, names: results.purged });
}
