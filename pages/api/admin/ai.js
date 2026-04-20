// pages/api/admin/ai.js
// Returns AI usage and cost data aggregated from the ai_usage table.

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
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

    const [
      { data: allTime },
      { data: thisMonth },
      { data: lastMonth },
      { data: sixMonths },
      { data: recent },
      { data: restaurants },
    ] = await Promise.all([
      supabase.from('ai_usage').select('feature, cost, input_tokens, output_tokens'),
      supabase.from('ai_usage').select('feature, cost, input_tokens, output_tokens').gte('created_at', monthStart),
      supabase.from('ai_usage').select('feature, cost').gte('created_at', lastMonthStart).lt('created_at', monthStart),
      supabase.from('ai_usage').select('feature, cost, created_at').gte('created_at', sixMonthsAgo),
      supabase.from('ai_usage').select('feature, cost, input_tokens, output_tokens, restaurant_id, created_at').order('created_at', { ascending: false }).limit(50),
      supabase.from('restaurants').select('id, name'),
    ]);

    // ── Aggregation helpers ───────────────────────────────────────────────────
    function aggregate(rows) {
      const result = { total: 0, invoice_parse: 0, menu_import: 0, dish_recs: 0, profit_score: 0, input_tokens: 0, output_tokens: 0 };
      for (const r of rows || []) {
        const cost = parseFloat(r.cost || 0);
        result.total += cost;
        if (result[r.feature] !== undefined) result[r.feature] += cost;
        result.input_tokens += r.input_tokens || 0;
        result.output_tokens += r.output_tokens || 0;
      }
      result.total = Math.round(result.total * 10000) / 10000;
      return result;
    }

    const allTimeStats  = aggregate(allTime);
    const thisMonthStats = aggregate(thisMonth);
    const lastMonthStats = aggregate(lastMonth);

    // ── Monthly trend (last 6 months) ────────────────────────────────────────
    const monthlyMap = {};
    for (const r of sixMonths || []) {
      const d = new Date(r.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap[key] = (monthlyMap[key] || 0) + parseFloat(r.cost || 0);
    }

    const monthLabels = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short' });
      monthLabels.push({ label, value: Math.round((monthlyMap[key] || 0) * 100) / 100 });
    }

    // ── Per-restaurant breakdown ──────────────────────────────────────────────
    const restaurantMap = {};
    for (const r of restaurants || []) restaurantMap[r.id] = r.name;

    const perRestaurant = {};
    for (const r of thisMonth || []) {
      if (!r.restaurant_id) continue;
      if (!perRestaurant[r.restaurant_id]) {
        perRestaurant[r.restaurant_id] = { name: restaurantMap[r.restaurant_id] || 'Unknown', cost: 0, calls: 0 };
      }
      perRestaurant[r.restaurant_id].cost += parseFloat(r.cost || 0);
      perRestaurant[r.restaurant_id].calls++;
    }

    const topRestaurants = Object.entries(perRestaurant)
      .map(([id, v]) => ({ id, ...v, cost: Math.round(v.cost * 10000) / 10000 }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    // ── Recent calls feed ─────────────────────────────────────────────────────
    const recentCalls = (recent || []).map(r => ({
      feature: r.feature,
      cost: parseFloat(r.cost || 0),
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      restaurant: restaurantMap[r.restaurant_id] || 'System',
      created_at: r.created_at,
    }));

    const MONTHLY_BUDGET = 180;

    return res.status(200).json({
      allTime: allTimeStats,
      thisMonth: thisMonthStats,
      lastMonth: lastMonthStats,
      monthlyTrend: monthLabels,
      topRestaurants,
      recentCalls,
      budget: MONTHLY_BUDGET,
      budgetUsedPct: Math.round((thisMonthStats.total / MONTHLY_BUDGET) * 100),
    });

  } catch (err) {
    console.error('[ai API] Error:', err);
    return res.status(500).json({ error: 'Failed to load AI usage data' });
  }
});