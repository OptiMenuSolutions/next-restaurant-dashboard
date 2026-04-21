// pages/api/admin/data/ingredients.js
// Returns all ingredients across all restaurants with restaurant context.

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
      { data: ingredients },
      { data: restaurants },
    ] = await Promise.all([
      supabase
        .from('ingredients')
        .select('id, restaurant_id, name, unit, last_price, last_ordered_at, is_estimated, ingredient_category, created_at')
        .order('created_at', { ascending: false })
        .limit(2000),
      supabase.from('restaurants').select('id, name'),
    ]);

    const restaurantMap = {};
    for (const r of restaurants || []) restaurantMap[r.id] = r.name;

    const enriched = (ingredients || []).map(ing => ({
      ...ing,
      restaurant_name: restaurantMap[ing.restaurant_id] || 'Unknown',
    }));

    // Stats
    const total        = enriched.length;
    const estimated    = enriched.filter(i => i.is_estimated).length;
    const real         = total - estimated;
    const withPrice    = enriched.filter(i => i.last_price > 0).length;
    const avgPrice     = withPrice
      ? Math.round(enriched.filter(i => i.last_price > 0).reduce((s, i) => s + parseFloat(i.last_price), 0) / withPrice * 100) / 100
      : null;

    // Category breakdown
    const categoryMap = {};
    for (const ing of enriched) {
      const cat = ing.ingredient_category || 'uncategorized';
      categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    }
    const categoryBreakdown = Object.entries(categoryMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Unit breakdown
    const unitMap = {};
    for (const ing of enriched) {
      const unit = ing.unit || 'unknown';
      unitMap[unit] = (unitMap[unit] || 0) + 1;
    }
    const unitBreakdown = Object.entries(unitMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Stale ingredients (last ordered > 60 days ago)
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
    const stale = enriched.filter(i => i.last_ordered_at && i.last_ordered_at < sixtyDaysAgo).length;

    return res.status(200).json({
      ingredients: enriched,
      stats: {
        total,
        estimated,
        real,
        withPrice,
        avgPrice,
        stale,
        restaurantCount: new Set(enriched.map(i => i.restaurant_id)).size,
      },
      categoryBreakdown,
      unitBreakdown,
    });

  } catch (err) {
    console.error('[ingredients data API] Error:', err);
    return res.status(500).json({ error: 'Failed to load ingredients' });
  }
});