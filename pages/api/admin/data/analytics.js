// pages/api/admin/data/analytics.js
// Returns POS sales analytics across all restaurants.

import { withAdminAuth } from '../../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString().split('T')[0];
    const sixtyDaysAgo  = new Date(now - 60 * 86400000).toISOString().split('T')[0];

    const TOUR_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';

        const [
          { data: sales },
          { data: restaurants },
        ] = await Promise.all([
          supabase
            .from('pos_sales')
            .select('id, restaurant_id, item_name, quantity_sold, revenue, sale_date, category')
            .gte('sale_date', sixtyDaysAgo)
            .neq('restaurant_id', TOUR_RESTAURANT_ID)
            .order('sale_date', { ascending: false }),
          supabase.from('restaurants').select('id, name')
            .neq('id', TOUR_RESTAURANT_ID),
        ]);

    const restaurantMap = {};
    for (const r of restaurants || []) restaurantMap[r.id] = r.name;

    const allSales = sales || [];

    // Split into this period vs last period
    const thisPeriod = allSales.filter(s => s.sale_date >= thirtyDaysAgo);
    const lastPeriod = allSales.filter(s => s.sale_date < thirtyDaysAgo);

    // Total revenue + quantity
    const totalRevenue     = thisPeriod.reduce((s, r) => s + parseFloat(r.revenue || 0), 0);
    const totalQty         = thisPeriod.reduce((s, r) => s + parseFloat(r.quantity_sold || 0), 0);
    const lastRevenue      = lastPeriod.reduce((s, r) => s + parseFloat(r.revenue || 0), 0);
    const revenueChange    = lastRevenue > 0 ? Math.round(((totalRevenue - lastRevenue) / lastRevenue) * 100) : null;

    // Restaurants with POS data
    const restaurantsWithPOS = new Set(thisPeriod.map(s => s.restaurant_id)).size;

    // Daily revenue trend (last 30 days)
    const dailyMap = {};
    for (const s of thisPeriod) {
      dailyMap[s.sale_date] = (dailyMap[s.sale_date] || 0) + parseFloat(s.revenue || 0);
    }
    const dailyTrend = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = d.toISOString().split('T')[0];
      dailyTrend.push({
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: Math.round((dailyMap[key] || 0) * 100) / 100,
      });
    }

    // Top items across all restaurants (last 30 days)
    const itemMap = {};
    for (const s of thisPeriod) {
      const key = s.item_name;
      if (!itemMap[key]) itemMap[key] = { name: key, qty: 0, revenue: 0, restaurants: new Set() };
      itemMap[key].qty      += parseFloat(s.quantity_sold || 0);
      itemMap[key].revenue  += parseFloat(s.revenue || 0);
      itemMap[key].restaurants.add(s.restaurant_id);
    }
    const topItems = Object.values(itemMap)
      .map(i => ({ ...i, restaurants: i.restaurants.size }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);

    // Per-restaurant summary
    const perRestaurant = {};
    for (const s of thisPeriod) {
      const id = s.restaurant_id;
      if (!perRestaurant[id]) {
        perRestaurant[id] = { id, name: restaurantMap[id] || 'Unknown', revenue: 0, qty: 0, items: new Set() };
      }
      perRestaurant[id].revenue += parseFloat(s.revenue || 0);
      perRestaurant[id].qty     += parseFloat(s.quantity_sold || 0);
      perRestaurant[id].items.add(s.item_name);
    }
    const restaurantBreakdown = Object.values(perRestaurant)
      .map(r => ({ ...r, items: r.items.size, revenue: Math.round(r.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue);

    // Category breakdown
    const categoryMap = {};
    for (const s of thisPeriod) {
      const cat = s.category || 'Uncategorized';
      if (!categoryMap[cat]) categoryMap[cat] = { name: cat, revenue: 0, qty: 0 };
      categoryMap[cat].revenue += parseFloat(s.revenue || 0);
      categoryMap[cat].qty     += parseFloat(s.quantity_sold || 0);
    }
    const categoryBreakdown = Object.values(categoryMap)
      .map(c => ({ ...c, revenue: Math.round(c.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue);

    return res.status(200).json({
      stats: {
        totalRevenue:       Math.round(totalRevenue * 100) / 100,
        totalQty:           Math.round(totalQty),
        revenueChange,
        restaurantsWithPOS,
        totalRestaurants:   restaurants.length,
        avgRevenuePerRestaurant: restaurantsWithPOS > 0
          ? Math.round((totalRevenue / restaurantsWithPOS) * 100) / 100
          : 0,
      },
      dailyTrend,
      topItems,
      restaurantBreakdown,
      categoryBreakdown,
    });

  } catch (err) {
    console.error('[analytics data API] Error:', err);
    return res.status(500).json({ error: 'Failed to load analytics' });
  }
});