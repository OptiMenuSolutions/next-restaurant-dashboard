// pages/api/admin/churn.js
// Churn risk scoring for all active restaurants.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = new Date();
    const thirtyDaysAgo  = new Date(now - 30  * 86400000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 86400000).toISOString();
    const sevenDaysAgo   = new Date(now - 7   * 86400000).toISOString();

    const [
      { data: restaurants },
      { data: invoices },
      { data: menuItems },
      { data: posSales },
      { data: profiles },
      { data: aiUsage },
    ] = await Promise.all([
      supabase.from('restaurants').select('*').order('created_at', { ascending: false }),
      supabase.from('invoices').select('id, restaurant_id, created_at, parse_status').gte('created_at', thirtyDaysAgo),
      supabase.from('menu_items').select('id, restaurant_id'),
      supabase.from('pos_sales').select('id, restaurant_id, sale_date').gte('sale_date', thirtyDaysAgo.split('T')[0]),
      supabase.from('profiles').select('id, email, full_name'),
      supabase.from('ai_usage').select('restaurant_id, created_at').gte('created_at', thirtyDaysAgo),
    ]);

    const profileMap = {};
    for (const p of profiles || []) profileMap[p.id] = p;

    // Build activity maps
    const invoiceMap  = {};
    const lastInvoiceMap = {};
    for (const inv of invoices || []) {
      invoiceMap[inv.restaurant_id] = (invoiceMap[inv.restaurant_id] || 0) + 1;
      if (!lastInvoiceMap[inv.restaurant_id] || inv.created_at > lastInvoiceMap[inv.restaurant_id]) {
        lastInvoiceMap[inv.restaurant_id] = inv.created_at;
      }
    }

    const menuMap = {};
    for (const m of menuItems || []) menuMap[m.restaurant_id] = (menuMap[m.restaurant_id] || 0) + 1;

    const posMap = {};
    for (const s of posSales || []) posMap[s.restaurant_id] = (posMap[s.restaurant_id] || 0) + 1;

    const aiMap = {};
    const lastAiMap = {};
    for (const a of aiUsage || []) {
      aiMap[a.restaurant_id] = (aiMap[a.restaurant_id] || 0) + 1;
      if (!lastAiMap[a.restaurant_id] || a.created_at > lastAiMap[a.restaurant_id]) {
        lastAiMap[a.restaurant_id] = a.created_at;
      }
    }

    const scored = [];

    for (const r of restaurants || []) {
      const profile        = profileMap[r.user_id] || {};
      const daysSinceJoin  = Math.floor((now - new Date(r.created_at)) / 86400000);
      if (daysSinceJoin < 7) continue; // too new to score

      const invoiceCount30d = invoiceMap[r.id] || 0;
      const menuCount       = menuMap[r.id] || 0;
      const posCount30d     = posMap[r.id] || 0;
      const aiCalls30d      = aiMap[r.id] || 0;
      const lastInvoice     = lastInvoiceMap[r.id] || null;
      const lastAi          = lastAiMap[r.id] || null;

      // ── Churn signals (each adds to risk score 0–100) ─────────────────────
      let riskScore = 0;
      const signals = [];

      // No menu items — heavy signal
      if (menuCount === 0) {
        riskScore += 25;
        signals.push({ label: 'No menu imported', weight: 25 });
      }

      // No invoices in 30 days
      if (invoiceCount30d === 0) {
        riskScore += 20;
        signals.push({ label: 'No invoices in 30 days', weight: 20 });
      }

      // No AI usage in 30 days — disengaged
      if (aiCalls30d === 0 && daysSinceJoin > 14) {
        riskScore += 15;
        signals.push({ label: 'No AI feature usage in 30 days', weight: 15 });
      }

      // No POS data
      if (posCount30d === 0) {
        riskScore += 10;
        signals.push({ label: 'No POS data uploaded', weight: 10 });
      }

      // Last invoice > 14 days ago
      if (lastInvoice && new Date(lastInvoice) < new Date(fourteenDaysAgo)) {
        riskScore += 15;
        signals.push({ label: `Last invoice ${Math.floor((now - new Date(lastInvoice)) / 86400000)}d ago`, weight: 15 });
      }

      // Subscription status
      if (r.subscription_status === 'past_due') {
        riskScore += 20;
        signals.push({ label: 'Payment past due', weight: 20 });
      }
      if (r.subscription_status === 'canceled') {
        riskScore += 40;
        signals.push({ label: 'Subscription canceled', weight: 40 });
      }

      // Low recent activity (invoice count < 2 in 30d for established restaurants)
      if (daysSinceJoin > 30 && invoiceCount30d < 2) {
        riskScore += 10;
        signals.push({ label: 'Low invoice activity', weight: 10 });
      }

      riskScore = Math.min(100, riskScore);

      // Risk tier
      let tier = 'low';
      if (riskScore >= 60) tier = 'high';
      else if (riskScore >= 30) tier = 'medium';

      scored.push({
        id: r.id,
        name: r.name || 'Unnamed',
        owner_name: profile.full_name || null,
        owner_email: profile.email || null,
        subscription_status: r.subscription_status || 'unknown',
        created_at: r.created_at,
        days_since_join: daysSinceJoin,
        risk_score: riskScore,
        tier,
        signals,
        stats: {
          invoices_30d: invoiceCount30d,
          menu_items: menuCount,
          pos_30d: posCount30d,
          ai_calls_30d: aiCalls30d,
          last_invoice: lastInvoice,
          last_ai: lastAi,
        },
      });
    }

    // Sort by risk score descending
    scored.sort((a, b) => b.risk_score - a.risk_score);

    const stats = {
      total: scored.length,
      high:   scored.filter(r => r.tier === 'high').length,
      medium: scored.filter(r => r.tier === 'medium').length,
      low:    scored.filter(r => r.tier === 'low').length,
      avgRisk: scored.length
        ? Math.round(scored.reduce((s, r) => s + r.risk_score, 0) / scored.length)
        : 0,
    };

    return res.status(200).json({ restaurants: scored, stats });

  } catch (err) {
    console.error('[churn API] Error:', err);
    return res.status(500).json({ error: 'Failed to load churn data' });
  }
});