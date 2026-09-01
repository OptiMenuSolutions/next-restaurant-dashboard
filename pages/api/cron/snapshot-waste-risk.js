// pages/api/cron/snapshot-waste-risk.js
// Nightly cron job — runs at 09:00 UTC (~4-5am ET) via Vercel Cron, after the
// previous day's sales are in. Two jobs in one run:
//   1. Snapshot every restaurant's waste-risk list "as of the end of
//      yesterday" into waste_risk_snapshots, so the resolution calculator can
//      later diff consecutive days to see what got sold down (attributable to
//      a recommendation) vs. what aged out unsold.
//   2. Detect deliveries that just aged out of the risk list unsold and worth
//      >= CONFIRMATION_THRESHOLD, and create a pending waste_confirmations row
//      so the restaurant can confirm/correct the presumption via a dashboard
//      pop-up. Also sweeps any confirmation that's sat unanswered for
//      EXPIRY_WINDOW_DAYS into 'expired_unconfirmed'.
//
// SETUP REQUIRED:
//   Reuses the same CRON_SECRET already set up for generate-recommendations.js.
//   Add the new schedule to vercel.json's `crons` array.
//   Requires the waste_risk_snapshots and waste_confirmations tables
//   (waste_risk_snapshots.sql).

import { createClient } from '@supabase/supabase-js';
import { computeWasteRisk } from '../../../lib/computeWasteRisk';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// How far back to pull invoices/sales when reconstructing a past day's risk
// list. Matches the window pages/client/dashboard.js already uses for its
// live computeWasteRisk call, for consistency — a separate question (raised
// in the dashboard punch list) is whether that 90-day window should be
// widened app-wide; not silently changed here.
const LOOKBACK_DAYS = 90;

// Deliveries worth less than this when they age out don't trigger a
// confirmation prompt — filters out low-stakes garnish/condiment-tier items.
const CONFIRMATION_THRESHOLD = 20;

// A pending confirmation left unanswered this many days auto-locks in as
// 'expired_unconfirmed' (counted at reduced weight in OptiScore, not full
// waste — see chat: this avoids both "ignoring the prompt is free" and
// "an unverified guess is treated as proven fact").
const EXPIRY_WINDOW_DAYS = 3;

