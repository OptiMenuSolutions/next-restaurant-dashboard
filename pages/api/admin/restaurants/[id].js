// pages/api/admin/restaurants/[id].js
// Returns detailed data for a single restaurant.

import { withAdminAuth } from '../../../../lib/admin/withAdminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default withAdminAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;

  try {
    const [
      { data: restaurant },
      { data: invoices },
      { data: menuItems },
      { data: ingredients },
      { data: aiUsage },
      { data: posSales },
    ] = await Promise.all([
      supabase.from('restaurants').select('*').eq('id', id).single(),
      supabase.from('invoices').select('id, created_at, parse_status, amount, supplier, number, date').eq('restaurant_id', id).order('created_at', { ascending: false }).limit(10),
      supabase.from('menu_items').select('id, name, price, cost, category').eq('restaurant_id', id).order('created_at', { ascending: false }).limit(10),
      supabase.from('ingredients').select('id, name, unit, last_price, last_ordered_at, is_estimated').eq('restaurant_id', id).order('last_ordered_at', { ascending: false }).limit(10),
      supabase.from('ai_usage').select('feature, cost, created_at').eq('restaurant_id', id).order('created_at', { ascending: false }).limit(50),
      supabase.from('pos_sales').select('item_name, quantity_sold, revenue, sale_date').eq('restaurant_id', id).order('sale_date', { ascending: false }).limit(10),
    ]);

    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    // AI spend total
    const aiSpendTotal = (aiUsage || []).reduce((s, r) => s + parseFloat(r.cost || 0), 0);
    const aiSpendByFeature = { invoice_parse: 0, menu_import: 0, dish_recs: 0 };
    for (const row of aiUsage || []) {
      if (aiSpendByFeature[row.feature] !== undefined) {
        aiSpendByFeature[row.feature] += parseFloat(row.cost || 0);
      }
    }

    // Profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name, avatar_url, created_at')
      .eq('id', restaurant.user_id)
      .single();

    return res.status(200).json({
      restaurant: {
        ...restaurant,
        owner_email: profile?.email || null,
        owner_name: profile?.full_name || null,
      },
      invoices: invoices || [],
      menuItems: menuItems || [],
      ingredients: ingredients || [],
      posSales: posSales || [],
      aiSpend: {
        total: Math.round(aiSpendTotal * 100) / 100,
        by_feature: aiSpendByFeature,
      },
    });

  } catch (err) {
    console.error('[restaurant detail API] Error:', err);
    return res.status(500).json({ error: 'Failed to load restaurant' });
  }
});