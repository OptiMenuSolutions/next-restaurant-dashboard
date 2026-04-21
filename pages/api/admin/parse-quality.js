// pages/api/admin/parse-quality.js
// Returns invoice parse quality metrics and failure analysis.

import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const sixtyDaysAgo  = new Date(Date.now() - 60 * 86400000).toISOString();

    const [
      { data: allInvoices },
      { data: restaurants },
    ] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, restaurant_id, parse_status, confidence_score, supplier, created_at, amount')
        .gte('created_at', sixtyDaysAgo)
        .order('created_at', { ascending: false }),
      supabase.from('restaurants').select('id, name'),
    ]);

    const restaurantMap = {};
    for (const r of restaurants || []) restaurantMap[r.id] = r.name;

    const invoices = allInvoices || [];

    // Split into periods
    const thisPeriod = invoices.filter(i => i.created_at >= thirtyDaysAgo);
    const lastPeriod = invoices.filter(i => i.created_at < thirtyDaysAgo);

    // Helper to compute stats for a set of invoices
    function computeStats(rows) {
      const total     = rows.length;
      const completed = rows.filter(i => i.parse_status === 'completed').length;
      const failed    = rows.filter(i => i.parse_status === 'failed').length;
      const pending   = rows.filter(i => !i.parse_status || i.parse_status === 'pending').length;
      const withConf  = rows.filter(i => i.confidence_score != null);
      const avgConf   = withConf.length
        ? Math.round(withConf.reduce((s, i) => s + parseFloat(i.confidence_score), 0) / withConf.length * 10) / 10
        : null;
      const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
      return { total, completed, failed, pending, avgConf, successRate };
    }

    const thisStats = computeStats(thisPeriod);
    const lastStats = computeStats(lastPeriod);

    // Confidence distribution buckets
    const confBuckets = { '90-100': 0, '70-89': 0, '50-69': 0, '<50': 0, 'N/A': 0 };
    for (const inv of thisPeriod) {
      const c = parseFloat(inv.confidence_score);
      if (isNaN(c))  confBuckets['N/A']++;
      else if (c >= 90) confBuckets['90-100']++;
      else if (c >= 70) confBuckets['70-89']++;
      else if (c >= 50) confBuckets['50-69']++;
      else              confBuckets['<50']++;
    }

    // Daily success rate trend (last 30 days)
    const dailyMap = {};
    for (const inv of thisPeriod) {
      const day = inv.created_at.split('T')[0];
      if (!dailyMap[day]) dailyMap[day] = { total: 0, completed: 0 };
      dailyMap[day].total++;
      if (inv.parse_status === 'completed') dailyMap[day].completed++;
    }

    const now = new Date();
    const dailyTrend = [];
    for (let i = 29; i >= 0; i--) {
      const d   = new Date(now - i * 86400000);
      const key = d.toISOString().split('T')[0];
      const day = dailyMap[key];
      dailyTrend.push({
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        rate:  day ? Math.round((day.completed / day.total) * 100) : null,
        total: day?.total || 0,
      });
    }

    // Restaurants with most failures
    const failuresByRestaurant = {};
    for (const inv of thisPeriod.filter(i => i.parse_status === 'failed')) {
      const id = inv.restaurant_id;
      if (!failuresByRestaurant[id]) failuresByRestaurant[id] = { id, name: restaurantMap[id] || 'Unknown', failures: 0 };
      failuresByRestaurant[id].failures++;
    }
    const topFailures = Object.values(failuresByRestaurant)
      .sort((a, b) => b.failures - a.failures)
      .slice(0, 10);

    // Suppliers with most failures
    const failuresBySupplier = {};
    for (const inv of thisPeriod.filter(i => i.parse_status === 'failed')) {
      const sup = inv.supplier || 'Unknown';
      failuresBySupplier[sup] = (failuresBySupplier[sup] || 0) + 1;
    }
    const topFailedSuppliers = Object.entries(failuresBySupplier)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Recent failed invoices
    const recentFailed = thisPeriod
      .filter(i => i.parse_status === 'failed')
      .slice(0, 15)
      .map(i => ({
        id: i.id,
        restaurant: restaurantMap[i.restaurant_id] || 'Unknown',
        supplier: i.supplier || 'Unknown',
        created_at: i.created_at,
      }));

    return res.status(200).json({
      thisMonth: thisStats,
      lastMonth: lastStats,
      confBuckets,
      dailyTrend,
      topFailures,
      topFailedSuppliers,
      recentFailed,
    });

  } catch (err) {
    console.error('[parse-quality API] Error:', err);
    return res.status(500).json({ error: 'Failed to load parse quality data' });
  }
});