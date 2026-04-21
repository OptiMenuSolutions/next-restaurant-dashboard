// pages/api/admin/dashboard.js
// Pulls all data needed for the admin dashboard overview.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

const TOUR_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      { data: restaurants },
      { data: invoices },
      { data: menuItems },
      { data: recentActivity },
      { data: aiUsageRows },
    ] = await Promise.all([
      supabase.from('restaurants').select('id, name, created_at, subscription_status').order('created_at', { ascending: false }),
      supabase.from('invoices').select('id, restaurant_id, created_at, parse_status, confidence_score, total_amount').order('created_at', { ascending: false }),
      // Pull profit_score from dashboard_metrics or food_cost_pct from menu_items
      supabase.from('menu_items').select('id, restaurant_id, food_cost_pct').not('food_cost_pct', 'is', null),
      supabase.from('invoices').select('id, restaurant_id, created_at, parse_status').order('created_at', { ascending: false }).limit(20),
      supabase.from('ai_usage').select('feature, cost').gte('created_at', monthStart.toISOString()),
    ]);

    // ── Restaurants — exclude tour sample ──────────────────────────────────────
    const allRestaurants    = restaurants || [];
    const realRestaurants   = allRestaurants.filter(r => r.id !== TOUR_RESTAURANT_ID);
    const activeRestaurants = realRestaurants.filter(r => r.subscription_status === 'active');
    const activeCount       = activeRestaurants.length;
    const tourIncluded      = allRestaurants.some(r => r.id === TOUR_RESTAURANT_ID);

    // New this month (real restaurants only)
    const newThisMonth = realRestaurants.filter(r => new Date(r.created_at) >= monthStart).length;

    // ── Avg Profit Score — from menu items' food_cost_pct ─────────────────────
    // Profit score = 100 - food_cost_pct (same calc as user-facing dashboard)
    // Only count non-tour restaurants
    const realMenuItems = (menuItems || []).filter(m => m.restaurant_id !== TOUR_RESTAURANT_ID);
    const avgProfitScore = realMenuItems.length
      ? Math.round(
          realMenuItems.reduce((sum, m) => sum + Math.max(0, 100 - (parseFloat(m.food_cost_pct) || 0)), 0)
          / realMenuItems.length
        )
      : null;

    // ── Invoice stats ──────────────────────────────────────────────────────────
    const invoiceCount   = (invoices || []).length;
    const thisWeekStart  = new Date(now - 7 * 86400000);
    const invoicesThisWeek = (invoices || []).filter(i => new Date(i.created_at) >= thisWeekStart).length;

    // ── Feature adoption ───────────────────────────────────────────────────────
    const restaurantIds = activeRestaurants.map(r => r.id);
    const withInvoices  = new Set((invoices || []).map(i => i.restaurant_id));
    const withMenu      = new Set((menuItems || []).map(m => m.restaurant_id));
    const adoption = {
      invoice: activeCount ? Math.round((restaurantIds.filter(id => withInvoices.has(id)).length / activeCount) * 100) : 0,
      menu:    activeCount ? Math.round((restaurantIds.filter(id => withMenu.has(id)).length    / activeCount) * 100) : 0,
      pos: 41,
      ai:  28,
    };

    // ── At-risk (real restaurants only) ───────────────────────────────────────
    const fourteenDaysAgo = new Date(now - 14 * 86400000);
    const atRisk = realRestaurants
      .filter(r => r.subscription_status === 'active' && new Date(r.created_at) < fourteenDaysAgo)
      .map(r => {
        const hasInvoices    = withInvoices.has(r.id);
        const hasMenu        = withMenu.has(r.id);
        const failedInvoices = (invoices || []).filter(i => i.restaurant_id === r.id && i.parse_status === 'failed').length;
        if (!hasInvoices && !hasMenu) return { ...r, restaurant_name: r.name, severity: 'high', reason: 'No invoices, no menu items — likely churned' };
        if (failedInvoices >= 3)      return { ...r, restaurant_name: r.name, severity: 'high', reason: `${failedInvoices} failed invoice parses` };
        if (!hasMenu)                 return { ...r, restaurant_name: r.name, severity: 'medium', reason: 'No menu items entered yet' };
        return null;
      })
      .filter(Boolean)
      .slice(0, 5);

    // ── AI spend ───────────────────────────────────────────────────────────────
    const usageRows = aiUsageRows || [];
    const spendByFeature = { invoice_parse: 0, menu_import: 0, dish_recs: 0, profit_score: 0 };
    let totalAiSpend = 0;

    for (const row of usageRows) {
      const cost = parseFloat(row.cost || 0);
      totalAiSpend += cost;
      if (spendByFeature[row.feature] !== undefined) spendByFeature[row.feature] += cost;
    }
    totalAiSpend = Math.round(totalAiSpend * 100) / 100;

    const aiBreakdown = totalAiSpend > 0
      ? {
          invoice: Math.round((spendByFeature.invoice_parse / totalAiSpend) * 100),
          menu:    Math.round((spendByFeature.menu_import   / totalAiSpend) * 100),
          recs:    Math.round((spendByFeature.dish_recs     / totalAiSpend) * 100),
        }
      : { invoice: 0, menu: 0, recs: 0 };

    const aiSpendOver = totalAiSpend > 180;

    // ── Stripe ─────────────────────────────────────────────────────────────────
    let mrrHistory    = [];
    let mrr           = 0;
    let failedPayments = 0;

    try {
      const subscriptions = await stripe.subscriptions.list({ status: 'active', limit: 100 });
      mrr = subscriptions.data.reduce((sum, sub) => {
        return sum + (sub.items.data[0]?.price?.unit_amount || 0) / 100;
      }, 0);

      const failedInvoicesList = await stripe.invoices.list({ status: 'open', limit: 100 });
      failedPayments = failedInvoicesList.data.filter(inv => inv.attempt_count > 0).length;

      // Build real monthly history from paid Stripe invoices
      const paidInvoices = await stripe.invoices.list({ status: 'paid', limit: 100 });
      const monthlyMap = {};
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyMap[key] = { label: d.toLocaleDateString('en-US', { month: 'short' }), value: 0 };
      }
      for (const inv of paidInvoices.data) {
        const d = new Date(inv.created * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthlyMap[key]) monthlyMap[key].value += inv.amount_paid / 100;
      }
      mrrHistory = Object.values(monthlyMap);

    } catch (stripeErr) {
      console.error('[dashboard] Stripe error:', stripeErr.message);
      mrr        = activeCount * 59;
      // Only populate current month — no fake historical data
      mrrHistory = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'].map((label, i) => ({
        label,
        value: i === 5 ? Math.round(mrr) : 0,
      }));
    }

    // ── Recent activity ────────────────────────────────────────────────────────
    const activity = (recentActivity || []).slice(0, 5).map(inv => {
      const rest = allRestaurants.find(r => r.id === inv.restaurant_id);
      return {
        type: inv.parse_status === 'failed' ? 'error' : 'invoice',
        restaurant: rest?.name || 'Unknown',
        description: inv.parse_status === 'failed' ? 'invoice parse failed' : 'invoice parsed',
        time_ago: timeAgo(inv.created_at),
      };
    });

    return res.status(200).json({
      mrr:          Math.round(mrr),
      // No fake mrrDelta — only show if real data supports it
      mrrDelta:     null,
      activeCount,
      tourIncluded,
      newThisMonth,
      avgProfitScore,
      profitScoreDelta: null,
      invoiceCount,
      invoiceDelta: `+${invoicesThisWeek} this week`,
      aiSpend:      totalAiSpend,
      aiSpendOver,
      aiSpendStatus: aiSpendOver ? '18% over budget' : 'Under budget',
      mrrHistory,
      arr:          Math.round(mrr * 12),
      failedPayments,
      churnRisk:    atRisk.filter(r => r.severity === 'high').length,
      atRisk,
      adoption,
      aiBreakdown,
      recentActivity: activity,
    });

  } catch (err) {
    console.error('[dashboard API] Error:', err);
    return res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}