async function snapshotRestaurant(restaurantId, snapshotDate) {
  // snapshotDate is 'YYYY-MM-DD'. Compute "as of" noon on that day so the
  // date math in computeWasteRisk isn't sensitive to timezone edge cases.
  const asOfDate = new Date(`${snapshotDate}T12:00:00`);

  const lookbackFrom = new Date(asOfDate);
  lookbackFrom.setDate(lookbackFrom.getDate() - LOOKBACK_DAYS);
  const fromDate = lookbackFrom.toISOString().split('T')[0];

  const [{ data: invoices }, { data: invoiceItems }, { data: posSales }, { data: menuItems }] =
    await Promise.all([
      supabase
        .from('invoices')
        .select('id,date')
        .eq('restaurant_id', restaurantId)
        .gte('date', fromDate)
        .lte('date', snapshotDate),
      supabase
        .from('invoice_items')
        .select('*,invoices!inner(id,date,restaurant_id)')
        .eq('invoices.restaurant_id', restaurantId)
        .gte('invoices.date', fromDate)
        .lte('invoices.date', snapshotDate),
      supabase
        .from('pos_sales')
        .select('item_name,quantity_sold,sale_date')
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', fromDate)
        .lte('sale_date', snapshotDate),
      supabase
        .from('menu_items')
        .select('id,name,price,cost,category,menu_item_components(id,name,cost,component_ingredients(quantity,unit,ingredients(id,name,last_price,is_estimated)))')
        .eq('restaurant_id', restaurantId)
        .limit(500),
    ]);

  const wasteRisk = computeWasteRisk(
    invoiceItems || [],
    invoices || [],
    posSales || [],
    menuItems || [],
    asOfDate
  );

  const rows = wasteRisk
    .filter((r) => r.invoiceItemId) // unique constraint depends on this
    .map((r) => ({
      restaurant_id:   restaurantId,
      snapshot_date:   snapshotDate,
      invoice_item_id: r.invoiceItemId,
      invoice_id:      r.invoiceId || null,
      ingredient_name: r.name,
      delivery_date:   r.deliveryDate,
      days_left:       r.daysLeft,
      shelf_life:      r.shelfLife,
      remaining_qty:   r.remainingQty,
      invoiced_qty:    r.invoicedQty,
      unit_cost:       r.unitCost,
      total_value:     r.totalValue,
      is_protein:      r.protein,
    }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from('waste_risk_snapshots')
      .upsert(rows, { onConflict: 'restaurant_id,snapshot_date,invoice_item_id' });
    if (error) throw error;
  }

  // ── Detect newly-aged-out deliveries and queue confirmations ────────────
  // Compare yesterday's stored snapshot against today's just-computed rows.
  // Anything present yesterday but absent today, where yesterday's own
  // snapshot already showed it at/past its use-by point (days_left <= 0) —
  // not merely fallen outside the LOOKBACK_DAYS query window while still
  // fresh — just aged out unsold as far as we can tell.
  const prevDate = new Date(asOfDate);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = prevDate.toISOString().split('T')[0];

  const { data: prevRows } = await supabase
    .from('waste_risk_snapshots')
    .select('invoice_item_id,ingredient_name,remaining_qty,unit_cost,days_left')
    .eq('restaurant_id', restaurantId)
    .eq('snapshot_date', prevDateStr);

  if (prevRows?.length) {
    const todaySet = new Set(rows.map((r) => r.invoice_item_id));

    const newlyWasted = prevRows.filter((p) => {
      if (todaySet.has(p.invoice_item_id)) return false; // still on the list
      if (p.days_left > 0) return false;                 // wasn't expired yet as of last sighting
      const value = Number(p.remaining_qty) * Number(p.unit_cost);
      return value >= CONFIRMATION_THRESHOLD;
    });

    if (newlyWasted.length > 0) {
      const confirmationRows = newlyWasted.map((p) => ({
        restaurant_id:   restaurantId,
        invoice_item_id: p.invoice_item_id,
        ingredient_name: p.ingredient_name,
        last_seen_date:  prevDateStr,
        presumed_qty:    p.remaining_qty,
        presumed_value:  Number(p.remaining_qty) * Number(p.unit_cost),
        status:          'pending',
      }));
      // onConflict + ignoreDuplicates: if a confirmation for this delivery
      // already exists (e.g. cron reran), don't reset/recreate it.
      const { error: confirmError } = await supabase
        .from('waste_confirmations')
        .upsert(confirmationRows, { onConflict: 'restaurant_id,invoice_item_id', ignoreDuplicates: true });
      if (confirmError) throw confirmError;
    }
  }

  return rows.length;
}

async function expireStaleConfirmations() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - EXPIRY_WINDOW_DAYS);

  const { error, count } = await supabase
    .from('waste_confirmations')
    .update({ status: 'expired_unconfirmed' }, { count: 'exact' })
    .eq('status', 'pending')
    .lt('created_at', cutoff.toISOString());

  if (error) {
    console.error('[cron:waste-snapshot] Failed to expire stale confirmations:', error.message);
    return 0;
  }
  return count || 0;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Snapshot *yesterday* (ET) — the most recently fully-completed service day.
  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  estNow.setDate(estNow.getDate() - 1);
  const snapshotDate = estNow.toISOString().split('T')[0];

  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, name');

  if (error || !restaurants?.length) {
    console.error('[cron:waste-snapshot] Failed to fetch restaurants:', error?.message);
    return res.status(500).json({ error: 'Failed to fetch restaurants' });
  }

  console.log(`[cron:waste-snapshot] Snapshotting ${restaurants.length} restaurants — ${snapshotDate}`);

  const results = { success: [], skipped: [], failed: [] };

  for (const restaurant of restaurants) {
    // Skip if already snapshotted for this day (idempotent reruns).
    const { data: existing } = await supabase
      .from('waste_risk_snapshots')
      .select('id')
      .eq('restaurant_id', restaurant.id)
      .eq('snapshot_date', snapshotDate)
      .limit(1)
      .single();

    if (existing) {
      results.skipped.push(restaurant.name);
      continue;
    }

    try {
      const rowCount = await snapshotRestaurant(restaurant.id, snapshotDate);
      results.success.push(`${restaurant.name} (${rowCount} rows)`);
      console.log(`[cron:waste-snapshot] ✓ ${restaurant.name} — ${rowCount} rows`);
    } catch (err) {
      results.failed.push({ name: restaurant.name, error: err.message });
      console.error(`[cron:waste-snapshot] ✗ ${restaurant.name}:`, err.message);
    }
  }

  const expiredCount = await expireStaleConfirmations();

  console.log(`[cron:waste-snapshot] Done — ${results.success.length} snapshotted, ${results.skipped.length} skipped, ${results.failed.length} failed, ${expiredCount} confirmations expired`);
  return res.status(200).json({ date: snapshotDate, expiredConfirmations: expiredCount, ...results });
}
