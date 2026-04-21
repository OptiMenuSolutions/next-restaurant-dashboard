// pages/api/admin/data/menu.js
// Returns all menu items across all restaurants with restaurant context.

import { withAdminAuth } from '../../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [
      { data: menuItems },
      { data: restaurants },
    ] = await Promise.all([
      supabase
        .from('menu_items')
        .select('id, restaurant_id, name, price, cost, category, description, created_at')
        .order('created_at', { ascending: false })
        .limit(1000),
      supabase.from('restaurants').select('id, name'),
    ]);

    const restaurantMap = {};
    for (const r of restaurants || []) restaurantMap[r.id] = r.name;

    const enriched = (menuItems || []).map(item => {
      const price = parseFloat(item.price || 0);
      const cost  = parseFloat(item.cost  || 0);
      const margin = price > 0 && cost > 0
        ? Math.round(((price - cost) / price) * 1000) / 10
        : null;
      return {
        ...item,
        restaurant_name: restaurantMap[item.restaurant_id] || 'Unknown',
        margin,
      };
    });

    // Stats
    const total        = enriched.length;
    const withPrice    = enriched.filter(i => i.price > 0).length;
    const withCost     = enriched.filter(i => i.cost  > 0).length;
    const withMargin   = enriched.filter(i => i.margin !== null);
    const avgMargin    = withMargin.length
      ? Math.round(withMargin.reduce((s, i) => s + i.margin, 0) / withMargin.length * 10) / 10
      : null;
    const avgPrice     = withPrice
      ? Math.round(enriched.filter(i => i.price > 0).reduce((s, i) => s + parseFloat(i.price), 0) / withPrice * 100) / 100
      : null;

    // Categories breakdown
    const categoryMap = {};
    for (const item of enriched) {
      const cat = item.category || 'Uncategorized';
      categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    }
    const categories = Object.entries(categoryMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return res.status(200).json({
      menuItems: enriched,
      stats: {
        total,
        withPrice,
        withCost,
        avgMargin,
        avgPrice,
        restaurantCount: new Set(enriched.map(i => i.restaurant_id)).size,
      },
      categories,
    });

  } catch (err) {
    console.error('[menu data API] Error:', err);
    return res.status(500).json({ error: 'Failed to load menu items' });
  }
});