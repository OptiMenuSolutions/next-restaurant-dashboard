// pages/api/admin/at-risk.js
// Returns all at-risk restaurants with detailed risk signals.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [
      { data: restaurants },
      { data: invoices },
      { data: menuItems },
      { data: ingredients },
      { data: profiles },
      { data: posSales },
    ] = await Promise.all([
      supabase.from('restaurants').select('*').order('created_at', { ascending: false }),
      supabase.from('invoices').select('id, restaurant_id, created_at, parse_status, amount'),
      supabase.from('menu_items').select('id, restaurant_id'),
      supabase.from('ingredients').select('id, restaurant_id'),
      supabase.from('profiles').select('id, email, full_name'),
      supabase.from('pos_sales').select('id, restaurant_id, sale_date').order('sale_date', { ascending: false }),
    ]);

    const profileMap = {};
    for (const p of profiles || []) profileMap[p.id] = p;

    const invoiceMap = {};
    const failedMap = {};
    const lastInvoiceMap = {};
    for (const inv of invoices || []) {
      invoiceMap[inv.restaurant_id] = (invoiceMap[inv.restaurant_id] || 0) + 1;
      if (inv.parse_status === 'failed') failedMap[inv.restaurant_id] = (failedMap[inv.restaurant_id] || 0) + 1;
      if (!lastInvoiceMap[inv.restaurant_id] || new Date(inv.created_at) > new Date(lastInvoiceMap[inv.restaurant_id])) {
        lastInvoiceMap[inv.restaurant_id] = inv.created_at;
      }
    }

    const menuMap = {};
    for (const m of menuItems || []) menuMap[m.restaurant_id] = (menuMap[m.restaurant_id] || 0) + 1;

    const ingredientMap = {};
    for (const i of ingredients || []) ingredientMap[i.restaurant_id] = (ingredientMap[i.restaurant_id] || 0) + 1;

    const lastPosMap = {};
    for (const s of posSales || []) {
      if (!lastPosMap[s.restaurant_id]) lastPosMap[s.restaurant_id] = s.sale_date;
    }

    const now = new Date();
    const fourteenDaysAgo = new Date(now - 14 * 86400000);
    const thirtyDaysAgo   = new Date(now - 30 * 86400000);
    const sevenDaysAgo    = new Date(now - 7  * 86400000);

    const atRisk = [];

    for (const r of restaurants || []) {
      const profile       = profileMap[r.user_id] || {};
      const invoiceCount  = invoiceMap[r.id] || 0;
      const failedCount   = failedMap[r.id] || 0;
      const menuCount     = menuMap[r.id] || 0;
      const ingredientCount = ingredientMap[r.id] || 0;
      const lastInvoice   = lastInvoiceMap[r.id] ? new Date(lastInvoiceMap[r.id]) : null;
      const lastPos       = lastPosMap[r.id] ? new Date(lastPosMap[r.id]) : null;
      const joinedAt      = new Date(r.created_at);
      const daysSinceJoin = Math.floor((now - joinedAt) / 86400000);

      // Only flag restaurants older than 14 days
      if (daysSinceJoin < 14) continue;

      const signals = [];
      let severity = null;

      // Signal: no invoices at all
      if (invoiceCount === 0) signals.push({ type: 'no_invoices', label: 'No invoices uploaded', severity: 'high' });

      // Signal: no menu items
      if (menuCount === 0) signals.push({ type: 'no_menu', label: 'No menu items', severity: 'high' });

      // Signal: failed invoice parses
      if (failedCount >= 3) signals.push({ type: 'failed_parses', label: `${failedCount} failed invoice parses`, severity: 'high' });
      else if (failedCount > 0) signals.push({ type: 'failed_parses', label: `${failedCount} failed invoice parse${failedCount > 1 ? 's' : ''}`, severity: 'medium' });

      // Signal: no activity in 30 days
      if (lastInvoice && lastInvoice < thirtyDaysAgo) signals.push({ type: 'inactive', label: `No invoice activity in ${Math.floor((now - lastInvoice) / 86400000)}d`, severity: 'medium' });

      // Signal: no POS data
      if (!lastPos) signals.push({ type: 'no_pos', label: 'No POS data uploaded', severity: 'low' });
      else if (lastPos < thirtyDaysAgo) signals.push({ type: 'stale_pos', label: `POS data ${Math.floor((now - lastPos) / 86400000)}d old`, severity: 'low' });

      // Signal: subscription status
      if (r.subscription_status === 'past_due') signals.push({ type: 'past_due', label: 'Payment past due', severity: 'high' });
      if (r.subscription_status === 'canceled') signals.push({ type: 'canceled', label: 'Subscription canceled', severity: 'high' });

      // Skip if no signals
      if (signals.length === 0) continue;

      // Determine overall severity
      if (signals.some(s => s.severity === 'high'))        severity = 'high';
      else if (signals.some(s => s.severity === 'medium')) severity = 'medium';
      else                                                  severity = 'low';

      // Health score
      let health = 100;
      if (invoiceCount === 0) health -= 30;
      if (menuCount === 0) health -= 30;
      if (failedCount >= 3) health -= 20;
      if (!lastPos) health -= 10;
      if (r.subscription_status === 'past_due') health -= 20;
      if (r.subscription_status === 'canceled') health -= 40;
      health = Math.max(0, health);

      atRisk.push({
        id: r.id,
        name: r.name || 'Unnamed',
        owner_name: profile.full_name || null,
        owner_email: profile.email || null,
        subscription_status: r.subscription_status || 'unknown',
        created_at: r.created_at,
        days_since_join: daysSinceJoin,
        invoice_count: invoiceCount,
        menu_count: menuCount,
        ingredient_count: ingredientCount,
        failed_parses: failedCount,
        last_invoice: lastInvoiceMap[r.id] || null,
        last_pos: lastPosMap[r.id] || null,
        signals,
        severity,
        health,
      });
    }

    // Sort: high first, then by health ascending
    atRisk.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
      return a.health - b.health;
    });

    return res.status(200).json({ atRisk, total: atRisk.length });

  } catch (err) {
    console.error('[at-risk API] Error:', err);
    return res.status(500).json({ error: 'Failed to load at-risk data' });
  }
});